import { mountLocalGame } from './local-games.js';

const area = document.querySelector('#playArea');
const original = document.querySelector('#original');
let cleanup = () => {};
let operation;

function stop() {
  operation?.abort();
  cleanup();
  document.querySelector('#movieSources').hidden = true;
  cleanup = () => {};
  area.replaceChildren();
}

export function closePlayer() {
  stop();
  document.querySelector('#player').hidden = true;
  document.body.classList.remove('playing');
}

function message(heading, detail = '', link) {
  const box = document.createElement('div');
  box.className = 'player-message';
  const title = document.createElement('h2');
  title.textContent = heading;
  box.append(title);
  if (detail) {
    const text = document.createElement('p');
    text.textContent = detail;
    box.append(text);
  }
  if (link) {
    const anchor = document.createElement('a');
    anchor.href = link;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = 'Play on original site';
    box.append(anchor);
  }
  area.replaceChildren(box);
}

function gameFrame(name, opaque) {
  const frame = document.createElement('iframe');
  frame.title = name;
  frame.allow = 'autoplay; fullscreen; gamepad';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.sandbox = 'allow-scripts allow-forms allow-pointer-lock allow-presentation' + (opaque ? '' : ' allow-same-origin');
  return frame;
}

// Imported pages run in an opaque origin. Scope their save data to this game in Duck.
function storageShim(saved) {
  function makeStorage(entries, persistent) {
    const data = new Map(entries);
    function changed() {
      if (persistent) parent.postMessage({ duckGameSave: Array.from(data) }, '*');
    }
    const api = {
      get length() { return data.size; },
      key(i) { return Array.from(data.keys())[i] ?? null; },
      getItem(k) { return data.get(String(k)) ?? null; },
      setItem(k, v) { data.set(String(k), String(v)); changed(); },
      removeItem(k) { data.delete(String(k)); changed(); },
      clear() { data.clear(); changed(); }
    };
    return new Proxy(api, {
      get(target, k) { return Reflect.has(target, k) ? Reflect.get(target, k) : data.get(k); },
      set(target, k, v) { target.setItem(k, v); return true; },
      deleteProperty(target, k) { target.removeItem(k); return true; },
      ownKeys() { return Array.from(data.keys()); },
      getOwnPropertyDescriptor(target, k) { if (data.has(k)) return { configurable: true, enumerable: true, value: data.get(k) }; }
    });
  }
  Object.defineProperty(window, 'localStorage', { value: makeStorage(saved, true) });
  Object.defineProperty(window, 'sessionStorage', { value: makeStorage([], false) });
}

const escapeAttribute = s => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<','&lt;');

export function prepareDocument(source, url, saved) {
  let html = source.replace(/^\uFEFF/, '');
  if (/^\s*(?:<\?xml[^>]*>\s*)?<Module\b/i.test(html)) {
    const content = /<Content\b[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Content>/i.exec(html);
    if (content) html = content[1];
  }
  const baseTag = /<base\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/i;
  let base = url;
  const match = baseTag.exec(html);
  if (match) {
    try {
      const normalized = new URL(match[1] ?? match[2] ?? match[3], url);
      if (['https:', 'http:'].includes(normalized.protocol)) base = normalized.href;
    } catch {}
  }
  const data = JSON.stringify(saved).replaceAll('<','\\u003c');
  const inject = '<base href="' + escapeAttribute(base) + '"><script>(' + storageShim.toString() + ')(' + data + ')<\/script>';
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, tag => tag + inject);
  if (/<html(?:\s[^>]*)?>/i.test(html)) return html.replace(/<html(?:\s[^>]*)?>/i, tag => tag + '<head>' + inject + '</head>');
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  const pos = doctype?.[0].length || 0;
  return html.slice(0,pos) + inject + html.slice(pos);
}

function directFrame(item, url) {
  const frame = gameFrame(item.title, false);
  frame.src = url;
  area.replaceChildren(frame);
}

async function playCommunity(item, signal) {
  const response = await fetch('/api/game-document?' + new URLSearchParams({ id:item.id }), { signal });
  if (response.status === 404) {
    // Some catalogs include launchers that only work on the publisher's own origin.
    if (item.url.endsWith('.html') && item.url.includes('cdn.jsdelivr.net')) {
      const remote = await fetch(item.url, {signal, credentials:'omit'});
      if (!remote.ok) throw Error('The game host returned HTTP ' + remote.status + '.');
      return playDocument(item, await remote.text(), signal);
    }
    if (!signal.aborted) directFrame(item, item.url);
    return;
  }
  if (!response.ok) throw Error('Duck could not read this game file.');
  if (!response.headers.get('content-type')?.startsWith('text/plain')) throw Error('Reopen Duck and sign in to load this game.');
  playDocument(item, await response.text(), signal, response.headers.get('X-Duck-Asset-Base') || item.url);
}

