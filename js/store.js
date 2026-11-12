// Estado persistente (localStorage) y utilidades de datos.
const KEY = 'khplayer:v1';

const empty = () => ({
  albums: {},        // id -> {id,title,url,cover,covers,meta,trackIds,fetchedAt}
  tracks: {},        // id -> {id,albumId,title,num,cd,duration,pageUrl,src,flac}
  stubs: {},         // id -> {id,title,url,thumb,info} (álbumes vistos en listas)
  saved: [],         // ids de álbumes en la biblioteca (más reciente primero)
  liked: [],         // ids de pistas favoritas
  likedAlbums: [],
  playlists: [],     // {id,name,desc,items:[{trackId,seg?:{a,b}}],createdAt,updatedAt}
  loops: {},         // trackId -> [{id,name,a,b}]
  selections: [],    // {id,title,url,items:[stub ids],fetchedAt,pinned}
  recents: [],       // {kind:'album'|'playlist'|'selection', id, at}
  history: [],       // trackIds reproducidos recientemente
  settings: { volume: 0.8, proxy: '', rate: 1, crossfade: 0 },
  session: null      // {queue, index, time}
});

let state = load();
const listeners = new Set();
let saveTimer = null;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const s = JSON.parse(raw);
    const base = empty();
    return { ...base, ...s, settings: { ...base.settings, ...(s.settings || {}) } };
  } catch (e) {
    console.warn('No se pudo leer el estado', e);
    return empty();
  }
}

export function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.warn('No se pudo guardar', e); }
  }, 250);
}

export const S = () => state;
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(what) { persist(); listeners.forEach(fn => fn(what)); }

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* ---------- Validación de datos que llegan del puente ---------- */
const str = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
export function safeUrl(u, { audio = false } = {}) {
  if (typeof u !== 'string' || !u) return '';
  try {
    const x = new URL(u);
    if (x.protocol !== 'https:' && x.protocol !== 'http:') return '';
    if (audio && !/\.(mp3|flac|ogg|m4a)$/i.test(x.pathname)) return '';
    return x.href;
  } catch { return ''; }
}
const khUrl = u => {
  const s = safeUrl(u);
  return s && /^https:\/\/downloads\.khinsider\.com\//.test(s) ? s : '';
};

export function upsertStub(raw) {
  if (!raw || typeof raw.id !== 'string') return null;
  const id = str(raw.id, 200);
  const prev = state.stubs[id] || {};
  const st = {
    id,
    title: str(raw.title, 300) || prev.title || id,
    url: khUrl(raw.url) || prev.url || '',
    thumb: safeUrl(raw.thumb) || prev.thumb || '',
    info: Array.isArray(raw.info) ? raw.info.map(x => str(x, 80)).filter(Boolean).slice(0, 4) : (prev.info || [])
  };
  state.stubs[id] = st;
  return st;
}

export function upsertAlbum(raw) {
  if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.tracks)) return null;
  const id = str(raw.id, 200);
  const prev = state.albums[id] || {};
  const trackIds = [];
  raw.tracks.slice(0, 2000).forEach((t, i) => {
    if (!t || typeof t.id !== 'string') return;
    const tid = str(t.id, 400);
    const old = state.tracks[tid] || {};
    state.tracks[tid] = {
      id: tid,
      albumId: id,
      title: str(t.title, 300) || old.title || 'Pista ' + (i + 1),
      num: num(t.num) || i + 1,
      cd: num(t.cd),
      duration: num(t.duration) || old.duration || 0,
      pageUrl: khUrl(t.pageUrl) || old.pageUrl || '',
      src: safeUrl(t.src, { audio: true }) || old.src || '',
      flac: safeUrl(t.flac, { audio: true }) || old.flac || ''
    };
    trackIds.push(tid);
  });
  const meta = {};
  if (raw.meta && typeof raw.meta === 'object') for (const k of Object.keys(raw.meta).slice(0, 20)) meta[str(k, 30)] = str(raw.meta[k], 200);
  const covers = Array.isArray(raw.covers) ? raw.covers.map(c => safeUrl(c)).filter(Boolean).slice(0, 12) : [];
  const al = {
    id,
    title: str(raw.title, 300) || prev.title || id,
    url: khUrl(raw.url) || prev.url || '',
    cover: safeUrl(raw.cover) || prev.cover || (state.stubs[id] && state.stubs[id].thumb) || '',
    covers: covers.length ? covers : (prev.covers || []),
    meta: Object.keys(meta).length ? meta : (prev.meta || {}),
    trackIds: trackIds.length ? trackIds : (prev.trackIds || []),
    fetchedAt: Date.now()
  };
  state.albums[id] = al;
  upsertStub({ id, title: al.title, url: al.url, thumb: (state.stubs[id] && state.stubs[id].thumb) || al.cover });
  return al;
}

