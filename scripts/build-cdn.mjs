import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {getCatalog} from '../game-catalog.mjs';
const root = new URL('../',import.meta.url);
const read = file => readFileSync(new URL(file,root),'utf8');
const json = name => JSON.parse(read(name));
const output = new URL('duck-cdn/',root);
mkdirSync(output,{recursive:true});
const assets = {};
function asset(path) {
  const mime = path.endsWith('.png') ? 'image/png' : 'image/webp';
  return 'data:'+mime+';base64,'+readFileSync(new URL('public'+path,root)).toString('base64');
}
for (const dir of ['art','thumbs']) {
  for (const f of readdirSync(new URL('public/'+dir+'/',root))) assets['/'+dir+'/'+f]=asset('/'+dir+'/'+f);
}
const modules = name => read('public/js/'+name+'.js').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const games=json('data/community-games.json').games, movies=json('data/movies.json').movies;
const publishers=await getCatalog();
if(!publishers.count) throw Error('Publisher catalog unavailable; retry the build.');
const aliases=json('data/game-documents/index.json').alternates;
let player=modules('arcade-player');
const start=player.indexOf('async function playCommunity('),end=player.indexOf('function playDocument(',start);
if(start<0||end<0)throw Error('Community player entry point changed');
player=player.slice(0,start)+`async function playCommunity(item,signal) {
  const url = alternatives[item.url] || item.url;
  if (new URL(url).hostname !== 'cdn.jsdelivr.net') { directFrame(item,url); return; }
  const response = await fetch(url,{signal,credentials:'omit'});
  if (!response.ok) throw Error('Game host returned HTTP '+response.status);
  playDocument(item,await response.text(),signal,url);
}
`+player.slice(end);
let arcade=modules('arcade');
const cut=arcade.indexOf('async function sync(label,');
if(cut<0)throw Error('Catalog loader changed');
arcade=arcade.slice(0,cut)+`
function requestCatalogs() {}
for(const item of snapshot.games) add({...item,kind:'community'});
for(const item of snapshot.publishers) add({...item,kind:'embed'});
for(const item of snapshot.movies) add({...item,kind:'movie'});
for(const item of items.values()) if(artwork[item.thumb]) item.thumb=artwork[item.thumb];
reindex();draw();`;
arcade=arcade.replace('link.href = playUrl(item.id);',"link.href = '#' + playUrl(item.id);")
.replace('navigate(link.href)','navigate(link.hash.slice(1))')
.replace('a.pathname === path','a.hash.slice(1) === path');
const routing=`
const route=()=>new URL(window.location.hash.slice(1)||'/', 'https://duck.invalid');
const location={get pathname(){return route().pathname},get search(){return route().search},get href(){return route().href},origin:'https://duck.invalid'};
function setRoute(method,state,title,url){const r=url && new URL(url,location.origin);window.history[method](state,title,r?'#'+r.pathname+r.search:window.location.href)}
const history={get state(){return window.history.state},pushState(...args){setRoute('pushState',...args)},replaceState(...args){setRoute('replaceState',...args)},back(){window.history.back()}};`;
let html=read('public/index.html').replace(/<script[^>]+src="\/js\/[^"]+"[^>]*><\/script>/g,'')
.replace(/href="(\/[^"]*)"([^>]*data-route)/g,'href="#$1"$2')
.replaceAll('href="/browser"','href="https://duckduckgo.com/" target="_blank" rel="noopener"')
.replace('action="/browser"','action="https://duckduckgo.com/" target="_blank" rel="noopener"').replace('name="url"','name="q"').replace('elements.url','elements.q')
.replaceAll('Search DuckDuckGo or enter a URL','Search DuckDuckGo').replace('Search DuckDuckGo or enter a website','Search DuckDuckGo')
.replace('<a href="/logout">Sign out</a>','').replaceAll('"/duck.png"','"'+asset('/duck.png')+'"');
arcade=arcade.replace('elements.url','elements.q');
for(const name of ['arcade','local-games']) html=html.replace('<link rel="stylesheet" href="/'+name+'.css">',()=>'<style>'+read('public/'+name+'.css').replace('/pond.webp',asset('/pond.webp'))+'</style>');
const script='(()=>{\n'+ 'const alternatives='+JSON.stringify(aliases)+';\nconst artwork='+JSON.stringify(assets)+';\nconst snapshot='+JSON.stringify({games,movies,publishers:publishers.games})+';\n'+modules('duck-library')+'\n'+modules('local-games')+'\n'+player+'\n{'+routing+'\n'+arcade+'}\n})();';
writeFileSync(new URL('duck.js',output),script);
html=html.replace('</head>',()=>'<script>if(location.protocol==="https:")window.addEventListener("DOMContentLoaded",()=>{'+read('public/js/new-tab.js')+'});</script></head>');
html=html.replace('</body>',()=>'<script src="./duck.js"></script></body>');
writeFileSync(new URL('index.html',output),html);
const cdn = 'https://cdn.jsdelivr.net/gh/Ducky611/duck-browsers@main/duck-cdn/duck.js';
const launcher = html.replace('src="./duck.js"', 'src="'+cdn+'" onerror="document.querySelector(\'#cdn-error\').hidden=false"');
writeFileSync(new URL('Launch Duck.html',output),launcher.replace('<script src=', '<p id="cdn-error" role="alert" style="position:fixed;bottom:0;background:#211e28;padding:1rem" hidden>Duck could not load from jsDelivr. Check that duck-cdn/duck.js is on GitHub, or open index.html beside the downloaded duck.js.</p><script src='));
console.log('Built static Duck:',games.length,'community games and',movies.length,'movies.');
