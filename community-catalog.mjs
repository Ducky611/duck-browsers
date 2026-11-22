import { readFile } from 'node:fs/promises';

const GN_GAMES = 'https://gn-math.github.io/html/';
const GN_COVERS = 'https://raw.githubusercontent.com/gn-math/covers/main/';
const CKV = 'https://wanocapy.github.io/ChickenKingsVault/';
const TRUFFLED = 'https://truffled.lol/';
const UGS = 'https://cdn.jsdelivr.net/gh/bubbls/ugs-singlefile@main/';
const FEEDS = {
  gn: 'https://raw.githubusercontent.com/gn-math/assets/main/zones.json',
  ckv: CKV + 'games.js',
  ckvTree: 'https://api.github.com/repos/WanoCapy/ChickenKingsVault/git/trees/main?recursive=1',
  truffled: TRUFFLED + 'js/json/g.json',
  ugsTree: 'https://api.github.com/repos/bubbls/ugs-singlefile/git/trees/main?recursive=1',
  ugsMetadata: 'https://raw.githubusercontent.com/lightspeedsystems-inc/storage/main/ugs.json'
};
const TRUFFLED_EXTERNAL = new Set([
  'nowgg.fun', 'bonk.io', 'chess.com', 'fister.fun', 'www.geoguessr.com',
  'gooberdash.winterpixel.io', 'lolbeans.io', 'skribbl.io', 'iogamesio.org', 'zombsroyale.io'
]);
export const snapshotUrl = new URL('./data/community-games.json', import.meta.url);

function titleOf(value) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function titleKey(title) {
  return title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function fileUrl(value, base) {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (/(^|\/)\.\.?(\/|$)|[\\\x00-\x1f]/.test(decoded)) return null;
    const url = new URL(value, base);
    if (url.username || url.password || url.search || url.hash || !url.href.startsWith(base)) return null;
    if (url.href === base) return null;
    return url.href;
  } catch {
    return null;
  }
}

function game(id, title, provider, url, thumb, tags = '') {
  return {id, title, cat: 'ARCADE', provider, url, thumb, tags};
}

export function parseGn(input) {
  const rows = Array.isArray(input) ? input : input?.zones || input?.games || [];
  const games = [];
  for (const row of rows) {
    const title = titleOf(row?.name);
    if (!title || title.startsWith('[!]') || row.id == null) continue;
    const url = fileUrl(String(row.url || '').replace('{HTML_URL}/', GN_GAMES), GN_GAMES);
    const thumb = fileUrl(String(row.cover || '').replace('{COVER_URL}/', GN_COVERS), GN_COVERS);
    if (!url || !/\.html?(?:-[a-z])?$/i.test(url)) continue;
    const tags = [titleOf(row.author), ...(Array.isArray(row.special) ? row.special.map(titleOf) : [])].join(' ').trim();
    games.push(game('gn:' + row.id, title, 'GN-MATH', url, thumb, tags));
  }
  return games;
}

function repositoryFiles(tree) {
  if (!Array.isArray(tree?.tree) || tree.truncated) throw Error('Incomplete repository file list');
  return tree.tree.filter(entry => entry.type === 'blob').map(entry => entry.path);
}