export function upsertSelection(raw, { pinned = false } = {}) {
  if (!raw || !Array.isArray(raw.items)) return null;
  const url = khUrl(raw.url) || '';
  const ids = raw.items.slice(0, 1000).map(upsertStub).filter(Boolean).map(s => s.id);
  let sel = state.selections.find(s => url && s.url === url);
  if (!sel) {
    sel = { id: uid(), title: '', url, items: [], fetchedAt: 0, pinned };
    state.selections.unshift(sel);
  }
  sel.title = str(raw.title, 200).trim() || sel.title || 'Selección';
  sel.items = ids;
  sel.fetchedAt = Date.now();
  if (pinned) sel.pinned = true;
  return sel;
}

/* ---------- Biblioteca ---------- */
export function toggleIn(arr, id) {
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1); else arr.unshift(id);
  return i < 0;
}
export function addRecent(kind, id) {
  state.recents = [{ kind, id, at: Date.now() }, ...state.recents.filter(r => !(r.kind === kind && r.id === id))].slice(0, 40);
}
export function pushHistory(trackId) {
  state.history = [trackId, ...state.history.filter(t => t !== trackId)].slice(0, 200);
}

export function createPlaylist(name, items = []) {
  const p = { id: uid(), name: name || 'Nueva playlist', desc: '', items, createdAt: Date.now(), updatedAt: Date.now() };
  state.playlists.unshift(p);
  emit('playlists');
  return p;
}
export const playlist = id => state.playlists.find(p => p.id === id);

export function exportJSON() {
  return JSON.stringify({ app: 'khplayer', version: 1, exportedAt: new Date().toISOString(), state }, null, 1);
}
export function importJSON(text) {
  const data = JSON.parse(text);
  const s = data && data.state;
  if (!s || typeof s !== 'object' || typeof s.albums !== 'object') throw new Error('Archivo no válido');
  const base = empty();
  // Revalida todo lo que viene del archivo
  const next = { ...base, settings: { ...base.settings, ...(s.settings || {}) } };
  state = next;
  Object.values(s.stubs || {}).forEach(upsertStub);
  Object.values(s.albums || {}).forEach(a => {
    if (!a || !Array.isArray(a.trackIds)) return;
    upsertAlbum({ ...a, tracks: a.trackIds.map(id => (s.tracks || {})[id]).filter(Boolean) });
  });
  const okA = id => typeof id === 'string';
  state.saved = (s.saved || []).filter(okA);
  state.liked = (s.liked || []).filter(id => state.tracks[id]);
  state.likedAlbums = (s.likedAlbums || []).filter(okA);
  state.playlists = (s.playlists || []).filter(p => p && Array.isArray(p.items)).map(p => ({
    id: str(p.id, 40) || uid(), name: str(p.name, 120) || 'Playlist', desc: str(p.desc, 1000),
    items: p.items.filter(it => it && state.tracks[it.trackId]).map(it => ({ trackId: it.trackId, ...(it.seg ? { seg: { a: num(it.seg.a), b: num(it.seg.b) } } : {}) })),
    createdAt: num(p.createdAt) || Date.now(), updatedAt: num(p.updatedAt) || Date.now()
  }));
  for (const [tid, arr] of Object.entries(s.loops || {})) {
    if (state.tracks[tid] && Array.isArray(arr)) state.loops[tid] = arr.map(l => ({ id: str(l.id, 40) || uid(), name: str(l.name, 80), a: num(l.a), b: num(l.b) })).filter(l => l.b > l.a);
  }
  (s.selections || []).slice().reverse().forEach(sel => {
    if (!sel || !Array.isArray(sel.items)) return;
    upsertSelection({ title: sel.title, url: sel.url, items: sel.items.map(id => (s.stubs || {})[id]).filter(Boolean) }, { pinned: !!sel.pinned });
  });
  emit('all');
}

export function clearAll() { state = empty(); emit('all'); }

/* ---------- Formato ---------- */
export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.floor(sec % 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}
export function fmtPrecise(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return m + ':' + s.toFixed(1).padStart(4, '0');
}
export function fmtTotal(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}
