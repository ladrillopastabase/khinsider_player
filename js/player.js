// Motor de reproducción: cola, aleatorio, repetición y bucles A-B.
import { S, emit, pushHistory, persist } from './store.js';
import { api, canFetch } from './source.js';

const audio = new Audio();
audio.preload = 'auto';
const listeners = new Set();
let notify = () => listeners.forEach(fn => fn());

export const P = {
  audio,
  queue: [],          // [{trackId, seg?:{a,b}, key}]
  order: [],          // índices de reproducción (aleatorio)
  pos: -1,            // posición dentro de order
  shuffle: false,
  repeat: 'off',      // 'off' | 'all' | 'one'
  loop: { on: false, a: null, b: null, times: 0, done: 0 },  // A-B
  loading: false,
  error: ''
};

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const current = () => (P.pos >= 0 && P.order.length ? P.queue[P.order[P.pos]] : null);
export const currentTrack = () => { const c = current(); return c ? S().tracks[c.trackId] : null; };

let keySeq = 0;
const mk = it => ({ trackId: it.trackId, ...(it.seg ? { seg: { ...it.seg } } : {}), key: ++keySeq });

function rebuildOrder(keepCurrent = true) {
  const cur = keepCurrent ? P.order[P.pos] : undefined;
  const idx = P.queue.map((_, i) => i);
  if (P.shuffle) {
    const rest = idx.filter(i => i !== cur);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    P.order = cur !== undefined ? [cur, ...rest] : rest;
    P.pos = cur !== undefined ? 0 : (P.order.length ? 0 : -1);
  } else {
    P.order = idx;
    P.pos = cur !== undefined ? cur : (idx.length ? 0 : -1);
  }
}

/* ---------- API pública ---------- */
export function playList(items, startIndex = 0, { shuffle } = {}) {
  if (!items.length) return;
  P.queue = items.map(mk);
  if (typeof shuffle === 'boolean') P.shuffle = shuffle;
  if (P.shuffle && shuffle) {
    P.order = []; P.pos = -1;
    rebuildOrder(false);
  } else {
    P.order = P.queue.map((_, i) => i);
    P.pos = startIndex;
    if (P.shuffle) rebuildOrder(true);
  }
  load(true);
}

export function playNext(items) {
  if (!P.queue.length) return playList(items, 0);
  const at = P.order[P.pos] + 1;
  P.queue.splice(at, 0, ...items.map(mk));
  // Reajusta el orden manteniendo la pista actual
  const curIdx = P.order[P.pos];
  if (P.shuffle) {
    P.order = P.order.map(i => (i >= at ? i + items.length : i));
    P.order.splice(P.pos + 1, 0, ...items.map((_, k) => at + k));
  } else { P.order = P.queue.map((_, i) => i); P.pos = curIdx; }
  saveSession(); notify();
}

export function addToQueue(items) {
  if (!P.queue.length) return playList(items, 0);
  const start = P.queue.length;
  P.queue.push(...items.map(mk));
  items.forEach((_, k) => P.order.push(start + k));
  saveSession(); notify();
}

export function removeFromQueue(orderPos) {
  if (orderPos === P.pos) return;
  const qi = P.order[orderPos];
  P.queue.splice(qi, 1);
  P.order.splice(orderPos, 1);
  P.order = P.order.map(i => (i > qi ? i - 1 : i));
  if (orderPos < P.pos) P.pos--;
  saveSession(); notify();
}

export function moveInQueue(from, to) {
  if (from === to) return;
  const [x] = P.order.splice(from, 1);
  P.order.splice(to, 0, x);
  if (P.pos === from) P.pos = to;
  else if (from < P.pos && to >= P.pos) P.pos--;
  else if (from > P.pos && to <= P.pos) P.pos++;
  saveSession(); notify();
}

export function clearUpcoming() {
  const keep = P.order.slice(0, P.pos + 1);
  const map = new Map();
  const q = keep.map((qi, k) => { map.set(qi, k); return P.queue[qi]; });
  P.queue = q; P.order = q.map((_, i) => i);
  saveSession(); notify();
}

export function jump(orderPos) { if (orderPos >= 0 && orderPos < P.order.length) { P.pos = orderPos; load(true); } }

