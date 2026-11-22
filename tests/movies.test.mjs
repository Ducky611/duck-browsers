import assert from 'node:assert/strict';
import { getMovieCatalog, movieFromMetadata, titleKey } from '../movie-catalog.mjs';

const file = {name:'Example Film.mp4', length:'4500', height:'480', size:'250000000'};
const record = {
  metadata:{identifier:'example', title:'Example Film (1929)', date:'1929', licenseurl:'http://creativecommons.org/publicdomain/mark/1.0/', mediatype:'movies'},
  files:[file, {...file, name:'trailer.mp4', length:'45'}],
  workable_servers:['ia600001.us.archive.org'], dir:'/7/items/example',
  alternate_locations:{workable:[{server:'dn710001.ca.archive.org',dir:'/0/items/example'}]}
};
const movie = movieFromMetadata(record);
assert.equal(movie.title, 'Example Film');
assert.equal(movie.runtimeSeconds, 4500);
assert.equal(movie.sources[1].url, 'https://ia600001.us.archive.org/7/items/example/Example%20Film.mp4');
assert.equal(movie.sources[2].url, 'https://dn710001.ca.archive.org/0/items/example/Example%20Film.mp4');
assert.deepEqual(movie.sources.map(s => s.key), ['stream','primary','backup','embed']);
assert.equal(movieFromMetadata({...record, files:[{...file, length:'120'}]}), null);
assert.equal(movieFromMetadata({...record, metadata:{...record.metadata, date:'2020'}}), null);
assert.equal(movieFromMetadata({...record, metadata:{...record.metadata, licenseurl:''}}), null);
assert.equal(movieFromMetadata({...record, alternate_locations:{}}), null);
assert.equal(movieFromMetadata({...record, files:[{...file, private:'true'}]}), null);
assert.equal(movieFromMetadata({...record, metadata:{...record.metadata, 'access-restricted-item':'true'}}), null);
assert.equal(movieFromMetadata({...record, alternate_locations:{workable:[{server:'evil.example', dir:record.dir}]}}), null);
assert.equal(movieFromMetadata({...record, alternate_locations:{workable:[{server:'ia600002.us.archive.org', dir:'/elsewhere'}]}}), null);

const catalog = await getMovieCatalog();
assert.equal(catalog.count, catalog.movies.length);
assert.equal(catalog.count, new Set(catalog.movies.map(titleKey)).size);
assert.ok(catalog.count >= 200 && catalog.hostCount > 50);
const servers = new Set();
for (const entry of catalog.movies) {
  assert.ok(entry.runtimeSeconds >= 2400);
  assert.deepEqual(entry.sources.map(s => s.key), ['stream','primary','backup','embed']);
  const [stream,primary,backup,embed] = entry.sources;
  assert.ok(stream.url.startsWith('https://archive.org/download/'));
  assert.ok(embed.url.startsWith('https://archive.org/embed/'));
  assert.equal(embed.type, 'embed');
  const primaryHost = new URL(primary.url).hostname;
  const backupHost = new URL(backup.url).hostname;
  assert.notEqual(primaryHost, backupHost);
  servers.add(primaryHost);
  servers.add(backupHost);
}
assert.equal(catalog.hostCount, servers.size);
assert.ok(catalog.movies.some(m => m.id === 'film:night_of_the_living_dead_ipod' && m.year === 1968));
console.log('Film catalog checks passed (' + catalog.count + ' movies).');

