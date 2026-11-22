/** Duck's server-side curated, publisher-authorized game index. No proxy fetching from visitor-supplied URLs. */
const GA_URL = 'https://www.gamearter.com/api/v1/catalog/games';
const GZ_URL = 'https://gamezipper.com/api/games.json';
const MAX_GAMES = 4000;
const MAX_PAGES = 20;
const PAGE_SIZE = 200;
const CACHE_MS = 30 * 60 * 1000;
const ACCEPTABLE = {
  GAMEARTER: new Set(['gamearter.com','www.gamearter.com']),
  GAMEZIPPER: new Set(['gamezipper.com','www.gamezipper.com'])
};
let cached = null;
let expires = 0;
let inflight = null;

function verifiedUrl(raw, provider) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && ACCEPTABLE[provider].has(u.hostname) ? u.href : null;
  } catch { return null; }
}
function titleClean(raw) {
  const title = String(raw || '').replace(/\s+/g,' ').trim().slice(0,110);
  return title.length >= 3 ? title : null;
}
function normalized(raw) {
  return String(raw || '').toLowerCase().normalize('NFKC').replace(/[^a-z0-9]+/g,' ').trim();
}
async function readJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: {'accept':'application/json','user-agent':'DuckBrowser/1.1 GameCatalog'}
  });
  if(!response.ok) throw Error(`Game catalog HTTP ${response.status}`);
  const size = Number(response.headers.get('content-length') || 0);
  if (size > 8_000_000) throw Error('Publisher response exceeds catalog size limit');
  return await response.json();
}
function asEntry(g, provider) {
  if (!g || typeof g !== 'object') return null;
  const name = titleClean(g.name);
  const slug = String(g.slug || '');
  if (!name || !/^[a-z0-9][a-z0-9-]{0,95}$/i.test(slug)) return null;
  const url = verifiedUrl(
    provider==='GAMEARTER' ? `https://www.gamearter.com/game/${slug}/`
      : (g.embedUrl || `https://gamezipper.com/${slug}/`),
    provider
  );
  if (!url) return null;
  let cat = provider === 'GAMEARTER' ? (g.categories || g.genres || ['arcade'])[0] : (g.category || 'arcade');
  if (typeof cat !== 'string') cat = 'arcade';
  cat = cat.toUpperCase().slice(0,40);
  const tags = Array.isArray(g.tags) ? g.tags.slice(0,8).map(x => String(x).slice(0,30)).join(' ') : '';
  const thumb = verifiedUrl(g.thumbnail,provider);
  return {id:(provider==='GAMEARTER'?'ga:':'gz:')+slug, title:name, cat, url, thumb, provider, tags};
}

export function createCatalogLoader(fetchOverride) {
  // Optional fetch adapter for isolated test execution.
  const request = fetchOverride || readJson;
  async function collect() {
    const list = [];
    const seen = new Set();
    const providers = { GAMEARTER:'unavailable', GAMEZIPPER:'unavailable' };
    const add = (games, provider) => {
      for (const row of games) {
        const e = asEntry(row,provider);
        if (!e) continue;
        const key = normalized(e.title);
        if (!key || seen.has(key) || list.length >= MAX_GAMES) continue;
        seen.add(key);
        list.push(e);
      }
    };
    const ga = async () => {
      try {
        const first = await request(`${GA_URL}?limit=${PAGE_SIZE}&offset=0`);
        if (!Array.isArray(first.games)) throw Error('Invalid GameArter catalog');
        add(first.games,'GAMEARTER');
        const total = Math.min(MAX_GAMES,Math.max(first.games.length,Number(first.total)||0));
        const offsets=[];
        for(let x=PAGE_SIZE; x<total && offsets.length < MAX_PAGES - 1; x+=PAGE_SIZE) offsets.push(x);
        let next=0, failures=0;
        async function worker(){
          while(next<offsets.length){
            const offset=offsets[next++];
            try {
              const page=await request(`${GA_URL}?limit=${PAGE_SIZE}&offset=${offset}`);
              if(!Array.isArray(page.games)) throw Error('Invalid GameArter page');
              add(page.games,'GAMEARTER');
            } catch (err) {failures++;}
          }
        }
        await Promise.all(Array.from({length:Math.min(4,offsets.length)},worker));
        providers.GAMEARTER = `${list.filter(x=>x.provider==='GAMEARTER').length} loaded` + (failures?' (partial)':'');
      } catch (error) { providers.GAMEARTER='unavailable'; }
    };
    const gz = async () => {
      try {
        const response=await request(GZ_URL);
        const rows=Array.isArray(response)?response:response?.games;
        if (!Array.isArray(rows)) throw Error('Invalid GameZipper catalog');
        add(rows,'GAMEZIPPER');
        providers.GAMEZIPPER=`${list.filter(x=>x.provider==='GAMEZIPPER').length} loaded`;
      } catch (error) {providers.GAMEZIPPER='unavailable';}
    };
    // Race both publishers but sort final output by provider, then title (stable across requests).
    await Promise.all([ga(),gz()]);
    list.sort((a,b)=>a.provider.localeCompare(b.provider)||a.title.localeCompare(b.title));
    return {games:list, providers, fetchedAt:new Date().toISOString(), count:list.length};
  }
  return {collect};
}

const loader=createCatalogLoader();
export async function getCatalog() {
  if(cached && Date.now()<expires) return cached;
  if(inflight) return inflight;
  inflight=loader.collect().then(result=>{
    // Do not cache an empty outage as a healthy catalog.
    if(result.count || !cached) {cached=result;expires=Date.now()+(result.count?CACHE_MS:60_000);}
    else expires=Date.now()+60_000;
    return cached;
  }).finally(()=>{inflight=null;});
  return inflight;
}
