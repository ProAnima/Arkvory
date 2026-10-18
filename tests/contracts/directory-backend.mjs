import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { ArkvoryError } from '@proanima/arkvory-domain';

const sha = () => createHash('sha256');
const hasCode = (error, code) => error instanceof Error && 'code' in error && error.code === code;
const unavailable = () => new ArkvoryError('unavailable', 'Artifact content is unavailable');
const mismatch = () => new ArkvoryError('integrity_mismatch', 'Size or SHA-256 differs');

/**
 * The test storage of ADR 0083 (`directory-backend`): a layout of its own behind the port, and
 * no path on its surface. Content is kept once per SHA-256 (`objects/<sha256>`), each id is a
 * small record (`ids/<id>`) naming its object, so two ids with equal bytes share one object.
 * Writes go to `tmp/` and become visible by rename; a record is written last, so an id is
 * visible only with its whole object. Not for production: no directory sync.
 *
 * It also completes uploads from its own parts (ADR 0083, N1, `staged()`): `compose` reads the
 * part files in order, `commit` hard-links them under `composed/<id>/` (a durable link to the
 * accepted bytes, no second copy) and then writes the record naming that folder.
 */
export class DirectoryBackend {
  #root;
  constructor(root) {
    this.#root = root;
  }
  #at(...parts) {
    return join(this.#root, ...parts);
  }

