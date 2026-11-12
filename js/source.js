// Fuente de datos: el puente (marcador en una pestaña de khinsider) o, si el
// usuario lo configura, un proxy CORS propio.
import { S } from './store.js';

const KH_ORIGIN = 'https://downloads.khinsider.com';
let bridgeWin = null;
let connected = false;
let lastPong = 0;
let reqId = 0;
const pending = new Map();
const stateListeners = new Set();
let importHandler = () => {};

export const isConnected = () => connected;
export const hasProxy = () => !!(S().settings.proxy || '').trim();
export const canFetch = () => connected || hasProxy();
export function onState(fn) { stateListeners.add(fn); }
export function onImport(fn) { importHandler = fn; }
function setConnected(v) {
  if (connected === v) return;
  connected = v;
  stateListeners.forEach(fn => fn(v));
}

window.addEventListener('message', ev => {
  if (ev.origin !== KH_ORIGIN) return;
  const m = ev.data;
  if (!m || m.kh !== 1) return;
  if (m.type === 'hello') {
    bridgeWin = ev.source;
    lastPong = Date.now();
    bridgeWin.postMessage({ kh: 1, type: 'welcome' }, KH_ORIGIN);
    setConnected(true);
  } else if (m.type === 'res') {
    lastPong = Date.now();
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || 'Error'));
  } else if (m.type === 'import' && ev.source === bridgeWin) {
    importHandler(m.payload);
  }
});

// Latido: detecta si la pestaña de khinsider se cerró o recargó.
setInterval(() => {
  if (!connected) return;
  if (!bridgeWin || bridgeWin.closed) return setConnected(false);
  call('ping', {}, 6000).catch(() => setConnected(false));
}, 15000);

function call(cmd, args, timeout = 45000) {
  return new Promise((resolve, reject) => {
    if (!bridgeWin || bridgeWin.closed) { setConnected(false); return reject(new Error('Sin conexión con khinsider')); }
    const id = ++reqId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Tiempo de espera agotado')); }, timeout);
    pending.set(id, { resolve, reject, timer });
    bridgeWin.postMessage({ kh: 1, type: 'req', id, cmd, args }, KH_ORIGIN);
  });
}

/* ---------- Proxy opcional ---------- */
async function proxyDoc(path) {
  const tpl = S().settings.proxy.trim();
  const target = new URL(path, KH_ORIGIN).href;
  const url = tpl.includes('{url}') ? tpl.replace('{url}', encodeURIComponent(target)) : tpl + encodeURIComponent(target);
  const r = await fetch(url);
  const html = await r.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (window.KHParse.isChallenge(doc)) throw new Error('Cloudflare bloqueó el proxy');
  if (!r.ok) throw new Error('Proxy: HTTP ' + r.status);
  return { doc, html, url: target };
}
const P = () => window.KHParse;
const viaProxy = {
  album: async a => { const x = await proxyDoc(a.url); return P().parseAlbum(x.doc, x.url); },
  list: async a => {
    const x = await proxyDoc(a.url);
    return { title: (x.doc.querySelector('h2') || {}).textContent || x.doc.title, items: P().parseList(x.doc, x.url) };
  },
  search: a => viaProxy.list({ url: '/search?search=' + encodeURIComponent(a.q || '') }),
  track: async a => { const x = await proxyDoc(a.url); return P().parseTrack(x.doc, x.html); },
  discover: async () => { const x = await proxyDoc('/'); return { links: P().parseTopLinks(x.doc, x.url), home: P().parseList(x.doc, x.url).slice(0, 60) }; }
};

function run(cmd, args) {
  if (connected) return call(cmd, args);
  if (hasProxy()) return viaProxy[cmd](args);
  return Promise.reject(new Error('NOT_CONNECTED'));
}

export const api = {
  album: url => run('album', { url }),
  list: url => run('list', { url }),
  search: q => run('search', { q }),
  track: url => run('track', { url }),
  discover: () => run('discover', {})
};

// Abre khinsider en una pestaña con nombre (el marcador se pulsa allí).
export function openKhinsider(path = '/') {
  const w = window.open(new URL(path, KH_ORIGIN).href, 'khinsider');
  return !!w;
}