export function toggle() {
  if (!current()) return;
  if (audio.paused) { if (!audio.src) load(true); else audio.play().catch(onPlayErr); }
  else audio.pause();
}
export function next(auto = false) {
  if (!P.order.length) return;
  if (P.pos < P.order.length - 1) { P.pos++; return load(true); }
  if (P.repeat === 'all') { if (P.shuffle) rebuildOrder(false); P.pos = 0; return load(true); }
  if (auto) { audio.pause(); notify(); return; }
  P.pos = 0; load(false);
}
export function prev() {
  if (!P.order.length) return;
  const seg = current() && current().seg;
  if (audio.currentTime > 3 + (seg ? seg.a : 0)) { seek(seg ? seg.a : 0); return; }
  if (P.pos > 0) P.pos--; else if (P.repeat === 'all') P.pos = P.order.length - 1;
  load(true);
}
export function seek(t) {
  if (!isFinite(t)) return;
  audio.currentTime = Math.max(0, Math.min(t, (audio.duration || t)));
  notify();
}
export function setShuffle(v) { P.shuffle = v; rebuildOrder(true); saveSession(); notify(); }
export function setRepeat(m) { P.repeat = m; saveSession(); notify(); }
export function cycleRepeat() { P.repeat = P.repeat === 'off' ? 'all' : P.repeat === 'all' ? 'one' : 'off'; saveSession(); notify(); }
export function setVolume(v) { audio.volume = Math.max(0, Math.min(1, v)); S().settings.volume = audio.volume; persist(); notify(); }
export function setRate(r) { audio.playbackRate = r; S().settings.rate = r; persist(); notify(); }

/* ---------- Bucle A-B ---------- */
export function setA(t = audio.currentTime) {
  P.loop.a = t;
  if (P.loop.b != null && P.loop.b <= t + 0.05) P.loop.b = null;
  P.loop.on = P.loop.b != null; P.loop.done = 0; notify();
}
export function setB(t = audio.currentTime) {
  if (P.loop.a == null) P.loop.a = 0;
  if (t <= P.loop.a + 0.05) return false;
  P.loop.b = t; P.loop.on = true; P.loop.done = 0;
  if (audio.currentTime > t || audio.currentTime < P.loop.a) seek(P.loop.a);
  notify(); return true;
}
export function setLoop(a, b, { times = 0, jumpTo = true } = {}) {
  if (!(b > a)) return;
  P.loop = { on: true, a, b, times, done: 0 };
  if (jumpTo) seek(a);
  notify();
}
export function toggleLoop() {
  if (P.loop.a == null || P.loop.b == null) return false;
  P.loop.on = !P.loop.on; P.loop.done = 0;
  if (P.loop.on && (audio.currentTime < P.loop.a || audio.currentTime > P.loop.b)) seek(P.loop.a);
  notify(); return true;
}
export function clearLoop() { P.loop = { on: false, a: null, b: null, times: 0, done: 0 }; notify(); }
export function nudge(which, d) {
  const L = P.loop;
  if (which === 'a' && L.a != null) L.a = Math.max(0, Math.min(L.a + d, (L.b ?? Infinity) - 0.05));
  if (which === 'b' && L.b != null) L.b = Math.max((L.a ?? 0) + 0.05, Math.min(L.b + d, audio.duration || L.b + d));
  notify();
}