  async initialize() {
    for (const folder of ['objects', 'ids', 'parts', 'tmp', 'composed'])
      await mkdir(this.#at(folder), { recursive: true });
  }
  async ready() {
    await stat(this.#at('ids'));
  }
  async identity(readOnly = false) {
    try {
      return (await readFile(this.#at('identity'), 'utf8')).trim();
    } catch (error) {
      if (!hasCode(error, 'ENOENT') || readOnly) throw error;
    }
    const temporary = this.#at('tmp', randomUUID());
    await writeFile(temporary, randomUUID(), { flag: 'wx' });
    await rename(temporary, this.#at('identity'));
    return (await readFile(this.#at('identity'), 'utf8')).trim();
  }
  async checkSpace() {}
  async requireEmpty() {
    try {
      if ((await readdir(this.#at('ids'))).length || (await readdir(this.#at('parts'))).length)
        throw new ArkvoryError('conflict', 'Storage is not empty', { reason: 'already_exists' });
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
  }

  /** Streams into `tmp/` with size and SHA-256 checked before anything becomes visible. */
  async #receive(source, expected, cancellation) {
    const temporary = this.#at('tmp', randomUUID());
    const handle = await open(temporary, 'wx');
    const hash = sha();
    let size = 0;
    try {
      for await (const chunk of source) {
        cancellation.throwIfAborted();
        size += chunk.byteLength;
        if (size > expected.size) throw mismatch();
        hash.update(chunk);
        await handle.write(chunk);
      }
      cancellation.throwIfAborted();
      if (size !== expected.size || hash.digest('hex') !== expected.sha256) throw mismatch();
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(temporary);
      throw error;
    }
    await handle.close();
    return temporary;
  }

  async #record(id) {
    try {
      return JSON.parse(await readFile(this.#at('ids', id), 'utf8'));
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return null;
      throw error;
    }
  }

  async #publish(id, expected) {
    const existing = await this.#record(id);
    if (existing) {
      if (existing.sha256 !== expected.sha256 || existing.size !== expected.size) throw mismatch();
      return;
    }
    const { sha256, size, composed, segments } = expected;
    const temporary = this.#at('tmp', randomUUID());
    await writeFile(temporary, JSON.stringify({ sha256, size, composed, segments }));
    await rename(temporary, this.#at('ids', id));
  }

  async put(id, expected, source, cancellation) {
    const received = await this.#receive(source, expected, cancellation);
    const existing = await this.#record(id);
    if (existing && existing.sha256 !== expected.sha256) {
      await unlink(received);
      throw mismatch();
    }
    // Equal bytes are one object: an existing one is kept, never replaced under a reader.
    const object = this.#at('objects', expected.sha256);
    if (
      await stat(object).then(
        () => true,
        () => false,
      )
    )
      await unlink(received);
    else await rename(received, object);
    cancellation.throwIfAborted();
    await this.#publish(id, expected);
  }

  async exists(id, size) {
    const record = await this.#record(id);
    if (!record || record.size !== size) throw unavailable();
  }

  async *read(id, size, range) {
    const record = await this.#record(id);
    if (!record) throw unavailable();
    if (record.size !== size) throw mismatch();
    if (size === 0) return;
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    if (record.composed === undefined)
      yield* createReadStream(this.#at('objects', record.sha256), { start, end });
    else yield* this.#segments(this.#at('composed', record.composed), record.segments, start, end);
  }

  /** The bytes `start..end` of files `0..count-1` of a folder, read in order. */
  async *#segments(folder, count, start, end) {
    let offset = 0;
    for (let index = 0; index < count && offset <= end; index++) {
      const path = join(folder, String(index));
      const { size } = await stat(path).catch((error) => {
        throw hasCode(error, 'ENOENT') ? unavailable() : error;
      });
      const from = Math.max(start, offset);
      const to = Math.min(end, offset + size - 1);
      if (from <= to) yield* createReadStream(path, { start: from - offset, end: to - offset });
      offset += size;
    }
  }

  async verify(id, expected, cancellation) {
    await this.exists(id, expected.size);
    const hash = sha();
    for await (const chunk of this.read(id, expected.size)) {
      cancellation.throwIfAborted();
      hash.update(chunk);
    }
    if (hash.digest('hex') !== expected.sha256) throw mismatch();
  }

  async duplicate(sourceId, targetId, expected) {
    await this.exists(sourceId, expected.size);
    await this.#publish(targetId, await this.#record(sourceId));
  }

  #part(id, part) {
    return this.#at('parts', id, `${String(part.index)}-${part.sha256}`);
  }
  async putPart(id, part, source, cancellation) {
    const received = await this.#receive(source, part, cancellation);
    await mkdir(this.#at('parts', id), { recursive: true });
    await rename(received, this.#part(id, part));
  }
  async *readParts(id, parts) {
    for (const part of parts) {
      try {
        yield* createReadStream(this.#part(id, part));
      } catch (error) {
        if (hasCode(error, 'ENOENT')) throw unavailable();
        throw error;
      }
    }
  }

  /** Removes the parts and, when asked, the id; bytes no other id names go with it. */
  async collect(id, removeContent, cancellation) {
    cancellation.throwIfAborted();
    await rm(this.#at('parts', id), { recursive: true, force: true });
    if (!removeContent) return;
    const record = await this.#record(id);
    if (!record) return;
    await rm(this.#at('ids', id), { force: true });
    const key = (r) => (r.composed === undefined ? `object:${r.sha256}` : `composed:${r.composed}`);
    for (const other of await readdir(this.#at('ids'))) {
      const named = await this.#record(other);
      if (named && key(named) === key(record)) return;
    }
    if (record.composed === undefined)
      await rm(this.#at('objects', record.sha256), { force: true });
    else await rm(this.#at('composed', record.composed), { recursive: true, force: true });
  }

  /** Completion from accepted parts (ADR 0083, N1); `readOnly` refuses like a read-only mode. */
  staged(readOnly = false) {
    return { compose: (id, parts, signal) => this.#compose(id, parts, signal, readOnly) };
  }

  async #compose(id, parts, signal, readOnly) {
    signal.throwIfAborted();
    if (readOnly) throw new ArkvoryError('read_only', 'Storage backend is read-only');
    const committed = await this.#record(id);
    // After a commit the object is returned again: a crash before publication is retried.
    if (committed?.composed !== undefined) return this.#committed(id, committed);
    let size = 0;
    for (const part of parts) {
      const info = await stat(this.#part(id, part)).catch((error) => {
        throw hasCode(error, 'ENOENT') ? unavailable() : error;
      });
      size += info.size;
    }
    return {
      size,
      read: (range) => this.#ordered(id, parts, range?.start ?? 0, range?.end ?? size - 1),
      commit: (expected, commitSignal) => this.#commit(id, parts, expected, commitSignal),
      discard: async () => {
        // Nothing was linked before commit; a folder of an interrupted commit has no record.
        if (!(await this.#record(id)))
          await rm(this.#at('composed', id), { recursive: true, force: true });
      },
    };
  }

  #committed(id, record) {
    return {
      size: record.size,
      read: (range) => this.read(id, record.size, range),
      commit: async (expected) => {
        if (expected.sha256 !== record.sha256 || expected.size !== record.size) throw mismatch();
      },
      discard: async () => undefined,
    };
  }

  async *#ordered(id, parts, start, end) {
    let offset = 0;
    for (const part of parts) {
      const from = Math.max(start, offset);
      const to = Math.min(end, offset + part.size - 1);
      if (from <= to)
        yield* createReadStream(this.#part(id, part), { start: from - offset, end: to - offset });
      offset += part.size;
    }
  }

  async #commit(id, parts, expected, signal) {
    signal.throwIfAborted();
    const existing = await this.#record(id);
    if (existing) {
      if (existing.sha256 !== expected.sha256 || existing.size !== expected.size) throw mismatch();
      return;
    }
    const folder = this.#at('composed', id);
    // A folder without a record is an interrupted commit: rebuilt, nothing reads it yet.
    await rm(folder, { recursive: true, force: true });
    const temporary = this.#at('tmp', randomUUID());
    await mkdir(temporary);
    for (const [index, part] of parts.entries())
      await link(this.#part(id, part), join(temporary, String(index)));
    await rename(temporary, folder);
    signal.throwIfAborted();
    await this.#publish(id, { ...expected, composed: id, segments: parts.length });
  }
}