function playDocument(item, html, signal, base = item.url) {
  if (signal.aborted) return;
  const frame = gameFrame(item.title, true);
  const key = 'duck-save:' + item.id;
  let saved = [];
  try { const data = JSON.parse(localStorage.getItem(key)); if (Array.isArray(data)) saved = data; } catch {}
  function store(event) {
    if (event.source !== frame.contentWindow || !Array.isArray(event.data?.duckGameSave)) return;
    const pairs = event.data.duckGameSave;
    if (pairs.length > 4000 || !pairs.every(p => Array.isArray(p) && p.length === 2 && p.every(s => typeof s === 'string'))) return;
    const data = JSON.stringify(pairs);
    if (data.length <= 500000) { try { localStorage.setItem(key, data); } catch {} }
  }
  window.addEventListener('message', store, {signal});
  frame.srcdoc = prepareDocument(html, base, saved);
  area.replaceChildren(frame);
}

function playMovie(item, signal) {
  const select = document.querySelector('#movieSource');
  const options = item.sources.filter(s => {
    try { return ['video','embed'].includes(s.type) && new URL(s.url).protocol === 'https:'; }
    catch { return false; }
  });
  if (!options.length) throw Error('No playback sources are available.');
  select.replaceChildren(...options.map(s => new Option(s.label, s.key)));
  let preferred;
  try { preferred = localStorage.getItem('duck-movie-source'); } catch {}
  select.value = options.find(s => s.key === preferred)?.key || options[0].key;
  document.querySelector('#movieSources').hidden = false;
  let video, time = 0, resume = true;
  function unload() {
    if (!video) return;
    if (video.currentTime > 0) time = video.currentTime;
    resume = video.error ? true : !video.paused;
    video.onerror = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
    video = null;
  }
  function selectSource(remember) {
    unload();
    const index = Math.max(0,options.findIndex(s => s.key === select.value));
    const source = options[index];
    if (remember) { try { localStorage.setItem('duck-movie-source',source.key); } catch {} }
    if (source.type === 'embed') { directFrame(item,source.url); return; }
    const media = document.createElement('video');
    video = media;
    media.controls = true;
    media.playsInline = true;
    media.preload = 'metadata';
    media.title = item.title;
    if (item.thumb) media.poster = item.thumb;
    media.addEventListener('loadedmetadata',() => {
      if (media !== video || signal.aborted) return;
      if (time > 0 && Number.isFinite(media.duration)) media.currentTime = Math.min(time,Math.max(0,media.duration - 1));
      if (resume) media.play().catch(()=>{});
    },{once:true,signal});
    media.onerror = () => {
      if (signal.aborted || media !== video) return;
      message('This source couldn’t play the film', 'Choose another playback source or try the next one.');
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = 'Try next source';
      button.onclick = () => { select.value = options[(index+1)%options.length].key; selectSource(false); };
      area.firstElementChild.append(button);
    };
    area.replaceChildren(media);
    media.src = source.url;
  }
  select.addEventListener('change',() => selectSource(true),{signal});
  cleanup = unload;
  selectSource(false);
}

export async function showPlayer(item, {loading = false} = {}) {
  stop();
  operation = new AbortController();
  const signal = operation.signal;
  document.body.classList.add('playing');
  document.querySelector('#player').hidden = false;
  document.querySelector('#playerTitle').textContent = item?.title || 'Duck Arcade';
  document.querySelector('#playerSource').textContent = item?.label || '';
  const href = item?.video ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(item.video) : item?.url;
  original.hidden = !href;
  original.textContent = item?.provider === 'UGS' ? 'Source file' : 'Original';
  if (href) original.href = href; else original.removeAttribute('href');
  if (!item) {
    message(loading ? 'Loading game…' : 'Game unavailable', loading ? '' : 'Return to the library to choose another title.');
    return;
  }
  try {
    if (item.kind === 'movie') { playMovie(item,signal); return; }
    if (item.kind === 'game') { cleanup = mountLocalGame(item.id, area); return; }
    if (item.launchMode === 'external' || ['external','official','portal'].includes(item.kind)) {
      message(item.title, 'This title opens on its original site.', href); return;
    }
    if (item.kind === 'community') {
      message('Loading ' + item.title + '…');
      await playCommunity(item, signal);
    } else {
      const url = item.video ? 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(item.video) : item.embed || item.url;
      directFrame(item, url);
    }
  } catch (error) {
    if (!signal.aborted) message(item.cat === 'CINEMA' ? 'Couldn’t load this film' : 'Couldn’t load this game', error.message, href);
  }
}

