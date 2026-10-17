import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
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
    for (const folder of ['objects', 'ids', 'parts', 'tmp'])
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
    const temporary = this.#at('tmp', randomUUID());
    await writeFile(temporary, JSON.stringify({ sha256: expected.sha256, size: expected.size }));
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
    yield* createReadStream(this.#at('objects', record.sha256), { start, end });
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
    const record = await this.#record(sourceId);
    await this.#publish(targetId, { size: record.size, sha256: record.sha256 });
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

  /** Removes the parts and, when asked, the id; an object no other id names goes with it. */
  async collect(id, removeContent, cancellation) {
    cancellation.throwIfAborted();
    await rm(this.#at('parts', id), { recursive: true, force: true });
    if (!removeContent) return;
    const record = await this.#record(id);
    if (!record) return;
    await rm(this.#at('ids', id), { force: true });
    for (const other of await readdir(this.#at('ids')))
      if ((await this.#record(other))?.sha256 === record.sha256) return;
    await rm(this.#at('objects', record.sha256), { force: true });
  }
}
