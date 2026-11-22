import assert from 'node:assert/strict';
import { fetchCommunityCatalog, getCommunityCatalog, parseGn, parseCkv, parseTruffled, parseUgs } from '../community-catalog.mjs';

const gnRows = [
  {id: 1, name: 'OvO', cover: '{COVER_URL}/1.png', url: '{HTML_URL}/1-fix2.html', author: 'Dedra Games'},
  {id: 2, name: 'Traversal', cover: '{COVER_URL}/fake.png', url: '{HTML_URL}/%2e%2e/private.html'},
  {id: 3, name: 'Offsite', cover: 'https://example.com/image.png', url: 'https://example.com/game'},
  {id: 4, name: '[!] COMMENTS', url: '{HTML_URL}/4.html'},
  {id: 5, name: 'Dave and Bambi', url: '{HTML_URL}/615.html-a'}
];
const gn = parseGn(gnRows);
assert.deepEqual(gn.map(g => g.id), ['gn:1', 'gn:5']);
assert.equal(gn[0].url, 'https://gn-math.github.io/html/1-fix2.html');
assert.equal(gn[0].thumb, 'https://raw.githubusercontent.com/gn-math/covers/main/1.png');

const tree = paths => ({tree: paths.map(path => ({type: 'blob', path})), truncated: false});
const ckvTree = tree(['gamefiles/Wheely.html', "gameimages/wheely's-car.png"]);
const ckvText = '<a class="game-link" href="gamefiles/wheely.html"><img src="gameimages/wheely\'s-car.png"><div>Wheely</div></a>'
  + '<a class="game-link" href="https://example.com/file"><div>Off-site</div></a>';
const ckv = parseCkv(ckvText, ckvTree);
assert.equal(ckv.length, 1);
assert.equal(ckv[0].url, 'https://wanocapy.github.io/ChickenKingsVault/gamefiles/Wheely.html');
assert.ok(ckv[0].thumb.endsWith("/gameimages/wheely's-car.png"));

const truffled = {games: [
  {name: '1', url: '/games/1/index.html', thumbnail: '/png/games/1.webp'},
  {name: 'Chess', url: 'https://chess.com/', frameType: 'proxy'},
  {name: 'Monkey Mart', url: '/games/MonkeyMart/index.html'},
  {name: 'Removed', url: '/games/missing.html'},
  {name: 'Off-site', url: 'https://example.com/game', frameType: 'proxy'},
  {name: 'Unknown', url: 'javascript:alert(1)'}
]};
assert.equal(parseTruffled(truffled).length, 4);
assert.equal(parseTruffled(truffled)[1].launchMode, 'external');

const ugsTree = tree(['UGS-Files/clOvO.html', 'UGS-Files/clA & B.htm', 'UGS-Files/unpkg.html', 'offline/games.html']);
const ugs = parseUgs(ugsTree, [], gn);
assert.equal(ugs.length, 2);
assert.equal(ugs[0].thumb, gn[0].thumb);
assert.equal(ugs[0].title, 'OvO');
assert.ok(ugs[1].url.endsWith('/clA%20%26%20B.htm'));
assert.throws(() => parseUgs({truncated: true, tree: []}), /Incomplete/);

async function read(url) {
  if (url.endsWith('zones.json')) return JSON.stringify([...gnRows, gnRows[0]]);
  if (url.endsWith('games.js')) return ckvText;
  if (url.includes('api.github.com/repos/WanoCapy')) return JSON.stringify(ckvTree);
  if (url.endsWith('g.json')) return JSON.stringify(truffled);
  if (url.includes('api.github.com/repos/bubbls')) return JSON.stringify(ugsTree);
  if (url.endsWith('ugs.json')) return '[]';
  throw Error('Unexpected URL: ' + url);
}
const result = await fetchCommunityCatalog({
  read, truffledAvailable: async url => url.endsWith('/1/index.html') || url.endsWith('/monkeymart/index.html')
});
assert.equal(result.count, 8);
assert.deepEqual(result.providers, {'GN-MATH': '2 indexed', CKV: '1 indexed', TRUFFLED: '3 indexed', UGS: '2 indexed'});
assert.ok(result.games.find(g => g.title === 'Monkey Mart').url.endsWith('/monkeymart/index.html'));
assert.equal(result.games.filter(g => g.title === 'OvO').length, 2);
assert.ok(!result.games.some(g => g.title === 'Removed'));

const snapshot = await getCommunityCatalog();
assert.equal(snapshot.count, snapshot.games.length);
assert.equal(new Set(snapshot.games.map(g => g.id)).size, snapshot.count);
assert.ok(snapshot.count > 3000);
for (const g of snapshot.games) assert.ok(g.title && g.url.startsWith('https://') && (!g.thumb || g.thumb.startsWith('https://')));
console.log('Community catalog checks passed (' + snapshot.count + ' bundled entries).');

