/** DUCK — password-protected Node/Wisp Scramjet server. */
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { scramjetPath } from '@mercuryworkshop/scramjet/path';
import { getCatalog } from './game-catalog.mjs';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { packedGame } from './game-documents.mjs';
import { getCommunityCatalog } from './community-catalog.mjs';
import { server as wisp } from '@mercuryworkshop/wisp-js/server';

const require = createRequire(import.meta.url);
const dirOf = specifier => path.dirname(require.resolve(specifier));
const app = express();
const password = process.env.DUCK_PASSWORD?.trim() || '';
const port = Number(process.env.PORT) || 8080;
const host = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const publicBind = !['127.0.0.1', 'localhost', '::1'].includes(host);
if (publicBind && password.length < 12) {
  console.error('Duck requires DUCK_PASSWORD (at least 12 characters) when deployed publicly.');
  process.exit(1);
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // Only the proxy needs cross-origin isolation. The arcade embeds publisher games and film players.
  if (!['/', '/index.html', '/games', '/movies'].includes(req.path) && !req.path.startsWith('/play/')) {
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  }
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const sessionSecret = crypto.randomBytes(32);
const sessionAge = 14 * 24 * 60 * 60; // seconds
function sign(value) {
  return crypto.createHmac('sha256', sessionSecret).update(value).digest('hex');
}
function validSession(req) {
  if (!password) return true;
  const match = /(?:^|;\s*)duck_session=([^;]+)/.exec(req.headers.cookie || '');
  if (!match) return false;
  const [issuedText, mac] = match[1].split('.');
  if (!/^\d{10,13}$/.test(issuedText || '') || !/^[a-f0-9]{64}$/.test(mac || '')) return false;
  const issued = Number(issuedText);
  if (issued > Date.now() || Date.now() - issued > sessionAge * 1000) return false;
  const expected = Buffer.from(sign(issuedText), 'hex');
  const provided = Buffer.from(mac, 'hex');
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}
function validPassword(typed) {
  const a = crypto.createHash('sha256').update(String(typed || '')).digest();
  const b = crypto.createHash('sha256').update(password).digest();
  return crypto.timingSafeEqual(a, b);
}
const failMap = new Map();
function tooManyAttempts(key) {
  const now = Date.now();
  let item = failMap.get(key);
  if (!item || now - item.since > 15*60*1000) {
    item = {since:now, count:0};failMap.set(key,item);
  }
  return item.count >= 10;
}
function noteFailure(key) {
  if (!failMap.has(key)) failMap.set(key, {since:Date.now(),count:0});
  failMap.get(key).count++;
}
function returnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 1500) return '/';
  try {
    const target = new URL(value, 'https://duck.invalid');
    if (target.origin === 'https://duck.invalid' &&
        (['/', '/games', '/movies', '/browser'].includes(target.pathname) || target.pathname.startsWith('/play/'))) {
      return target.pathname + target.search;
    }
  } catch {}
  return '/';
}
function loginMarkup(error = '', next = '/') {
  const action = '/login?next=' + encodeURIComponent(returnPath(next));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>New Tab</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;background:radial-gradient(ellipse at 80% 4%,#502612,transparent 53%),#100908;color:#ffdeac;font:400 15px Inter,system-ui,sans-serif;padding:20px}main{width:min(440px,100%);padding:32px;background:#21110d;border:1px solid #704123}h1{font-size:70px;line-height:1;margin:0 0 14px;font-family:Georgia,serif;font-style:italic;font-weight:500;color:#ffca86}p{color:#d1a079}label{display:block;margin:24px 0 8px}input,button{width:100%;font:inherit;padding:15px;background:#130b08;color:#ffdaab;border:1px solid #9c6b47}button{margin-top:16px;background:#f5bc79;color:#1d0f08;font-weight:800;cursor:pointer}small{display:block;margin-top:14px;color:#ae8262}.error{color:#ff9c85}</style></head><body><main><h1>Duck.</h1><p>A private browser & arcade. Enter your access password.</p>${error ? '<p class="error" role="alert">'+error+'</p>' : ''}<form action="${action}" method="post"><label for="pw">PASSWORD</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">ENTER DUCK ↗</button></form><small>Protected access is required for public hosting.</small></main></body></html>`;
}
app.get('/health', (_req, res) => res.json({ok:true, engine:'Scramjet', service:'Duck'}));
app.get('/login', (req,res) => validSession(req) ? res.redirect(returnPath(req.query.next)) : res.type('html').send(loginMarkup('',req.query.next)));
app.post('/login', express.urlencoded({extended:false,limit:'2kb'}), (req,res) => {
  const key = req.socket.remoteAddress || 'unknown';
  if (tooManyAttempts(key)) return res.status(429).type('html').send(loginMarkup('Too many attempts. Try again later.',req.query.next));
  if (!validPassword(req.body.password)) {
    noteFailure(key);
    return res.status(401).type('html').send(loginMarkup('Incorrect password.',req.query.next));
  }
  failMap.delete(key);
  const stamp = String(Date.now());
  const token = stamp + '.' + sign(stamp);
  const secure = publicBind ? '; Secure' : '';
  res.setHeader('Set-Cookie', `duck_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionAge}${secure}`);
  res.redirect(303, returnPath(req.query.next));
});
app.get('/logout',(req,res) => {
  res.setHeader('Set-Cookie', 'duck_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+(publicBind ? '; Secure' : ''));
  res.redirect('/login');
});
app.use((req,res,next) => {
  if (validSession(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({error:'Sign in to Duck'});
  res.redirect(303, '/login?next=' + encodeURIComponent(returnPath(req.originalUrl)));
});
app.get('/api/movies', async (_req,res) => {
  try {
    const { getMovieCatalog } = await import('./movie-catalog.mjs');
    res.setHeader('Cache-Control','private, max-age=300');
    res.json(await getMovieCatalog());
  } catch (error) {
    console.warn('Movie catalog unavailable:',error.message);
    res.status(503).json({ movies:[],error:'Movie catalog unavailable' });
  }
});
app.get('/api/games', async (_req,res)=>{
  try {
    const data=await getCatalog();
    res.setHeader('Cache-Control','private, max-age=300');
    res.json(data);
  } catch(err){
    console.error('Duck game catalog error:',err.message);
    res.status(503).json({games:[],providers:{GAMEARTER:'unavailable',GAMEZIPPER:'unavailable'},error:'Game catalog is temporarily unavailable'});
  }
});
app.get('/api/community-games', async (_req,res)=>{
  try {
    const data=await getCommunityCatalog();
    res.setHeader('Cache-Control','private, max-age=180');
    res.json(data);
  } catch(error) {
    console.warn('Community catalog unavailable:',error.message);
    res.status(503).json({games:[], count:0, providers:{'GN-MATH':'unavailable', CKV:'unavailable',TRUFFLED:'unavailable',UGS:'unavailable'},error:'Community sources unavailable'});
  }
});
// Look up only catalog IDs. Game HTML is returned as inert text and rendered in a sandbox.
app.get('/api/game-document', async (req, res) => {
  if (typeof req.query.id !== 'string') return res.sendStatus(400);
  try {
    const catalog = await getCommunityCatalog();
    const item = catalog.games.find(game => game.id === req.query.id);
    if (!item || item.launchMode === 'external') return res.sendStatus(404);
    const doc = await packedGame(item);
    if (!doc) return res.sendStatus(404);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control','private, max-age=3600');
    res.setHeader('X-Duck-Asset-Base', doc.base);
    res.type('text/plain; charset=utf-8').vary('Accept-Encoding');
    if (req.acceptsEncodings('gzip', 'identity') === 'gzip') {
      res.setHeader('Content-Encoding','gzip');
      res.setHeader('Content-Length',String(doc.length));
      await pipeline(doc.stream, res);
    } else {
      await pipeline(doc.stream, createGunzip(), res);
    }
  } catch (error) {
    if (!res.destroyed && !res.headersSent) res.sendStatus(503);
  }
});
app.get(['/games', '/movies', '/play/:id'], (_req,res) =>
  res.sendFile(path.join(import.meta.dirname, 'public', 'index.html')));
app.use('/scram/', express.static(scramjetPath));
app.use('/utils/', express.static(dirOf('@mercuryworkshop/scramjet-utils')));
app.use('/controller/', express.static(dirOf('@mercuryworkshop/scramjet-controller')));
app.use('/libcurl/', express.static(dirOf('@mercuryworkshop/libcurl-transport')));
app.use(express.static(path.join(import.meta.dirname, 'public'), {extensions: ['html']}));
app.use((_req, res) => res.status(404).type('text/plain').send('Not found'));

const server = http.createServer(app);
server.on('upgrade', (req, socket, head) => {
  if (!validSession(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (pathname === '/wisp/') {
    req.url = pathname;
    wisp.routeRequest(req, socket, head);
  } else socket.destroy();
});
server.listen(port, host, () => console.log(`Duck is ready on ${host}:${port}`));
