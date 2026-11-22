import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fetchCommunityCatalog, snapshotUrl } from '../community-catalog.mjs';

const data = await fetchCommunityCatalog();
const records = data.games.map(entry => JSON.stringify(entry)).join(',\n');
const meta = JSON.stringify({providers: data.providers, count: data.count, fetchedAt: data.fetchedAt});
const destination = new URL(snapshotUrl);
const temporary = new URL(destination.href + '.' + randomUUID() + '.tmp');
await mkdir(new URL('./', destination), {recursive: true});
try {
  await writeFile(temporary, meta.slice(0, -1) + ',"games":[\n' + records + '\n]}\n');
  await rename(temporary, destination);
} finally {
  await rm(temporary, {force: true});
}
console.log('Imported ' + data.count + ' game entries.', data.providers);