export function parseCkv(text, tree) {
  const root = CKV + 'gamefiles/';
  const coverRoot = CKV + 'gameimages/';
  const files = tree ? new Set(repositoryFiles(tree)) : null;
  const games = [];
  for (const block of text.matchAll(/<a\b([^>]*\bclass=["']game-link["'][^>]*)>([\s\S]*?)<\/a>/gi)) {
    let path = /\bhref=(["'])(.*?)\1/i.exec(block[1])?.[2];
    const image = /<img\b[^>]*\bsrc=(["'])(.*?)\1/i.exec(block[2])?.[2];
    const title = titleOf(/<div\b[^>]*>([\s\S]*?)<\/div>/i.exec(block[2])?.[1]);
    if (!path?.startsWith('gamefiles/') || !title) continue;
    if (files && !files.has(path)) {
      // The publisher also stores title-cased files; three links in games.js have typos.
      const namedPath = 'gamefiles/' + title.replace(/:/g, '') + '.html';
      if (!files.has(namedPath)) continue;
      path = namedPath;
    }
    const url = fileUrl(path.slice(10), root);
    const thumb = image?.startsWith('gameimages/') && (!files || files.has(image))
      ? fileUrl(image.slice(11), coverRoot) : null;
    if (url && /\.html?$/i.test(url)) games.push(game('ckv:' + path.slice(10), title, 'CKV', url, thumb, 'Chicken Kings Vault'));
  }
  return games;
}

export function parseTruffled(input) {
  const games = [];
  for (const row of input?.games || []) {
    const title = titleOf(row?.name);
    if (!title || !row.url) continue;
    let url;
    try { url = new URL(row.url, TRUFFLED); } catch { continue; }
    const local = [TRUFFLED + 'games/', TRUFFLED + 'gamefile/'].some(root => fileUrl(url.href, root));
    if (!local && !(row.frameType === 'proxy' && url.protocol === 'https:' &&
        !url.username && !url.password && TRUFFLED_EXTERNAL.has(url.host))) continue;
    const thumb = fileUrl(row.thumbnail, TRUFFLED);
    const tags = [...(row.tags || []), ...(row.altNames || [])].map(titleOf).join(' ');
    const item = game('truffled:' + (local ? url.pathname.slice(1) : url.href), title, 'TRUFFLED', url.href, thumb, tags);
    if (!local) item.launchMode = 'external';
    if (row.jspi) item.requiresJSPI = true;
    games.push(item);
  }
  return games;
}

export function parseUgs(tree, metadata = [], others = []) {
  const details = new Map(metadata.filter(row => row.author === 'bubbls/ugs-singlefile').map(row => [row.file, row]));
  const titled = new Map();
  for (const entry of [...others, ...metadata.map(row => ({title: titleOf(row.name)}))]) {
    if (!entry.title) continue;
    const key = titleKey(entry.title);
    if (!titled.has(key)) titled.set(key, entry);
  }
  const games = [];
  for (const path of repositoryFiles(tree)) {
    // Other HTML files in the repository are CDN utilities and alternate menus.
    if (!/^UGS-Files\/(?:cl[^/]+|supremeduelistfix|thiefpuzzle)\.html?$/iu.test(path)) continue;
    const filename = path.slice('UGS-Files/'.length);
    const stem = filename.replace(/^cl/i, '').replace(/\.html?$/i, '');
    const data = details.get(path);
    const matching = titled.get(titleKey(data?.name || stem));
    const display = stem.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
    const title = titleOf(data?.name || matching?.title || display.charAt(0).toUpperCase() + display.slice(1));
    const url = fileUrl(path.split('/').map(encodeURIComponent).join('/'), UGS);
    if (!title || !url) continue;
    let thumb = matching?.thumb || null;
    if (!thumb && ['gmshelf/ckv', 'bubbls/UGS-Assets'].includes(data?.cover_author)) {
      thumb = fileUrl(data.cover_file, 'https://raw.githubusercontent.com/' + data.cover_author + '/main/');
    }
    games.push(game('ugs:' + filename, title, 'UGS', url, thumb, 'Ultimate Game Stash'));
  }
  return games;
}

async function readFeed(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw Error('Feed request failed with HTTP ' + response.status + ' at ' + url);
  const value = await response.text();
  if (value.length > 8_000_000) throw Error('Unexpected feed size at ' + url);
  return value;
}

async function truffledExists(url) {
  const response = await fetch(url, {method: 'HEAD', signal: AbortSignal.timeout(20000)});
  if (response.status === 404 || response.status === 410) return false;
  if (!response.ok) throw Error('Truffled availability check returned HTTP ' + response.status);
  const final = new URL(response.url);
  return final.origin === 'https://truffled.lol' && final.pathname !== '/404' &&
    response.headers.get('content-type')?.includes('text/html');
}

async function liveTruffled(entries, exists) {
  const checked = new Array(entries.length);
  let next = 0;
  async function worker() {
    while (next < entries.length) {
      const index = next++;
      const entry = entries[index];
      if (entry.launchMode === 'external' || await exists(entry.url)) {
        checked[index] = entry;
      } else {
        const lower = entry.url.toLowerCase();
        if (lower !== entry.url && await exists(lower)) checked[index] = {...entry, url: lower};
      }
    }
  }
  await Promise.all(Array.from({length: 6}, worker));
  return checked.filter(Boolean);
}

export async function fetchCommunityCatalog({read = readFeed, truffledAvailable = truffledExists} = {}) {
  const json = async url => JSON.parse(await read(url));
  const [gn, ckvText, ckvTree, truffled, ugsTree, ugsMeta] = await Promise.all([
    json(FEEDS.gn), read(FEEDS.ckv), json(FEEDS.ckvTree), json(FEEDS.truffled), json(FEEDS.ugsTree), json(FEEDS.ugsMetadata)
  ]);
  const sources = [parseGn(gn), parseCkv(ckvText, ckvTree), await liveTruffled(parseTruffled(truffled), truffledAvailable)];
  sources.push(parseUgs(ugsTree, ugsMeta, sources.flat()));
  const providers = {};
  const games = [];
  for (const entries of sources) {
    if (!entries.length) throw Error('A provider returned an empty catalog');
    const seen = new Set();
    const unique = entries.filter(entry => {
      if (seen.has(entry.url)) return false;
      seen.add(entry.url);
      return true;
    });
    games.push(...unique);
    providers[unique[0].provider] = unique.length + ' indexed';
  }
  return {games, providers, count: games.length, fetchedAt: new Date().toISOString()};
}

let snapshot;
export async function getCommunityCatalog() {
  if (!snapshot) snapshot = readFile(snapshotUrl, 'utf8').then(JSON.parse).catch(error => {
    snapshot = null;
    throw error;
  });
  return snapshot;
}

