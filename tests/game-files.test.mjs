import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { getCommunityCatalog } from '../community-catalog.mjs';
import { readGameDocument } from '../game-documents.mjs';

const root = new URL('../data/game-documents/', import.meta.url);
const index = JSON.parse(await readFile(new URL('index.json',root),'utf8'));
for (const name of index.packs) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(new URL(name, root))) hash.update(chunk);
  assert.equal(hash.digest('hex') + '.pack', name);
}
const catalog = await getCommunityCatalog();
let copied = 0;
for (const entry of catalog.games) {
  const bytes = await readGameDocument(entry);
  if (entry.launchMode === 'external') {
    assert.equal(bytes, null, entry.id);
  } else {
    assert.ok(bytes && bytes.length && bytes.subarray(0,32000).includes(60), entry.id);
    copied++;
  }
}
assert.equal(Object.keys(index.entries).length, copied);
console.log('Verified',index.packs.length,'pack hashes and read',copied,'local game documents.');
