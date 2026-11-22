/* Duck — Scramjet 2.x browser integration. Requires server.mjs. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const shell = $('proxyShell');
  const frameElement = $('proxyFrame');
  const statusEl = $('proxyState');
  const message = $('proxyMessage');
  const splash = $('proxySplash');
  const address = $('proxyUrl');
  const direct = $('proxyDirect');
  let engine = null;
  let frame = null;
  let loadPromise = null;
  let open = false;
  let navigation = [];
  let position = -1;

  function status(label) { statusEl.textContent = label; }
  function explain(detail) {
    splash.hidden = false;
    message.textContent = detail;
    $('proxyRetry').hidden = false;
  }
  function parseInput(value) {
    const typed = String(value || '').trim();
    if (!typed) throw new Error('Type a website address or search query.');
    if (/^(?:javascript|data|file|blob|vbscript|filesystem):/i.test(typed)) throw new Error('That kind of URL is not supported.');
    const looksHost = /^(?:[\w\p{L}-]+\.)+[\w\p{L}-]{2,}(?::\d+)?(?:[/?#]\S*)?$/u.test(typed);
    const scheme = /^https?:\/\//i.test(typed);
    // The HTML results page keeps the query URL intact inside Scramjet's frame.
    const queryURL = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(typed);
    const url = scheme ? new URL(typed) : looksHost ? new URL('https://' + typed) : new URL(queryURL);
    const host = url.hostname.toLowerCase();
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Only normal HTTP/HTTPS websites are supported.');
    if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '[::1]' || /^127\./.test(host) || host === '0.0.0.0' || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host))
      throw new Error('Local network addresses are blocked by the browser UI.');
    return url.href;
  }
  function record(url) {
    if (!url || navigation[position] === url) return;
    navigation = navigation.slice(0, position + 1);
    navigation.push(url);
    position = navigation.length - 1;
    $('proxyBack').disabled = position <= 0;
    $('proxyForward').disabled = position >= navigation.length - 1;
  }
  function showBrowser() {
    shell.classList.add('open');
    shell.setAttribute('aria-hidden', 'false');
    document.body.classList.add('locked');
    open = true;
  }
  function closeBrowser() {
    location.assign('/');
    shell.classList.remove('open');
    shell.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('locked');
    open = false;
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(script);
    });
  }
  async function boot() {
    if (engine && frame) return frame;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      if (location.protocol === 'file:')
        throw new Error('Proxy cannot run from file://. Install dependencies and run npm start, then open http://localhost:8080.');
      if (!('serviceWorker' in navigator)) throw new Error('This browser does not support service workers.');
      status('STARTING');
      const response = await fetch('/health', {cache:'no-store'});
      if (!response.ok || !(await response.json()).ok) throw new Error('The Duck proxy server is not running. Start it using npm start.');
      const registration = await navigator.serviceWorker.register('/sw.js', {scope:'/',updateViaCache:'none'});
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await Promise.race([
          new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true})),
          new Promise((_resolve,reject) => setTimeout(() => reject(new Error('The service worker did not gain control. Reload once.')), 12000))
        ]);
      }
      const serviceworker = navigator.serviceWorker.controller ?? registration.active;
      if (!serviceworker) throw new Error('Service worker failed to initialize.');
      for (const src of ['/scram/scramjet.js','/controller/controller.api.js','/utils/scramjet-utils.js']) await loadScript(src);
      const api = window.$scramjetController;
      const utils = window.$scramjetUtils;
      if (!api?.Controller) throw new Error('Scramjet controller did not load.');
      const {default: LibcurlClient} = await import('/libcurl/index.mjs');
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      engine = new api.Controller({
        serviceworker,
        transport: new LibcurlClient({wisp: `${protocol}//${location.host}/wisp/`}),
        config: {
          scramjetPath: '/scram/scramjet.js',
          wasmPath: '/scram/scramjet.wasm',
          injectPath: '/controller/controller.inject.js'
        }
      });
      await engine.wait();
      const plugins = [];
      if (utils?.UrlWatcherPlugin) plugins.push(new utils.UrlWatcherPlugin(url => {
        if (!open) return;
        if (document.activeElement !== address) address.value = url;
        direct.href = url;
        record(url);
      }));
      frame = engine.createFrame(frameElement, {plugins});
      setInterval(() => navigator.serviceWorker.controller?.postMessage('keepalive'), 15000);
      status('PROXY READY');
      return frame;
    })();
    try { return await loadPromise; }
    catch (error) { loadPromise = null; engine = null; status('OFFLINE'); throw error; }
  }
  async function navigate(input, {history = true} = {}) {
    showBrowser();
    let url;
    try { url = parseInput(input); }
    catch (e) { explain(e.message); status('INVALID URL'); return; }
    address.value = url;
    direct.href = url;
    direct.hidden = false;
    splash.hidden = false;
    message.textContent = 'Connecting through your Duck proxy…';
    try {
      const session = await boot();
      if (history) record(url);
      session.go(url);
      splash.hidden = true;
      status('PROXY LIVE');
    } catch (error) {
      console.error('Proxy connection failed:', error);
      explain(error.message + ' The game arcade still works while the proxy is offline.');
      status('OFFLINE');
    }
  }
  function back() {
    if (!frame || position <= 0) return;
    position -= 1;
    address.value = navigation[position];
    direct.href = navigation[position];
    frame.back();
    $('proxyBack').disabled = position <= 0;
    $('proxyForward').disabled = false;
  }
  function forward() {
    if (!frame || position >= navigation.length - 1) return;
    position += 1;
    address.value = navigation[position];
    direct.href = navigation[position];
    frame.forward();
    $('proxyForward').disabled = position >= navigation.length - 1;
    $('proxyBack').disabled = false;
  }
  function reload() { if (frame) frame.reload(); }
  window.duckProxy = {open: navigate, isOpen: () => open, back, forward, reload, retry: boot};
  $('proxyForm').addEventListener('submit', e => {e.preventDefault();navigate(address.value);});
  $('proxyBack').addEventListener('click', back);
  $('proxyForward').addEventListener('click', forward);
  $('proxyReload').addEventListener('click', reload);
  $('proxyClose').addEventListener('click', closeBrowser);
  $('proxyRetry').addEventListener('click', () => navigate(address.value || 'example.com'));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && open) { e.stopImmediatePropagation(); closeBrowser(); }
  }, true);
  $('proxyBack').disabled = true;
  $('proxyForward').disabled = true;
  const initial = new URLSearchParams(location.search).get('url');
  if (initial) navigate(initial); else address.focus();
  // A real status check, not a fabricated ACTIVE label.
  if (location.protocol !== 'file:') {
    fetch('/health', {cache:'no-store'}).then(r => {status(r.ok ? 'SERVER ONLINE' : 'OFFLINE');}).catch(() => status('OFFLINE'));
  } else status('SERVER NEEDED');
})();
