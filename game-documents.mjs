import { open, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

const unpack = promisify(gunzip);
const root = new URL('./data/game-documents/', import.meta.url);
let indexPromise;

function getIndex() {
  indexPromise ??= readFile(new URL('index.json', root), 'utf8').then(JSON.parse).catch(error => {
    indexPromise = null;
    if (error.code === 'ENOENT') return { entries: {} };
    throw error;
  });
  return indexPromise;
}

/** Read one catalogued HTML entry without loading any other game's payload. */
export async function readGameDocument(item) {
  const { entries, packs } = await getIndex();
  if (!Object.hasOwn(entries, item.url)) return null;
  const [part, offset, compressedLength, length] = entries[item.url];
  const file = await open(new URL(packs[part], root), 'r');
  try {
    const compressed = Buffer.allocUnsafe(compressedLength);
    let count = 0;
    while (count < compressed.length) {
      const { bytesRead } = await file.read(compressed, count, compressed.length - count, offset + count);
      if (!bytesRead) throw new Error('Incomplete local game pack');
      count += bytesRead;
    }
    const html = await unpack(compressed, { maxOutputLength: length });
    if (html.length !== length) throw new Error('Incomplete local game document');
    return html;
  } finally {
    await file.close();
  }
}

/** Stream the stored gzip member directly when the browser accepts it. */
export async function packedGame(item) {
  const { entries, packs, alternates } = await getIndex();
  if (!Object.hasOwn(entries, item.url)) return null;
  const [part, offset, compressedLength] = entries[item.url];
  const file = await open(new URL(packs[part], root), 'r');
  return {
    stream: file.createReadStream({ start: offset, end: offset + compressedLength - 1 }),
    length: compressedLength,
    base: alternates?.[item.url] || item.url
  };
}
