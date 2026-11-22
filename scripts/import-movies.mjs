import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { movieFromMetadata, movieSnapshotUrl, titleKey } from '../movie-catalog.mjs';

const curated = 'night_of_the_living_dead_ipod';
const dateAndRights = 'mediatype:movies AND date:[1890-01-01 TO 1930-12-31] AND licenseurl:(*publicdomain*) AND NOT access-restricted-item:true';
const queries = [
  'collection:feature_films AND ' + dateAndRights,
  'subject:("silent film" OR "silent films" OR "feature film" OR "feature films" OR "silent movie") AND NOT collection:feature_films AND ' + dateAndRights
];

async function candidates(query) {
  const ids = [];
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({q:query, output:'json', rows:'1000', page, 'sort[]':'downloads desc', 'fl[]':'identifier'});
    const r = await fetch('https://archive.org/advancedsearch.php?' + params, {signal:AbortSignal.timeout(35000)});
    if (!r.ok) throw Error('Archive search failed: HTTP ' + r.status);
    const {response} = await r.json();
    const docs = response?.docs;
    if (!Array.isArray(docs)) throw Error('Archive search did not return a catalog.');
    ids.push(...docs.map(d => d.identifier));
    if (!docs.length || ids.length >= response.numFound) return ids;
  }
}

const cacheDir = process.env.DUCK_FILM_METADATA_CACHE;
if (cacheDir) await mkdir(cacheDir, {recursive:true});
async function metadata(id) {
  const file = cacheDir && path.join(cacheDir, id + '.json');
  if (file) {
    try {
      if (Date.now() - (await stat(file)).mtimeMs < 86_400_000) return JSON.parse(await readFile(file, 'utf8'));
    } catch { /* Fetch an absent or stale cache entry. */ }
  }
  const r = await fetch('https://archive.org/metadata/' + encodeURIComponent(id), {signal:AbortSignal.timeout(20000)});
  if (!r.ok) throw Error('HTTP ' + r.status);
  const record = await r.json();
  if (file) await writeFile(file, JSON.stringify(record));
  return record;
}

async function mediaPrefix(url) {
  const res = await fetch(url, {headers:{range:'bytes=0-31'}, signal:AbortSignal.timeout(16000)});
  if (res.status !== 206 || !res.headers.get('content-type')?.startsWith('video/mp4') ||
      !/^bytes 0-31\/[1-9]\d+$/i.test(res.headers.get('content-range') || '')) {
    await res.body?.cancel();
    return null;
  }
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length !== 32 || !['ftyp','mdat','moov','free','wide'].includes(data.toString('ascii', 4, 8))) return null;
  return res.headers.get('content-range') + '/' + data.toString('hex');
}

async function available(movie) {
  const [stream, primary, backup, embed] = movie.sources;
  const [a, b, c, response] = await Promise.all([
    mediaPrefix(stream.url), mediaPrefix(primary.url), mediaPrefix(backup.url),
    fetch(embed.url, {method:'HEAD', signal:AbortSignal.timeout(16000)})
  ]);
  return a && a === b && b === c && response.ok && response.headers.get('content-type')?.includes('text/html');
}

const ids = [...new Set([curated, ...(await Promise.all(queries.map(candidates))).flat()])].filter(id => /^[A-Za-z0-9_.-]+$/.test(id));
const rows = new Array(ids.length);
let next = 0, failed = 0;
async function worker() {
  while (next < ids.length) {
    const index = next++;
    const id = ids[index];
    try {
      const movie = movieFromMetadata(await metadata(id));
      if (movie && await available(movie)) rows[index] = movie;
    } catch {
      failed++;
    }
  }
}
await Promise.all(Array.from({length: 5}, worker));
const seen = new Set();
const movies = rows.filter(movie => {
  if (!movie) return false;
  const k = titleKey(movie);
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
if (!movies.some(m => m.id === 'film:' + curated) || movies.length < 200) throw Error('Archive import incomplete. Preserving the existing catalog.');
const hosts = new Set(movies.flatMap(m => m.sources.filter(s => s.key === 'primary' || s.key === 'backup').map(s => new URL(s.url).host)));
const summary = {count:movies.length, hostCount:hosts.size, sourcesPerMovie:4, verifiedAt:new Date().toISOString()};
const output = JSON.stringify(summary).slice(0, -1) + ',"movies":[\n' + movies.map(m => JSON.stringify(m)).join(',\n') + '\n]}\n';
await mkdir(new URL('./', movieSnapshotUrl), {recursive:true});
const temp = new URL(movieSnapshotUrl.href + '.' + randomUUID() + '.tmp');
try {
  await writeFile(temp, output);
  await rename(temp, movieSnapshotUrl);
} finally {
  await rm(temp, {force:true});
}
console.log('Verified ' + movies.length + ' feature-length film records across ' + hosts.size + ' Archive storage hosts; ' + failed + ' requests failed.');

