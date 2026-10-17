import { open } from 'node:fs/promises';

/**
 * A stored-entries ZIP64 archive described as byte segments over a zero-filled file, so tests
 * can describe archives larger than 4 GiB without writing them. Every entry is stored; a
 * `zeros` entry is a gap of that many zero bytes. Offsets and sizes at or above 0xffffffff go
 * to the ZIP64 extended information field; the end records are always ZIP64. CRC-32 is not
 * computed (0): the readers under test never extract the entries they do not verify.
 */
export function zip64Layout(entries) {
  const segments = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const size = entry.data ? entry.data.length : entry.zeros;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(45, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(Math.min(size, 0xffffffff), 18);
    local.writeUInt32LE(Math.min(size, 0xffffffff), 22);
    local.writeUInt16LE(name.length, 26);
    segments.push({ offset, bytes: Buffer.concat([local, name]) });
    if (entry.data) segments.push({ offset: offset + 30 + name.length, bytes: entry.data });
    central.push(centralRecord(name, size, offset, entry.mode ?? 0o100644));
    offset += 30 + name.length + size;
  }
  const directory = Buffer.concat(central);
  const directoryOffset = offset;
  const record = Buffer.alloc(56);
  record.writeUInt32LE(0x06064b50, 0);
  record.writeBigUInt64LE(44n, 4);
  record.writeUInt16LE(45, 12);
  record.writeUInt16LE(45, 14);
  record.writeBigUInt64LE(BigInt(entries.length), 24);
  record.writeBigUInt64LE(BigInt(entries.length), 32);
  record.writeBigUInt64LE(BigInt(directory.length), 40);
  record.writeBigUInt64LE(BigInt(directoryOffset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(directoryOffset + directory.length), 8);
  locator.writeUInt32LE(1, 16);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  end.writeUInt32LE(0xffffffff, 12);
  end.writeUInt32LE(0xffffffff, 16);
  const tail = Buffer.concat([directory, record, locator, end]);
  segments.push({ offset: directoryOffset, bytes: tail });
  return { size: directoryOffset + tail.length, segments };
}

function centralRecord(name, size, offset, mode) {
  const extra = [];
  if (size >= 0xffffffff) extra.push(BigInt(size), BigInt(size));
  if (offset >= 0xffffffff) extra.push(BigInt(offset));
  const zip64 = Buffer.alloc(extra.length ? 4 + extra.length * 8 : 0);
  if (extra.length) {
    zip64.writeUInt16LE(0x0001, 0);
    zip64.writeUInt16LE(extra.length * 8, 2);
    extra.forEach((value, index) => zip64.writeBigUInt64LE(value, 4 + index * 8));
  }
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE((3 << 8) | 45, 4);
  header.writeUInt16LE(45, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt32LE(Math.min(size, 0xffffffff), 20);
  header.writeUInt32LE(Math.min(size, 0xffffffff), 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(zip64.length, 30);
  header.writeUInt32LE(mode * 65536, 38);
  header.writeUInt32LE(Math.min(offset, 0xffffffff), 42);
  return Buffer.concat([header, name, zip64]);
}

/** Bytes [start, end] (inclusive) of a layout; zero outside its segments. */
export function layoutBytes(layout, start, end) {
  const out = Buffer.alloc(end - start + 1);
  for (const segment of layout.segments) {
    const from = Math.max(start, segment.offset);
    const to = Math.min(end + 1, segment.offset + segment.bytes.length);
    if (from < to)
      segment.bytes.copy(out, from - start, from - segment.offset, to - segment.offset);
  }
  return out;
}

/** Writes a layout to a file: segments at their offsets, the gaps left to the file system. */
export async function writeLayout(path, layout) {
  const handle = await open(path, 'wx', 0o600);
  try {
    for (const segment of layout.segments)
      await handle.write(segment.bytes, 0, segment.bytes.length, segment.offset);
    await handle.truncate(layout.size);
  } finally {
    await handle.close();
  }
}
