import { builtins, publisherPicks } from './duck-library.js';
import { closePlayer, showPlayer } from './arcade-player.js';

const $ = id => document.getElementById(id);
const libraries = {
  'GN-MATH': ['GN-Math','gn','#aca3ff'], TRUFFLED: ['Truffled','Tr','#7bcebc'],
  CKV: ["Chicken King’s Vault",'CK','#ffd184'], UGS: ['Ultimate Game Stash','UG','#ec9fb3'],
  LOCAL: ['Built-in','D','#edbd86'], GAMEARTER: ['GameArter'], GAMEZIPPER: ['GameZipper'],
  POKI: ['Poki'], CRAZYGAMES: ['CrazyGames'], OFFICIAL: ['Publisher'], PORTALS: ['Portals']
};
const featuredIds = [33,11,96,66,198,24,1,81,276,4,10,119].map(n => 'gn:' + n);
const ranks = new Map(featuredIds.map((id, i) => [id,i]));
const items = new Map();
let games = [], movies = [], sources = new Map(), versionsByTitle = new Map();
const requested = new Set(), pending = new Set(), failed = new Set();
let activeGame, lastFocus;
const pageSize = 60;
const number = n => n.toLocaleString();
const titleCase = s => s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()) : s;
const safeUrl = s => { try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; } };
const titleKey = name => name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const playUrl = id => '/play/' + encodeURIComponent(id);

function add(item) {
  if (!item.id || !item.title || items.has(item.id)) return;
  if (item.kind === 'game') item.provider = 'LOCAL';
  item.provider ||= item.cat === 'PORTALS' ? 'PORTALS' : 'OFFICIAL';
  item.label = item.kind === 'movie' ? [item.year, item.runtimeSeconds ? Math.round(item.runtimeSeconds / 60) + ' min' : 'Full film'].filter(Boolean).join(' · ') : item.kind === 'trailer' ? 'Trailer' : item.kind === 'film' ? 'Full film' : libraries[item.provider]?.[0] || titleCase(item.provider);
  if (ranks.has(item.id)) item.thumb = '/art/gn-' + item.id.slice(3) + '.webp';
  item.keywords = [item.title,item.year || '',item.provider,item.label,item.tags || '',item.cat || ''].join(' ').toLowerCase();
  items.set(item.id, item);
}

for (const item of [...builtins, ...publisherPicks]) if (item.id !== 'notld') add({...item});
add({id:'opium', title:'Opium', cat:'PORTALS', kind:'portal', url:'https://s3.amazonaws.com/opiumbest/study'});

function reindex() {
  games = []; movies = []; sources = new Map(); versionsByTitle = new Map();
  for (const item of items.values()) {
    if (item.cat === 'CINEMA') { movies.push(item); continue; }
    games.push(item);
    const key = titleKey(item.title);
    if (key && item.provider !== 'PORTALS') {
      const versions = versionsByTitle.get(key) || [];
      versions.push(item);
      versionsByTitle.set(key, versions);
    }
    sources.set(item.provider, (sources.get(item.provider) || 0) + 1);
  }
  for (const item of games) {
    item.rank = ranks.get(item.id) ?? (item.kind === 'community' ? 100 :
      item.kind === 'game' ? 20 : item.kind === 'embed' ? 200 : 300);
  }
  games.sort((a,b) => a.rank - b.rank || a.title.localeCompare(b.title,undefined,{numeric:true}));
  movies.sort((a,b) => Number(a.kind === 'trailer') - Number(b.kind === 'trailer'));
  $('source').replaceChildren(new Option('All libraries',''));
  for (const [id,meta] of Object.entries(libraries)) {
    if (sources.has(id)) $('source').add(new Option(meta[0],id));
  }
}

function card(item) {
  const link = document.createElement('a');
  link.className = 'card';
  link.dataset.route = '';
  link.href = playUrl(item.id);
  const cover = document.createElement('span');
  cover.className = 'cover';
  let hash = 0;
  for (const ch of item.title) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  cover.style.setProperty('--h', String(Math.abs(hash)%360));
  cover.textContent = item.title.split(/\s+/).slice(0,2).map(word => word[0]).join('').toUpperCase();
  cover.setAttribute('aria-hidden','true');
  const thumb = item.thumb || (item.video ? 'https://i.ytimg.com/vi/' + encodeURIComponent(item.video) + '/hqdefault.jpg' : null);
  if (thumb) {
    const img = document.createElement('img');
    img.loading = 'lazy'; img.decoding = 'async'; img.alt = '';
    img.addEventListener('error', () => img.remove(), {once:true});
    img.src = thumb; cover.append(img);
  }
  const copy = document.createElement('span'); copy.className = 'card-copy';
  const name = document.createElement('strong'); name.textContent = item.kind === 'game' ? titleCase(item.title) : item.title;
  const label = document.createElement('small'); label.textContent = item.label;
  copy.append(name,label); link.append(cover,copy);
  return link;
}