// Vigilancia de alta frecuencia para que el salto B→A sea preciso.
function tick() {
  const L = P.loop;
  if (L.on && L.a != null && L.b != null && !audio.paused) {
    if (audio.currentTime >= L.b - 0.02) {
      L.done++;
      if (L.times && L.done >= L.times) { L.on = false; notify(); }
      else audio.currentTime = L.a;
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
// En segundo plano rAF se detiene; timeupdate cubre ese caso.
audio.addEventListener('timeupdate', () => {
  const L = P.loop;
  if (L.on && L.b != null && audio.currentTime >= L.b) {
    L.done++;
    if (L.times && L.done >= L.times) { L.on = false; notify(); } else audio.currentTime = L.a;
  }
});

/* ---------- Carga ---------- */
let loadToken = 0;
async function resolveSrc(t, force = false) {
  if (t.src && !force) return t.src;
  if (!t.pageUrl || !canFetch()) return '';
  const r = await api.track(t.pageUrl);
  if (r && r.src) {
    t.src = r.src; if (r.flac) t.flac = r.flac;
    emit('tracks');
  }
  return t.src;
}

async function load(autoplay, { force = false } = {}) {
  const c = current();
  const t = currentTrack();
  if (!c || !t) return;
  const token = ++loadToken;
  P.error = ''; P.loading = true;
  // El segmento de la playlist se convierte en bucle A-B
  if (c.seg && c.seg.b > c.seg.a) P.loop = { on: true, a: c.seg.a, b: c.seg.b, times: 0, done: 0 };
  else P.loop = { on: false, a: null, b: null, times: 0, done: 0 };
  notify();
  let src = '';
  try { src = await resolveSrc(t, force); } catch (e) { P.error = e.message; }
  if (token !== loadToken) return;
  if (!src) {
    P.loading = false;
    P.error = P.error === 'NOT_CONNECTED' || !canFetch()
      ? 'Esta pista aún no tiene audio. Conecta khinsider para obtenerlo.'
      : (P.error || 'No se encontró el audio de esta pista.');
    notify();
    return;
  }
  retried = force;
  audio.src = src;
  audio.playbackRate = S().settings.rate || 1;
  if (c.seg) audio.currentTime = c.seg.a;
  pushHistory(t.id);
  emit('history');
  updateMediaSession();
  saveSession();
  if (autoplay) audio.play().catch(onPlayErr);
  prefetchNext();
}

let retried = false;
audio.addEventListener('error', () => {
  const t = currentTrack();
  if (!t) return;
  // El enlace directo puede caducar: se vuelve a pedir una vez.
  if (!retried && t.pageUrl && canFetch()) { retried = true; load(true, { force: true }); return; }
  P.loading = false;
  P.error = 'No se pudo reproducir el audio.';
  notify();
});
function onPlayErr(e) {
  if (e && e.name === 'NotAllowedError') { P.loading = false; notify(); return; }
  if (e && e.name !== 'AbortError') console.warn(e);
}

async function prefetchNext() {
  const nx = P.order[P.pos + 1];
  if (nx === undefined) return;
  const t = S().tracks[P.queue[nx].trackId];
  if (t && !t.src) { try { await resolveSrc(t); } catch {} }
}

audio.addEventListener('ended', () => {
  const c = current();
  if (P.repeat === 'one') { audio.currentTime = c && c.seg ? c.seg.a : 0; audio.play(); return; }
  next(true);
});
['play', 'pause', 'playing', 'waiting', 'loadedmetadata', 'durationchange', 'volumechange', 'ratechange'].forEach(ev =>
  audio.addEventListener(ev, () => {
    if (ev === 'playing' || ev === 'loadedmetadata') P.loading = false;
    if (ev === 'waiting') P.loading = true;
    if (ev === 'loadedmetadata') {
      const t = currentTrack();
      if (t && isFinite(audio.duration) && Math.abs((t.duration || 0) - audio.duration) > 1) { t.duration = Math.round(audio.duration); emit('tracks'); }
    }
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
    notify();
  }));

/* ---------- Media Session (controles del sistema / pantalla de bloqueo) ---------- */
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const t = currentTrack(); if (!t) return;
  const al = S().albums[t.albumId] || {};
  const art = al.cover || (S().stubs[t.albumId] || {}).thumb;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title, artist: al.meta && (al.meta.developer || al.meta.publisher) || 'khinsider', album: al.title || '',
    artwork: art ? [{ src: art, sizes: '512x512' }] : []
  });
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const h = (a, f) => { try { ms.setActionHandler(a, f); } catch {} };
  h('play', () => audio.play()); h('pause', () => audio.pause());
  h('previoustrack', prev); h('nexttrack', () => next());
  h('seekto', d => seek(d.seekTime));
  h('seekbackward', d => seek(audio.currentTime - (d.seekOffset || 10)));
  h('seekforward', d => seek(audio.currentTime + (d.seekOffset || 10)));
}

/* ---------- Sesión ---------- */
let sessTimer = null;
function saveSession() {
  clearTimeout(sessTimer);
  sessTimer = setTimeout(() => {
    S().session = {
      queue: P.queue.map(q => ({ trackId: q.trackId, ...(q.seg ? { seg: q.seg } : {}) })),
      order: P.order, pos: P.pos, shuffle: P.shuffle, repeat: P.repeat, time: audio.currentTime || 0
    };
    persist();
  }, 400);
}
setInterval(() => { if (!audio.paused) saveSession(); }, 5000);

export function restore() {
  audio.volume = S().settings.volume ?? 0.8;
  const s = S().session;
  if (!s || !Array.isArray(s.queue)) return;
  const q = s.queue.filter(x => S().tracks[x.trackId]);
  if (q.length !== s.queue.length || !q.length) return;
  P.queue = q.map(mk);
  P.order = Array.isArray(s.order) && s.order.length === q.length ? s.order : q.map((_, i) => i);
  P.pos = Math.min(Math.max(0, s.pos | 0), q.length - 1);
  P.shuffle = !!s.shuffle; P.repeat = ['off', 'all', 'one'].includes(s.repeat) ? s.repeat : 'off';
  const t = currentTrack();
  const c = current();
  if (c.seg) P.loop = { on: true, a: c.seg.a, b: c.seg.b, times: 0, done: 0 };
  if (t && t.src) {
    audio.src = t.src;
    const at = s.time || 0;
    audio.addEventListener('loadedmetadata', () => { if (at < audio.duration) audio.currentTime = at; }, { once: true });
    updateMediaSession();
  }
  notify();
}