function drawLibrary() {
  const cinema = location.pathname === '/movies', params = new URLSearchParams(location.search);
  const list = cinema ? movies : games, query = params.get('q') || '';
  let source = cinema ? '' : params.get('source') || '';
  if (!Object.hasOwn(libraries, source)) source = '';
  const sort = params.get('sort') || 'featured';
  const term = query.trim().toLowerCase();
  const results = list.filter(item => (!source || item.provider === source) && (!term || item.keywords.includes(term)));
  if (sort === 'az' || sort === 'za') results.sort((a,b) => (sort==='az'?1:-1) * a.title.localeCompare(b.title,undefined,{numeric:true}));
  const pages = Math.max(1,Math.ceil(results.length/pageSize));
  const page = Math.min(pages,Math.max(1,parseInt(params.get('page'),10)||1));
  $('pages').setAttribute('aria-label', cinema ? 'Movie pages' : 'Game pages');
  $('libraryTitle').textContent = cinema ? 'Movies' : 'Games';

  $('totalCount').textContent = cinema ? number(movies.filter(m => m.kind === 'movie').length) + ' full films' : number(games.filter(g=>g.provider!=='PORTALS').length) + ' game entries';
  $('search').value = query; $('search').placeholder = cinema ? 'Search movies…' : 'Search games…';
  $('source').parentElement.hidden = cinema; $('source').value = source; $('sort').value = sort;
  const start = (page-1)*pageSize;
  $('catalog').replaceChildren(...results.slice(start,start+pageSize).map(card));
  $('resultCount').textContent = results.length ? (start+1) + '–' + number(Math.min(start+pageSize,results.length)) + ' of ' + number(results.length) : '0 results';
  const relevant = cinema ? ['Movie'] : ['Community','Publisher'];
  const loading = relevant.some(label => pending.has(label));
  if (!results.length && loading) $('resultCount').textContent = 'Loading…';
  $('empty').hidden = results.length > 0 || loading;
  const unavailable = relevant.filter(label => failed.has(label));
  $('retry').hidden = $('feedError').hidden = !unavailable.length;
  $('feedError').textContent = unavailable.join(' and ') + ' catalog unavailable.';
  $('pages').hidden = pages <= 1; $('pageNumber').textContent = 'Page ' + page + ' of ' + pages;
  $('previous').disabled = page === 1; $('next').disabled = page === pages;
  $('pages').dataset.page = page;
}

function updateQuery(updates, replace = false) {
  const url = new URL(location.href);
  for (const [k,v] of Object.entries(updates)) {
    if (v && !(k==='page' && v===1) && !(k==='sort' && v==='featured')) url.searchParams.set(k,v);
    else url.searchParams.delete(k);
  }
  if (replace) history.replaceState(history.state,'',url); else history.pushState({},'',url);
  drawLibrary();
}

function draw(force = false) {
  const path = location.pathname, playing = path.startsWith('/play/');
  if (path !== '/') requestCatalogs(path);
  const from = playing ? history.state?.from || '/games' : path;
  const onHome = from.split('?')[0] === '/';
  document.body.classList.toggle('home', path === '/');
  $('homeView').hidden = !onHome; $('libraryView').hidden = onHome;
  document.querySelector('main').inert = playing;
  document.querySelector('.topbar').inert = playing;
  document.querySelector('.site-footer').inert = playing;
  document.querySelectorAll('.bar-inner nav a').forEach(a => {
    if (a.pathname === path) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');
  });
  if (playing) {
    let id; try { id = decodeURIComponent(path.slice(6)); } catch { id = ''; }
    if (id === 'notld') {
      history.replaceState(history.state,'',playUrl('film:night_of_the_living_dead_ipod'));
      draw();
      return;
    }
    let item = items.get(id);
    if (item && (item.kind === 'official' || item.kind === 'external') && !history.state?.exactVersion) {
      const localVersion = versionsByTitle.get(titleKey(item.title))?.find(g => g.kind === 'community' && g.launchMode !== 'external');
      if (localVersion) {
        item = localVersion;
        history.replaceState(history.state,'',playUrl(item.id));
      }
    }
    const versions = item && item.cat !== 'CINEMA' ? versionsByTitle.get(titleKey(item.title)) || [] : [];
    $('versions').hidden = versions.length < 2;
    $('playerSource').hidden = versions.length > 1;
    if (versions.length > 1) {
      $('versions').replaceChildren(...versions.map(g => new Option(g.label, g.id)));
      $('versions').value = item.id;
    }
    if (force || !item || activeGame !== item) {
      activeGame = item;

      showPlayer(item,{loading:pending.size > 0});
      $('playerTitle').focus({preventScroll:true});
    }
  } else {
    if (!$('player').hidden) closePlayer();
    activeGame = null;
    if (!onHome) drawLibrary();
  }
}

function navigate(url) {
  const to = new URL(url, location.origin);
  if (to.pathname.startsWith('/play/')) {
    lastFocus = document.activeElement?.closest('.card')?.getAttribute('href');
    history.replaceState({...history.state,scrollY:window.scrollY},'');
    history.pushState({from: location.pathname + location.search},'',to);
  } else {
    history.pushState({},'',to); window.scrollTo(0,0);
  }
  draw();
}

document.addEventListener('click', event => {
  const link = event.target.closest('a[data-route]');
  if (!link || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); navigate(link.href);
});
window.addEventListener('popstate', () => {
  draw();
  if (!location.pathname.startsWith('/play/')) {
    const focus = lastFocus && Array.from(document.querySelectorAll('.card')).find(a => a.getAttribute('href') === lastFocus && a.offsetParent);
    focus?.focus({preventScroll:true});
    if (history.state?.scrollY !== undefined) window.scrollTo(0,history.state.scrollY);
  }
});
$('search').addEventListener('input', () => updateQuery({q:$('search').value,page:1},true));
$('source').addEventListener('change', () => updateQuery({source:$('source').value,page:1}));
$('sort').addEventListener('change', () => updateQuery({sort:$('sort').value,page:1}));
$('clearFilters').onclick = () => updateQuery({q:'',source:'',page:1});
for (const [id,dir] of [['previous',-1],['next',1]]) $(id).onclick = () => {
  updateQuery({page:Number($('pages').dataset.page)+dir}); window.scrollTo(0,0); $('search').focus({preventScroll:true});
};
$('back').onclick = () => {
  if (history.state?.from) history.back();
  else { history.replaceState({},'',activeGame?.cat === 'CINEMA' ? '/movies' : '/games'); draw(); }
};
$('versions').onchange = () => {
  history.replaceState({...history.state,exactVersion:true},'',playUrl($('versions').value));
  draw(true);
};
$('restart').onclick = () => draw(true);
$('fullscreen').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('player').requestFullscreen(); } catch {}
};
$('fullscreen').hidden = !document.fullscreenEnabled;
document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || $('settings').open) return;
  if (location.pathname.startsWith('/play/')) { if (e.key === 'Escape') $('back').click(); return; }
  if (e.key === '/' && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) {
    e.preventDefault(); (location.pathname==='/' ? $('homeSearch').elements.url : $('search')).focus();
  }
});
$('settingsButton').onclick = () => $('settings').showModal();
try { $('motion').checked = localStorage.getItem('sii_motion') !== 'false'; } catch { $('motion').checked = true; }
document.body.classList.toggle('motion',$('motion').checked);
$('motion').onchange = () => {
  document.body.classList.toggle('motion',$('motion').checked);
  try {localStorage.setItem('sii_motion',String($('motion').checked));} catch {}
};

async function sync(label, path, kind) {
  if (requested.has(label)) return;
  requested.add(label); pending.add(label); failed.delete(label);
  try {
    const res = await fetch(path,{signal:AbortSignal.timeout(45000)});
    if (!res.ok) throw Error('Catalog unavailable');
    const data = await res.json();
    const rows = kind === 'movie' ? data.movies : data.games;
    if (!Array.isArray(rows) || !rows.length) throw Error('Empty catalog');
    for (const row of rows) if (safeUrl(row.url)) add({...row,kind,url:safeUrl(row.url),thumb:safeUrl(row.thumb)});
    reindex();
  } catch { failed.add(label); }
  finally { pending.delete(label); draw(); }
}
function requestCatalogs(path) {
  if (path === '/movies' || path.startsWith('/play/film')) {
    sync('Movie','/api/movies','movie');
  } else {
    sync('Community','/api/community-games','community');
    sync('Publisher','/api/games','embed');
  }
}
$('retry').onclick = () => {
  for (const label of failed) requested.delete(label);
  requestCatalogs(location.pathname);
};
reindex();
draw();
