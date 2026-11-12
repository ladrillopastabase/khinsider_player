import * as St from './store.js';
import * as Pl from './player.js';
import { api, canFetch, isConnected, hasProxy, onState, onImport, openKhinsider } from './source.js';

const { S, emit, fmtTime, fmtPrecise, fmtTotal } = St;
const { P } = Pl;
const KH = 'https://downloads.khinsider.com';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const main = $('#main');
window.name = 'khplayer';

/* =========================================================
 * Utilidades DOM
 * ========================================================= */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; // solo con contenido propio
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}
function add(el, ...kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'i ' + cls);
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', '#i-' + name);
  s.append(u);
  return s;
}
function hashHue(s) { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) | 0; return Math.abs(x) % 360; }
function initials(t) { return String(t || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('') || '♪'; }
function phBg(t) { const a = hashHue(t); return `linear-gradient(135deg,hsl(${a} 70% 55%),hsl(${(a + 50) % 360} 65% 38%))`; }
function art(url, title, cls = 'cover', extra = []) {
  const box = h('div', { class: cls });
  const ph = h('span', { class: 'art-ph', style: 'background:' + phBg(title) }, initials(title));
  add(box, ph);
  if (url) {
    const img = h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' });
    img.onerror = () => img.remove();
    img.onload = () => { ph.style.display = 'none'; };
    add(box, img);
  }
  add(box, extra);
  return box;
}
const stubOf = id => S().stubs[id] || (S().albums[id] && { id, title: S().albums[id].title, thumb: S().albums[id].cover, url: S().albums[id].url, info: [] }) || null;
const albumArt = id => { const a = S().albums[id], s = S().stubs[id]; return (a && a.cover) || (s && s.thumb) || ''; };
const albumTitle = id => (S().albums[id] && S().albums[id].title) || (S().stubs[id] && S().stubs[id].title) || id;
const go = path => { if (location.hash !== '#' + path) location.hash = path; else render(); };
const enc = encodeURIComponent;

/* ---------- Toasts / menús / modales ---------- */
function toast(msg, action) {
  const t = h('div', { class: 'toast' }, msg, action && h('button', { onclick: () => { action.fn(); t.remove(); } }, action.label));
  $('[data-toasts]').append(t);
  setTimeout(() => t.remove(), action ? 6000 : 2800);
}

const menuLayer = $('[data-menu-layer]');
function closeMenu() { menuLayer.hidden = true; menuLayer.replaceChildren(); }
menuLayer.addEventListener('pointerdown', e => { if (e.target === menuLayer) closeMenu(); });
menuLayer.addEventListener('contextmenu', e => { e.preventDefault(); closeMenu(); });
function showMenu(anchor, items) {
  const m = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.append(h('hr')); continue; }
    if (it.header) { m.append(h('div', { class: 'mh' }, it.header)); continue; }
    if (it.href) {
      m.append(h('a', { href: it.href, target: '_blank', rel: 'noopener noreferrer', ...(it.download ? { download: '' } : {}), onclick: () => closeMenu() }, it.icon && icon(it.icon), it.label));
      continue;
    }
    m.append(h('button', {
      role: 'menuitem', class: it.danger ? 'danger' : '',
      onclick: e => { e.stopPropagation(); if (!it.keep) closeMenu(); it.fn(); }
    }, it.icon && icon(it.icon), it.label));
  }
  menuLayer.replaceChildren(m);
  menuLayer.hidden = false;
  let x, y;
  if (anchor && anchor.clientX != null) { x = anchor.clientX; y = anchor.clientY; }
  else { const r = (anchor && anchor.getBoundingClientRect) ? anchor.getBoundingClientRect() : { left: innerWidth / 2, bottom: innerHeight / 2 }; x = r.left; y = r.bottom + 4; }
  const mr = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - mr.width - 8)) + 'px';
  m.style.top = Math.max(8, (y + mr.height > innerHeight - 8 ? y - mr.height - 8 : y)) + 'px';
}

const modalLayer = $('[data-modal-layer]');
function modal(build) {
  return new Promise(res => {
    const close = v => { modalLayer.hidden = true; modalLayer.replaceChildren(); document.removeEventListener('keydown', esc); res(v); };
    const esc = e => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', esc);
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
    build(box, close);
    modalLayer.replaceChildren(box);
    modalLayer.hidden = false;
    modalLayer.onpointerdown = e => { if (e.target === modalLayer) close(null); };
    const f = box.querySelector('input,textarea,button.btn');
    if (f) setTimeout(() => f.focus(), 30);
  });
}
function ask(title, value = '', { placeholder = '', ok = 'Aceptar', multiline = false } = {}) {
  return modal((box, close) => {
    const inp = multiline ? h('textarea', { rows: 4, placeholder }) : h('input', { type: 'text', placeholder });
    inp.value = value;
    const submit = e => { e.preventDefault(); close(inp.value.trim()); };
    add(box, h('form', { onsubmit: submit }, h('h3', null, title), inp,
      h('div', { class: 'row-btns' }, h('button', { type: 'button', class: 'btn soft', onclick: () => close(null) }, 'Cancelar'), h('button', { class: 'btn' }, ok))));
  });
}
function confirmBox(title, text, ok = 'Eliminar') {
  return modal((box, close) => add(box, h('h3', null, title), h('p', { class: 'muted' }, text),
    h('div', { class: 'row-btns' }, h('button', { class: 'btn soft', onclick: () => close(false) }, 'Cancelar'), h('button', { class: 'btn', onclick: () => close(true) }, ok))));
}

/* =========================================================
 * Marcador (bookmarklet)
 * ========================================================= */
let bmCache = null;
const appUrl = () => location.origin + location.pathname;
async function bookmarkletHref() {
  if (bmCache) return bmCache;
  const [a, b] = await Promise.all(['js/parsers.js', 'js/bridge.js'].map(f => fetch(f, { cache: 'no-cache' }).then(r => r.text())));
  const code = (a + '\n' + b.replace("'__APP_URL__'", JSON.stringify(appUrl())))
    .replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, '').replace(/\n\s+/g, '\n');
  bmCache = 'javascript:' + encodeURIComponent('(function(){' + code + '\n})();void 0');
  return bmCache;
}
function bookmarkletLink(label = 'KH Player ▸') {
  const a = h('a', { class: 'bookmarklet', href: '#', title: 'Arrástrame a la barra de marcadores', draggable: 'true' }, icon('link'), label);
  bookmarkletHref().then(href => a.setAttribute('href', href));
  a.addEventListener('click', e => { e.preventDefault(); toast('Arrástralo a tu barra de marcadores. Luego púlsalo estando en khinsider.'); });
  return a;
}
async function copyBookmarklet() {
  const href = await bookmarkletHref();
  try { await navigator.clipboard.writeText(href); toast('Código del marcador copiado'); }
  catch { await ask('Copia este código como URL de un marcador', href, { multiline: true, ok: 'Listo' }); }
}

function connectSteps(dark = false) {
  return [
    h('ol', null,
      h('li', null, 'Arrastra este botón a tu barra de marcadores: ', bookmarkletLink()),
      h('li', null, 'Pulsa ', h('b', null, 'Abrir khinsider'), '. Se abre en otra pestaña.'),
      h('li', null, 'En esa pestaña pulsa el marcador ', h('b', null, 'KH Player'), '. La app se conecta y ya puedes buscar, ver tops y escuchar desde aquí.')),
    h('div', { class: 'row-btns' },
      h('button', { class: 'btn', onclick: () => openKhinsider('/') }, icon('ext'), 'Abrir khinsider'),
      h('button', { class: 'btn soft', onclick: copyBookmarklet }, 'Copiar código (móvil)'),
      h('a', { class: dark ? 'btn soft' : 'btn ghost', href: '#/settings' }, '¿Cómo funciona?'))
  ];
}
function connectModal() {
  modal((box, close) => {
    add(box, h('h3', null, isConnected() ? 'Conectado a khinsider' : 'Conectar con khinsider'));
    if (isConnected()) {
      add(box, h('p', { class: 'muted' }, 'La pestaña de khinsider con el marcador está activa. No la cierres mientras uses la app; si la cierras, solo pulsa el marcador otra vez.'));
    } else {
      add(box, h('p', { class: 'muted' }, 'khinsider bloquea a las páginas externas (Cloudflare), así que la app usa tu propia pestaña de khinsider como puente. No hay que instalar nada.'));
      add(box, ...connectSteps());
    }
    add(box, h('div', { class: 'row-btns' }, h('button', { class: 'btn soft', onclick: () => close() }, 'Cerrar')));
  });
}

/* =========================================================
 * Acciones
 * ========================================================= */
async function ensureAlbum(id, { force = false } = {}) {
  const have = S().albums[id];
  if (have && have.trackIds.length && !force) return have;
  const stub = S().stubs[id];
  const url = (stub && stub.url) || (have && have.url) || KH + '/game-soundtracks/album/' + id;
  if (!canFetch()) throw new Error('NOT_CONNECTED');
  const data = await api.album(url);
  const al = St.upsertAlbum(data);
  if (!al) throw new Error('No se pudo leer el álbum');
  emit('albums');
  return al;
}
function needConnect(path) {
  toast('Conecta khinsider para cargar esto', { label: 'Conectar', fn: () => { path ? openKhinsider(path) : connectModal(); } });
}
async function playAlbum(id, opts = {}) {
  try {
    const al = await ensureAlbum(id);
    if (!al.trackIds.length) return toast('Este álbum no tiene pistas');
    St.addRecent('album', id); emit('recents');
    Pl.playList(al.trackIds.map(trackId => ({ trackId })), opts.start || 0, { shuffle: !!opts.shuffle });
  } catch (e) {
    if (e.message === 'NOT_CONNECTED') needConnect(); else toast('Error: ' + e.message);
  }
}
async function albumItems(id) {
  const al = await ensureAlbum(id);
  return al.trackIds.map(trackId => ({ trackId }));
}
function likeTrack(id) {
  const on = St.toggleIn(S().liked, id); emit('liked');
  toast(on ? 'Añadido a Favoritos' : 'Quitado de Favoritos');
}
function saveAlbum(id) {
  const on = St.toggleIn(S().saved, id); emit('saved');
  toast(on ? 'Añadido a la biblioteca' : 'Quitado de la biblioteca');
  if (on && canFetch()) ensureAlbum(id).catch(() => {});
}
async function addToPlaylistMenu(anchor, getItems) {
  const pls = S().playlists;
  showMenu(anchor, [
    { header: 'Añadir a playlist' },
    { label: 'Nueva playlist…', icon: 'plus', fn: async () => {
      const name = await ask('Nueva playlist', '', { placeholder: 'Nombre', ok: 'Crear' });
      if (!name) return;
      const items = await safeItems(getItems); if (!items) return;
      const p = St.createPlaylist(name, items.map(i => ({ ...i })));
      toast('Creada «' + p.name + '»', { label: 'Ver', fn: () => go('/playlist/' + p.id) });
    } },
    pls.length ? '-' : null,
    ...pls.map(p => ({ label: p.name, icon: 'queue', fn: async () => {
      const items = await safeItems(getItems); if (!items) return;
      p.items.push(...items.map(i => ({ ...i }))); p.updatedAt = Date.now(); emit('playlists');
      toast('Añadido a «' + p.name + '»');
    } }))
  ]);
}
async function safeItems(getItems) {
  try { return await getItems(); }
  catch (e) { if (e.message === 'NOT_CONNECTED') needConnect(); else toast('Error: ' + e.message); return null; }
}

function trackMenu(anchor, tid, ctx = {}) {
  const t = S().tracks[tid]; if (!t) return;
  const liked = S().liked.includes(tid);
  const loops = S().loops[tid] || [];
  const items = [
    { label: 'Reproducir a continuación', icon: 'next', fn: () => { Pl.playNext([{ trackId: tid }]); toast('Se reproducirá a continuación'); } },
    { label: 'Añadir a la cola', icon: 'queue', fn: () => { Pl.addToQueue([{ trackId: tid }]); toast('Añadido a la cola'); } },
    { label: 'Añadir a playlist…', icon: 'plus', keep: true, fn: () => addToPlaylistMenu(anchor, () => [{ trackId: tid }]) },
    { label: liked ? 'Quitar de Favoritos' : 'Añadir a Favoritos', icon: liked ? 'heart-f' : 'heart', fn: () => likeTrack(tid) },
    loops.length ? '-' : null,
    loops.length ? { header: 'Bucles guardados' } : null,
    ...loops.map(l => ({ label: (l.name || 'Bucle') + ' · ' + fmtTime(l.a) + '–' + fmtTime(l.b), icon: 'loop', fn: () => playLoop(tid, l) })),
    '-',
    ctx.inAlbum ? null : { label: 'Ir al álbum', icon: 'album', fn: () => go('/album/' + enc(t.albumId)) },
    t.pageUrl ? { label: 'Abrir en khinsider', icon: 'ext', href: t.pageUrl } : null,
    t.src ? { label: 'Descargar MP3', icon: 'dl', href: t.src, download: true } : null,
    ...(ctx.extra || [])
  ];
  showMenu(anchor, items);
}

function albumMenu(anchor, id) {
  const saved = S().saved.includes(id), liked = S().likedAlbums.includes(id);
  const stub = stubOf(id) || {};
  showMenu(anchor, [
    { label: 'Reproducir', icon: 'play', fn: () => playAlbum(id) },
    { label: 'Aleatorio', icon: 'shuffle', fn: () => playAlbum(id, { shuffle: true }) },
    { label: 'Reproducir a continuación', icon: 'next', fn: async () => { const it = await safeItems(() => albumItems(id)); if (it) { Pl.playNext(it); toast('Se reproducirá a continuación'); } } },
    { label: 'Añadir a la cola', icon: 'queue', fn: async () => { const it = await safeItems(() => albumItems(id)); if (it) { Pl.addToQueue(it); toast('Añadido a la cola'); } } },
    { label: 'Añadir a playlist…', icon: 'plus', keep: true, fn: () => addToPlaylistMenu(anchor, () => albumItems(id)) },
    '-',
    { label: saved ? 'Quitar de la biblioteca' : 'Añadir a la biblioteca', icon: saved ? 'check' : 'plus', fn: () => saveAlbum(id) },
    { label: liked ? 'Quitar de Favoritos' : 'Favorito', icon: liked ? 'heart-f' : 'heart', fn: () => { St.toggleIn(S().likedAlbums, id); emit('liked'); } },
    stub.url ? { label: 'Abrir en khinsider', icon: 'ext', href: stub.url } : null
  ]);
}

function playLoop(tid, l) {
  const c = Pl.current();
  if (c && c.trackId === tid && Pl.currentTrack().src) { Pl.setLoop(l.a, l.b); if (P.audio.paused) P.audio.play().catch(() => {}); }
  else Pl.playList([{ trackId: tid, seg: { a: l.a, b: l.b } }], 0);
}

/* =========================================================
 * Componentes
 * ========================================================= */
function albumCard(id, { rank, sub } = {}) {
  const st = stubOf(id) || { id, title: id };
  const subText = sub != null ? sub : ((S().albums[id] && S().albums[id].meta && [S().albums[id].meta.platforms, S().albums[id].meta.year].filter(Boolean).join(' · ')) || (st.info || []).filter(x => !/^\d+(\.\d+)?\s*(MB|GB)$/i.test(x)).slice(0, 2).join(' · '));
  const cover = art(albumArt(id), st.title, 'cover', [
    rank ? h('span', { class: 'rank' }, rank) : null,
    h('button', { class: 'play-ov', 'aria-label': 'Reproducir', onclick: e => { e.stopPropagation(); playAlbum(id); } }, icon('play')),
    h('button', { class: 'icon-btn more-ov', 'aria-label': 'Más', onclick: e => { e.stopPropagation(); albumMenu(e.currentTarget, id); } }, icon('more'))
  ]);
  return h('div', {
    class: 'card', tabindex: '0', role: 'link',
    onclick: () => go('/album/' + enc(id)),
    onkeydown: e => { if (e.key === 'Enter') go('/album/' + enc(id)); },
    oncontextmenu: e => { e.preventDefault(); albumMenu(e, id); }
  }, cover, h('div', { class: 'ct', title: st.title }, st.title), subText ? h('div', { class: 'cs' }, subText) : null);
}
function playlistCover(p, cls = 'cover') {
  const arts = [...new Set(p.items.map(i => S().tracks[i.trackId] && albumArt(S().tracks[i.trackId].albumId)).filter(Boolean))].slice(0, 4);
  if (arts.length >= 4) { const box = h('div', { class: cls + ' mosaic' }); arts.forEach(a => add(box, h('img', { src: a, alt: '', loading: 'lazy' }))); return box; }
  return art(arts[0] || '', p.name, cls);
}
function playlistCard(p) {
  const cover = playlistCover(p);
  cover.append(h('button', { class: 'play-ov', 'aria-label': 'Reproducir', onclick: e => { e.stopPropagation(); playPlaylist(p.id); } }, icon('play')));
  return h('div', { class: 'card', tabindex: '0', onclick: () => go('/playlist/' + p.id) }, cover,
    h('div', { class: 'ct' }, p.name), h('div', { class: 'cs' }, p.items.length + ' canciones'));
}
function selectionCard(sel) {
  const first = sel.items[0];
  return h('div', { class: 'card', tabindex: '0', onclick: () => go('/sel/' + sel.id) },
    art(first ? albumArt(first) : '', sel.title), h('div', { class: 'ct' }, sel.title), h('div', { class: 'cs' }, sel.items.length + ' álbumes'));
}
function shelf(title, cards, more) {
  if (!cards.length) return null;
  return h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, title), more ? h('a', { href: more }, 'Ver todo') : null),
    h('div', { class: 'shelf' }, cards));
}

function trackList(tids, { showArt = false, inAlbum = false, playItems, numbers, playlist, segs } = {}) {
  const cur = Pl.current();
  const box = h('div', { class: 'tracks' });
  const items = playItems || tids.map((trackId, i) => ({ trackId, ...(segs && segs[i] ? { seg: segs[i] } : {}) }));
  let lastCd = null;
  const hasCds = inAlbum && new Set(tids.map(id => S().tracks[id] && S().tracks[id].cd)).size > 1;
  tids.forEach((tid, i) => {
    const t = S().tracks[tid]; if (!t) return;
    if (hasCds && t.cd !== lastCd) { lastCd = t.cd; add(box, h('div', { class: 'cd-head' }, 'Disco ' + t.cd)); }
    const liked = S().liked.includes(tid);
    const isCur = cur && cur.trackId === tid;
    const seg = segs && segs[i];
    const play = () => Pl.playList(items, i);
    const extra = [];
    if (playlist) {
      extra.push('-', { label: 'Quitar de la playlist', icon: 'x', danger: true, fn: () => { playlist.items.splice(i, 1); playlist.updatedAt = Date.now(); emit('playlists'); } });
      if (i > 0) extra.push({ label: 'Subir', icon: 'back', fn: () => { const [x] = playlist.items.splice(i, 1); playlist.items.splice(i - 1, 0, x); emit('playlists'); } });
      if (i < tids.length - 1) extra.push({ label: 'Bajar', icon: 'down', fn: () => { const [x] = playlist.items.splice(i, 1); playlist.items.splice(i + 1, 0, x); emit('playlists'); } });
    }
    const row = h('div', {
      class: 'tr' + (showArt ? ' with-art' : '') + (isCur ? ' playing' + (P.audio.paused ? ' paused' : '') : '') + (!t.src ? ' nosrc' : ''),
      'data-tid': tid,
      onclick: e => { if (e.target.closest('.tx')) return; play(); },
      oncontextmenu: e => { e.preventDefault(); trackMenu(e, tid, { inAlbum, extra }); }
    },
      showArt
        ? art(albumArt(t.albumId), albumTitle(t.albumId), 'art')
        : h('div', { class: 'tn' }, h('span', { class: 'num' }, numbers ? numbers[i] : (inAlbum ? t.num : i + 1)), h('span', { class: 'eq' }, h('i'), h('i'), h('i')), h('button', { class: 'icon-btn pbtn', 'aria-label': 'Reproducir', onclick: e => { e.stopPropagation(); play(); } }, icon('play'))),
      h('div', { class: 'tt' }, t.title, seg ? h('span', { class: 'seg-badge' }, '⟳ ' + fmtTime(seg.a) + '–' + fmtTime(seg.b)) : null, showArt ? h('small', null, albumTitle(t.albumId)) : null),
      showArt ? h('div', { class: 'ta' }, albumTitle(t.albumId)) : null,
      h('div', { class: 'tx' },
        (S().loops[tid] || []).length ? h('span', { class: 'chip accent', title: 'Tiene bucles guardados' }, '⟳ ' + S().loops[tid].length) : null,
        h('button', { class: 'icon-btn heart' + (liked ? ' on' : ''), 'aria-label': 'Favorito', onclick: e => { e.stopPropagation(); likeTrack(tid); } }, icon(liked ? 'heart-f' : 'heart'))),
      h('div', { class: 'td' }, t.duration ? fmtTime(t.duration) : ''),
      h('div', { class: 'tx' }, h('button', { class: 'icon-btn tm', 'aria-label': 'Más', onclick: e => { e.stopPropagation(); trackMenu(e.currentTarget, tid, { inAlbum, extra }); } }, icon('more')))
    );
    if (playlist) {
      row.draggable = true;
      row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-idx', String(i)); e.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('drag-over'); });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', e => {
        e.preventDefault(); row.classList.remove('drag-over');
        const from = +e.dataTransfer.getData('text/x-idx'); if (isNaN(from) || from === i) return;
        const [x] = playlist.items.splice(from, 1); playlist.items.splice(from < i ? i - 1 : i, 0, x); playlist.updatedAt = Date.now(); emit('playlists');
      });
    }
    add(box, row);
  });
  return box;
}
function updatePlayingRows() {
  const cur = Pl.current();
  $$('.tr[data-tid]', main).forEach(r => {
    const on = cur && r.dataset.tid === cur.trackId;
    r.classList.toggle('playing', !!on);
    r.classList.toggle('paused', !!on && P.audio.paused);
  });
}
function loadingRow(text = 'Cargando…') { return h('div', { class: 'loading-row' }, h('span', { class: 'spinner' }), text); }
function emptyBox(ic, title, text, ...extra) { return h('div', { class: 'empty' }, icon(ic), h('h3', null, title), h('p', null, text), ...extra); }
function connectNotice(text) {
  return h('div', { class: 'notice' }, h('div', { class: 'grow' }, text),
    h('button', { class: 'btn small', onclick: connectModal }, 'Conectar khinsider'));
}

/* =========================================================
 * Descubrimiento de tops
 * ========================================================= */
const FALLBACK_TOPS = [
  { title: 'Top 40', url: KH + '/top40' },
  { title: 'Novedades', url: KH + '/' }
];
function topLinks() {
  const d = S().discover;
  const links = d && Array.isArray(d.links) && d.links.length ? d.links : FALLBACK_TOPS;
  return links.filter(l => typeof l.url === 'string' && l.url.startsWith(KH));
}
let discovering = null;
async function discover(force = false) {
  if (!canFetch()) return;
  const d = S().discover;
  if (!force && d && Date.now() - d.at < 6 * 3600e3) return;
  if (discovering) return discovering;
  discovering = (async () => {
    try {
      const r = await api.discover();
      const home = (r.home || []).map(St.upsertStub).filter(Boolean).map(s => s.id);
      const links = (r.links || []).filter(l => l && typeof l.title === 'string' && St.safeUrl(l.url).startsWith(KH)).map(l => ({ title: l.title.slice(0, 60), url: l.url }));
      S().discover = { links, home, at: Date.now() };
      emit('discover');
      // Trae las primeras listas de tops como selecciones para la portada
      const tops = links.filter(l => /top/i.test(l.title + l.url)).slice(0, 4);
      for (const l of tops) { try { await loadSelection(l.url, l.title); } catch {} }
    } catch (e) { console.warn('discover', e); }
    finally { discovering = null; }
  })();
  return discovering;
}
async function loadSelection(url, title) {
  const r = await api.list(url);
  const sel = St.upsertSelection({ title: title || r.title, url, items: r.items || [] }, { pinned: true });
  emit('selections');
  return sel;
}
async function openTop(l) {
  const ex = S().selections.find(s => s.url === l.url);
  if (ex) { go('/sel/' + ex.id); return; }
  if (!canFetch()) { openKhinsider(l.url); toast('Pulsa el marcador KH Player en la pestaña de khinsider'); return; }
  toast('Cargando ' + l.title + '…');
  try { const sel = await loadSelection(l.url, l.title); go('/sel/' + sel.id); }
  catch (e) { toast('No se pudo cargar: ' + e.message); }
}

/* =========================================================
 * Vistas
 * ========================================================= */
const views = {};
let renderToken = 0;

views.home = () => {
  const v = h('div', { class: 'view' }, h('h1', null, 'Inicio'));
  const hasData = Object.keys(S().stubs).length > 0;
  if (!isConnected()) {
    if (!hasData) {
      add(v, h('div', { class: 'hero' },
        h('h2', null, 'Bienvenido a KH Player'),
        h('p', null, 'Escucha las bandas sonoras de khinsider como en Apple Music: playlists, bucles A‑B de una parte de la canción, tops y búsqueda.'),
        h('p', null, 'khinsider bloquea a otras páginas, así que la app usa tu pestaña de khinsider como puente. No hay que instalar nada, solo guardar un marcador:'),
        ...connectSteps(true)));
    } else add(v, connectNotice('Conecta khinsider para buscar, actualizar los tops y abrir álbumes nuevos. Lo que ya está en tu biblioteca funciona igual.'));
  }
  // Seguir escuchando
  const rec = S().recents.slice(0, 12).map(r => {
    if (r.kind === 'album') return albumCard(r.id);
    if (r.kind === 'playlist') { const p = St.playlist(r.id); return p && playlistCard(p); }
    if (r.kind === 'selection') { const s = S().selections.find(x => x.id === r.id); return s && selectionCard(s); }
  }).filter(Boolean);
  add(v, shelf('Seguir escuchando', rec, '#/library/recent'));
  // Tops como selecciones
  const sels = S().selections.filter(s => s.pinned).slice(0, 6);
  sels.forEach(sel => add(v, shelf(sel.title, sel.items.slice(0, 20).map((id, i) => albumCard(id, { rank: /top/i.test(sel.title) ? i + 1 : null })), '#/sel/' + sel.id)));
  if (isConnected() && !sels.length) add(v, loadingRow('Cargando los tops de khinsider…'));
  const d = S().discover;
  if (d && d.home && d.home.length) add(v, shelf('Novedades en khinsider', d.home.slice(0, 24).map(id => albumCard(id))));
  add(v, shelf('Tus playlists', S().playlists.map(playlistCard), null));
  const hist = S().history.filter(id => S().tracks[id]).slice(0, 8);
  if (hist.length) add(v, h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, 'Escuchado recientemente')), trackList(hist, { showArt: true })));
  return v;
};

views.browse = () => {
  const v = h('div', { class: 'view' }, h('h1', null, 'Explorar'));
  if (!canFetch()) add(v, connectNotice('Conecta khinsider para cargar los tops actualizados. También puedes abrir cualquier lista en khinsider y pulsar el marcador para traerla.'));
  const tiles = h('div', { class: 'big-tiles' });
  topLinks().forEach(l => {
    const ex = S().selections.find(s => s.url === l.url);
    const arts = ex ? ex.items.slice(0, 4).map(albumArt).filter(Boolean) : [];
    tiles.append(h('button', { class: 'tile', style: 'background:' + phBg(l.title), onclick: () => openTop(l) },
      arts.length ? h('div', { class: 'mosaic' }, arts.map(a => h('img', { src: a, alt: '', loading: 'lazy' }))) : null,
      h('b', null, l.title), h('small', null, ex ? ex.items.length + ' álbumes' : 'khinsider')));
  });
  add(v, h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, 'Tops de khinsider'),
      canFetch() ? h('button', { class: 'link', onclick: async () => { toast('Actualizando…'); await discover(true); render(); } }, 'Actualizar') : null),
    tiles));
  const own = S().selections;
  add(v, h('section', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', null, 'Selecciones guardadas'),
      h('button', { class: 'link', onclick: addSelectionByUrl }, 'Añadir lista por URL')),
    own.length ? h('div', { class: 'grid' }, own.map(selectionCard)) : h('p', { class: 'muted' }, 'Aquí aparecen los tops y las listas de khinsider que abras (también las que envíes desde khinsider con el marcador).')));
  return v;
};
async function addSelectionByUrl() {
  const url = await ask('Lista de khinsider', '', { placeholder: 'https://downloads.khinsider.com/…', ok: 'Añadir' });
  if (!url) return;
  if (!St.safeUrl(url).startsWith(KH)) return toast('Debe ser un enlace de downloads.khinsider.com');
  openTop({ title: '', url: St.safeUrl(url) });
}

views.sel = async (id) => {
  const sel = S().selections.find(s => s.id === id);
  if (!sel) return emptyBox('grid', 'No encontrada', 'Esta selección ya no existe.');
  St.addRecent('selection', id); St.persist();
  const v = h('div', { class: 'view' },
    h('div', { class: 'view-head' }, h('h1', { style: 'margin:0;flex:1' }, sel.title)),
    h('p', { class: 'muted small' }, sel.items.length + ' álbumes · actualizado ' + new Date(sel.fetchedAt).toLocaleString()),
    h('div', { class: 'row-btns', style: 'margin-bottom:22px' },
      h('button', { class: 'btn', onclick: () => sel.items[0] && playAlbum(sel.items[0]) }, icon('play'), 'Reproducir el primero'),
      canFetch() && sel.url ? h('button', { class: 'btn soft', onclick: async () => { try { await loadSelection(sel.url, sel.title); toast('Actualizado'); } catch (e) { toast(e.message); } } }, icon('refresh'), 'Actualizar') : null,
      sel.url ? h('a', { class: 'btn soft', href: sel.url, target: '_blank', rel: 'noopener noreferrer' }, icon('ext'), 'khinsider') : null,
      h('button', { class: 'btn ghost', onclick: () => { sel.pinned = !sel.pinned; emit('selections'); toast(sel.pinned ? 'Se mostrará en Inicio' : 'Ya no se muestra en Inicio'); } }, sel.pinned ? 'Quitar de Inicio' : 'Mostrar en Inicio'),
      h('button', { class: 'btn ghost', onclick: async () => { if (await confirmBox('Eliminar selección', '¿Eliminar «' + sel.title + '»?')) { S().selections = S().selections.filter(s => s !== sel); emit('selections'); go('/browse'); } } }, 'Eliminar')),
    h('div', { class: 'grid' }, sel.items.map((aid, i) => albumCard(aid, { rank: /top/i.test(sel.title) ? i + 1 : null }))));
  return v;
};

views.album = async (id, token) => {
  const v = h('div', { class: 'view' });
  let al = S().albums[id];
  const stub = stubOf(id) || { id, title: id.replace(/-/g, ' '), url: KH + '/game-soundtracks/album/' + id };
  if (!al || !al.trackIds.length) {
    add(v, header(stub, null));
    if (!canFetch()) {
      add(v, h('div', { class: 'notice' }, h('div', { class: 'grow' }, 'Para ver las pistas, conecta khinsider o abre el álbum allí y pulsa el marcador.'),
        h('button', { class: 'btn small', onclick: () => { openKhinsider(stub.url); toast('Pulsa el marcador KH Player en khinsider'); } }, 'Abrir en khinsider'),
        h('button', { class: 'btn small soft', onclick: connectModal }, 'Cómo conectar')));
      return v;
    }
    add(v, loadingRow('Cargando pistas…'));
    ensureAlbum(id).then(() => { if (token === renderToken) render(); }).catch(e => {
      if (token !== renderToken) return;
      v.lastChild.replaceWith(h('div', { class: 'notice' }, h('div', { class: 'grow' }, 'No se pudo cargar: ' + e.message), h('button', { class: 'btn small', onclick: () => render() }, 'Reintentar')));
    });
    return v;
  }
  St.addRecent('album', id); St.persist();
  add(v, header(stub, al));
  add(v, trackList(al.trackIds, { inAlbum: true }));
  const total = al.trackIds.reduce((s, t) => s + ((S().tracks[t] || {}).duration || 0), 0);
  const m = al.meta || {};
  add(v, h('div', { class: 'foot-meta' },
    h('div', null, al.trackIds.length + ' canciones' + (total ? ', ' + fmtTotal(total) : '')),
    [['Plataformas', m.platforms], ['Año', m.year], ['Desarrollador', m.developer], ['Distribuidor', m.publisher], ['Catálogo', m.catalog], ['Tipo', m.type], ['Añadido', m.added]]
      .filter(x => x[1]).map(([k, val]) => h('div', null, k + ': ' + val))));
  return v;

  function header(st, al) {
    const meta = al ? [al.meta.platforms, al.meta.year, al.meta.type].filter(Boolean).join(' · ') : (st.info || []).join(' · ');
    const saved = S().saved.includes(id);
    return h('div', { class: 'detail-head' },
      art((al && al.cover) || st.thumb, st.title),
      h('div', { class: 'info' },
        h('h1', null, (al && al.title) || st.title),
        al && (al.meta.developer || al.meta.publisher) ? h('div', { class: 'sub' }, al.meta.developer || al.meta.publisher) : null,
        meta ? h('div', { class: 'meta' }, meta) : null,
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => playAlbum(id) }, icon('play'), 'Reproducir'),
          h('button', { class: 'btn soft', onclick: () => playAlbum(id, { shuffle: true }) }, icon('shuffle'), 'Aleatorio'),
          h('button', { class: 'icon-btn' + (saved ? ' on' : ''), title: saved ? 'En tu biblioteca' : 'Añadir a la biblioteca', onclick: () => saveAlbum(id) }, icon(saved ? 'check' : 'plus', 'lg')),
          al && canFetch() ? h('button', { class: 'icon-btn', title: 'Actualizar desde khinsider', onclick: async () => { try { await ensureAlbum(id, { force: true }); toast('Álbum actualizado'); } catch (e) { toast(e.message); } } }, icon('refresh', 'lg')) : null,
          h('button', { class: 'icon-btn', 'aria-label': 'Más', onclick: e => albumMenu(e.currentTarget, id) }, icon('more', 'lg')))));
  }
};

function playPlaylist(id, opts = {}) {
  const p = St.playlist(id); if (!p || !p.items.length) return toast('La playlist está vacía');
  St.addRecent('playlist', id); emit('recents');
  Pl.playList(p.items, opts.start || 0, { shuffle: !!opts.shuffle });
}
views.playlist = (id) => {
  const p = St.playlist(id);
  if (!p) return emptyBox('queue', 'Playlist no encontrada', 'Puede que se haya eliminado.');
  const total = p.items.reduce((s, it) => s + (it.seg ? it.seg.b - it.seg.a : ((S().tracks[it.trackId] || {}).duration || 0)), 0);
  const name = h('h1', { contenteditable: 'plaintext-only', spellcheck: 'false', title: 'Clic para renombrar' }, p.name);
  name.addEventListener('blur', () => { const n = name.textContent.trim(); if (n && n !== p.name) { p.name = n.slice(0, 120); emit('playlists'); } else name.textContent = p.name; });
  name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
  const desc = h('div', { class: 'desc', contenteditable: 'plaintext-only', 'data-ph': 'Añade una descripción' }, p.desc || '');
  desc.addEventListener('blur', () => { p.desc = desc.textContent.trim().slice(0, 1000); emit('playlists'); });
  const v = h('div', { class: 'view' },
    h('div', { class: 'detail-head' }, playlistCover(p),
      h('div', { class: 'info' }, name,
        h('div', { class: 'meta' }, 'Playlist · ' + p.items.length + ' canciones' + (total ? ' · ' + fmtTotal(total) : '')),
        desc,
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => playPlaylist(id) }, icon('play'), 'Reproducir'),
          h('button', { class: 'btn soft', onclick: () => playPlaylist(id, { shuffle: true }) }, icon('shuffle'), 'Aleatorio'),
          h('button', { class: 'icon-btn', 'aria-label': 'Más', onclick: e => showMenu(e.currentTarget, [
            { label: 'Añadir a la cola', icon: 'queue', fn: () => { Pl.addToQueue(p.items); toast('Añadido a la cola'); } },
            { label: 'Renombrar', icon: 'note', fn: async () => { const n = await ask('Renombrar playlist', p.name); if (n) { p.name = n; emit('playlists'); } } },
            { label: 'Duplicar', icon: 'plus', fn: () => { const c = St.createPlaylist(p.name + ' (copia)', p.items.map(i => ({ ...i }))); go('/playlist/' + c.id); } },
            { label: 'Exportar como texto', icon: 'dl', fn: () => exportPlaylistText(p) },
            '-',
            { label: 'Eliminar playlist', icon: 'x', danger: true, fn: async () => { if (await confirmBox('Eliminar playlist', '¿Eliminar «' + p.name + '»?')) { S().playlists = S().playlists.filter(x => x !== p); emit('playlists'); go('/home'); } } }
          ]) }, icon('more', 'lg'))))));
  if (!p.items.length) add(v, emptyBox('note', 'Playlist vacía', 'Añade canciones con el menú ⋯ de cualquier canción o álbum. También puedes añadir un fragmento con bucle desde el panel Bucle A‑B.'));
  else add(v, trackList(p.items.map(i => i.trackId), { showArt: true, playItems: p.items, playlist: p, segs: p.items.map(i => i.seg) }));
  return v;
};
function exportPlaylistText(p) {
  const lines = p.items.map((it, i) => { const t = S().tracks[it.trackId]; return `${i + 1}. ${t.title} — ${albumTitle(t.albumId)}${it.seg ? ` [${fmtTime(it.seg.a)}-${fmtTime(it.seg.b)}]` : ''}\n   ${t.pageUrl}`; });
  download(p.name + '.txt', p.name + '\n\n' + lines.join('\n'), 'text/plain');
}
function download(name, text, type = 'application/json') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name.replace(/[\\/:*?"<>|]/g, '_') });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const searchCache = new Map();
views.search = (_, token, params) => {
  const q = (params.get('q') || '').trim();
  const box = h('form', { class: 'search-big', onsubmit: e => { e.preventDefault(); go('/search?q=' + enc(inp.value.trim())); } }, icon('search'));
  const inp = h('input', { type: 'search', placeholder: 'Juegos, álbumes, canciones…', value: q, enterkeyhint: 'search' });
  add(box, inp);
  const v = h('div', { class: 'view' }, h('h1', null, q ? 'Resultados para «' + q + '»' : 'Buscar'), box);
  const sideInp = $('[data-search-form] input'); if (sideInp && document.activeElement !== sideInp) sideInp.value = q;
  if (!q) {
    add(v, h('p', { class: 'muted' }, 'Busca en tu biblioteca y en todo khinsider.'));
    if (!canFetch()) add(v, connectNotice('Para buscar en todo khinsider, conecta tu pestaña de khinsider.'));
    if (S().selections.length) add(v, h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, 'Selecciones')), h('div', { class: 'grid' }, S().selections.slice(0, 8).map(selectionCard))));
    return v;
  }
  const words = q.toLowerCase().split(/\s+/);
  const match = s => { s = String(s || '').toLowerCase(); return words.every(w => s.includes(w)); };
  // Local
  const localAlbums = Object.keys({ ...S().stubs, ...S().albums }).filter(id => match(albumTitle(id))).slice(0, 12);
  const localTracks = Object.values(S().tracks).filter(t => match(t.title + ' ' + albumTitle(t.albumId))).slice(0, 30).map(t => t.id);
  const localPl = S().playlists.filter(p => match(p.name));
  const remote = h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, 'En khinsider')));
  add(v, remote);
  if (!canFetch()) {
    add(remote, h('div', { class: 'notice' }, h('div', { class: 'grow' }, 'Conecta khinsider para buscar en todo el catálogo. También puedes buscar allí y pulsar el marcador para traer los resultados.'),
      h('button', { class: 'btn small', onclick: () => { openKhinsider('/search?search=' + enc(q)); toast('Pulsa el marcador KH Player en khinsider'); } }, 'Buscar en khinsider')));
  } else {
    const fill = items => {
      remote.lastChild.remove?.();
      add(remote, items.length ? h('div', { class: 'grid' }, items.map(id => albumCard(id))) : h('p', { class: 'muted' }, 'Sin resultados en khinsider.'));
    };
    add(remote, loadingRow('Buscando en khinsider…'));
    const cached = searchCache.get(q);
    (cached ? Promise.resolve(cached) : api.search(q).then(r => { const ids = (r.items || []).map(St.upsertStub).filter(Boolean).map(s => s.id); searchCache.set(q, ids); emit('stubs-silent'); return ids; }))
      .then(ids => { if (token === renderToken) fill(ids); })
      .catch(e => { if (token === renderToken) { remote.lastChild.remove(); add(remote, h('p', { class: 'muted' }, 'Error al buscar: ' + e.message)); } });
  }
  if (localAlbums.length) add(v, h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, 'En tu biblioteca y vistos')), h('div', { class: 'grid' }, localAlbums.map(id => albumCard(id)))));
  if (localTracks.length) add(v, h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, 'Canciones')), trackList(localTracks, { showArt: true })));
  if (localPl.length) add(v, h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, 'Playlists')), h('div', { class: 'grid' }, localPl.map(playlistCard))));
  return v;
};

views.library = (sub) => {
  const v = h('div', { class: 'view' });
  if (!sub) {
    add(v, h('h1', null, 'Biblioteca'));
    const nav = h('div', { class: 'tracks' });
    [['library/playlists', 'queue', 'Playlists'], ['library/albums', 'album', 'Álbumes'], ['library/songs', 'note', 'Canciones'], ['library/liked', 'heart', 'Favoritos'], ['library/loops', 'loop', 'Bucles'], ['library/recent', 'clock', 'Recientes'], ['settings', 'gear', 'Ajustes']]
      .forEach(([r, ic, l]) => add(nav, h('a', { class: 'tr', href: '#/' + r, style: 'grid-template-columns:36px 1fr;font-size:17px' }, h('span', { style: 'color:var(--accent)' }, icon(ic)), l)));
    add(v, nav);
    const recentSaved = S().saved.slice(0, 12);
    if (recentSaved.length) add(v, h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, 'Añadido recientemente')), h('div', { class: 'grid' }, recentSaved.map(id => albumCard(id)))));
    return v;
  }
  if (sub === 'playlists') {
    add(v, h('div', { class: 'view-head' }, h('h1', { style: 'flex:1;margin:0' }, 'Playlists'), h('button', { class: 'btn small', onclick: newPlaylist }, icon('plus'), 'Nueva')));
    add(v, S().playlists.length ? h('div', { class: 'grid', style: 'margin-top:18px' }, S().playlists.map(playlistCard)) : emptyBox('queue', 'Sin playlists', 'Crea una con el botón «Nueva».'));
  }
  if (sub === 'albums') {
    add(v, h('h1', null, 'Álbumes'));
    add(v, S().saved.length ? h('div', { class: 'grid' }, S().saved.map(id => albumCard(id))) : emptyBox('album', 'Tu biblioteca está vacía', 'Pulsa + en cualquier álbum para guardarlo aquí.'));
  }
  if (sub === 'songs') {
    const ids = [...new Set([...S().saved.flatMap(a => (S().albums[a] || {}).trackIds || []), ...S().liked])].filter(id => S().tracks[id]);
    ids.sort((a, b) => S().tracks[a].title.localeCompare(S().tracks[b].title));
    add(v, h('div', { class: 'view-head' }, h('h1', { style: 'flex:1;margin:0' }, 'Canciones'),
      ids.length ? h('button', { class: 'btn small', onclick: () => Pl.playList(ids.map(trackId => ({ trackId })), 0, { shuffle: true }) }, icon('shuffle'), 'Aleatorio') : null));
    add(v, h('p', { class: 'muted small' }, ids.length + ' canciones de tus álbumes guardados y favoritos'));
    add(v, ids.length ? trackList(ids, { showArt: true }) : emptyBox('note', 'Sin canciones', 'Guarda álbumes o marca canciones como favoritas.'));
  }
  if (sub === 'liked') {
    const ids = S().liked.filter(id => S().tracks[id]);
    add(v, h('div', { class: 'view-head' }, h('h1', { style: 'flex:1;margin:0' }, 'Favoritos'),
      ids.length ? h('button', { class: 'btn small', onclick: () => Pl.playList(ids.map(trackId => ({ trackId })), 0) }, icon('play'), 'Reproducir') : null,
      ids.length ? h('button', { class: 'btn small soft', onclick: () => Pl.playList(ids.map(trackId => ({ trackId })), 0, { shuffle: true }) }, icon('shuffle'), 'Aleatorio') : null));
    add(v, ids.length ? h('div', { style: 'margin-top:16px' }, trackList(ids, { showArt: true })) : emptyBox('heart', 'Sin favoritos', 'Toca el corazón de una canción para guardarla aquí.'));
    const la = S().likedAlbums;
    if (la.length) add(v, h('section', { class: 'section' }, h('div', { class: 'section-head' }, h('h2', null, 'Álbumes favoritos')), h('div', { class: 'grid' }, la.map(id => albumCard(id)))));
  }
  if (sub === 'loops') {
    add(v, h('h1', null, 'Bucles guardados'));
    const entries = Object.entries(S().loops).filter(([tid, arr]) => S().tracks[tid] && arr.length);
    if (!entries.length) add(v, emptyBox('loop', 'Sin bucles', 'Mientras escuchas, abre el panel Bucle A‑B, marca A y B y pulsa «Guardar bucle».'));
    entries.forEach(([tid, arr]) => {
      const t = S().tracks[tid];
      const sec = h('div', { class: 'loop-box' },
        h('div', { style: 'display:flex;gap:12px;align-items:center;cursor:pointer', onclick: () => go('/album/' + enc(t.albumId)) },
          art(albumArt(t.albumId), albumTitle(t.albumId), 'art', []), h('div', { style: 'min-width:0' }, h('div', { class: 'lt' }, t.title), h('div', { class: 'muted small' }, albumTitle(t.albumId)))));
      sec.firstChild.firstChild.style.cssText = 'width:44px;height:44px;border-radius:6px;overflow:hidden;position:relative;flex:none';
      arr.forEach(l => add(sec, savedLoopRow(tid, l)));
      add(v, sec);
    });
  }
  if (sub === 'recent') {
    add(v, h('h1', null, 'Recientes'));
    const cards = S().recents.map(r => r.kind === 'album' ? albumCard(r.id) : r.kind === 'playlist' ? (St.playlist(r.id) && playlistCard(St.playlist(r.id))) : (S().selections.find(s => s.id === r.id) && selectionCard(S().selections.find(s => s.id === r.id)))).filter(Boolean);
    add(v, cards.length ? h('div', { class: 'grid' }, cards) : emptyBox('clock', 'Nada todavía', 'Lo que abras aparecerá aquí.'));
  }
  return v;
};

views.settings = () => {
  const s = S().settings;
  const proxy = h('input', { class: 'field', type: 'text', placeholder: 'https://mi-proxy.example/?url={url}', value: s.proxy || '' });
  const fileIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async () => {
    const f = fileIn.files[0]; if (!f) return;
    try { St.importJSON(await f.text()); Pl.restore(); toast('Biblioteca importada'); render(); } catch (e) { toast('Error: ' + e.message); }
  } });
  const v = h('div', { class: 'view' }, h('h1', null, 'Ajustes'),
    h('div', { class: 'settings-card' }, h('h3', null, 'Conexión con khinsider'),
      h('p', null, 'downloads.khinsider.com está protegido por Cloudflare y no permite que otras webs lean sus páginas. Por eso la app no puede pedirle datos directamente desde GitHub Pages.'),
      h('p', null, 'La solución es un marcador (bookmarklet). Lo pulsas en una pestaña de khinsider abierta en tu navegador y esa pestaña hace de puente: lee las páginas con tu propia sesión y le pasa los datos a la app. Los MP3 se reproducen directo desde los servidores de khinsider.'),
      h('p', null, 'Estado: ', h('b', null, isConnected() ? 'conectado' : 'sin conexión')),
      ...connectSteps(),
      h('p', { class: 'small' }, 'En el móvil: copia el código, crea un marcador cualquiera y pega el código como su URL. En Chrome para Android, escribe el nombre del marcador en la barra de direcciones estando en khinsider y tócalo.')),
    h('div', { class: 'settings-card' }, h('h3', null, 'Proxy propio (opcional, avanzado)'),
      h('p', null, 'Si tienes un proxy CORS que khinsider no bloquee, la app puede usarlo cuando no hay pestaña conectada. Usa {url} donde va la dirección. Los proxies públicos suelen recibir el bloqueo de Cloudflare.'),
      proxy,
      h('div', { class: 'row-btns' }, h('button', { class: 'btn small', onclick: () => { s.proxy = St.safeUrl(proxy.value.replace('{url}', 'X')) ? proxy.value.trim() : ''; emit('settings'); toast(s.proxy ? 'Proxy guardado' : 'Proxy desactivado'); } }, 'Guardar'))),
    h('div', { class: 'settings-card' }, h('h3', null, 'Tus datos'),
      h('p', null, 'Todo (biblioteca, playlists, bucles) se guarda en este navegador. Exporta una copia para pasarla a otro dispositivo.'),
      h('div', { class: 'row-btns' },
        h('button', { class: 'btn small', onclick: () => download('kh-player-' + new Date().toISOString().slice(0, 10) + '.json', St.exportJSON()) }, icon('dl'), 'Exportar'),
        h('button', { class: 'btn small soft', onclick: () => fileIn.click() }, 'Importar…'), fileIn,
        h('button', { class: 'btn small ghost', onclick: async () => { if (await confirmBox('Borrar todo', 'Se borrarán biblioteca, playlists y bucles de este navegador.', 'Borrar')) { St.clearAll(); location.reload(); } } }, 'Borrar todo'))),
    h('div', { class: 'settings-card' }, h('h3', null, 'Atajos de teclado'),
      h('div', { class: 'shortcuts' }, [
        ['Espacio', 'Reproducir / pausar'], ['← / →', 'Retroceder / avanzar 5 s'], ['Shift + ← / →', 'Anterior / siguiente'],
        ['[', 'Marcar A'], [']', 'Marcar B'], ['L', 'Activar / desactivar bucle A‑B'], ['\\', 'Quitar bucle'],
        ['R', 'Repetir: no / todo / una'], ['S', 'Aleatorio'], ['Q', 'Cola'], ['F', 'Pantalla de reproducción'], ['/', 'Buscar'], ['↑ / ↓', 'Volumen']
      ].map(([k, d]) => [h('span', null, k.split(' ').map(x => /^[+/]$/.test(x) && k.length > 1 ? ' ' + x + ' ' : h('span', { class: 'kbd' }, x))), h('span', null, d)]))),
    h('p', { class: 'muted small' }, 'KH Player es un proyecto no oficial y no está afiliado a khinsider. La música pertenece a sus autores; apoya a los compositores comprando las bandas sonoras.'));
  return v;
};

async function newPlaylist() {
  const name = await ask('Nueva playlist', '', { placeholder: 'Nombre', ok: 'Crear' });
  if (name) { const p = St.createPlaylist(name); go('/playlist/' + p.id); }
}

/* =========================================================
 * Router
 * ========================================================= */
async function render() {
  const token = ++renderToken;
  let raw = location.hash.slice(1) || '/home';
  if (raw.startsWith('kh=')) return handleHashImport(raw.slice(3));
  if (raw === 'kh-connect') { history.replaceState(null, '', '#/home'); raw = '/home'; }
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const name = parts[0] || 'home';
  const params = new URLSearchParams(qs || '');
  let el;
  const scroll = main.dataset.route === raw ? main.scrollTop : 0;
  try {
    if (name === 'library') el = views.library(parts[1]);
    else if (views[name]) el = await views[name](parts[1], token, params);
    else el = views.home();
  } catch (e) { console.error(e); el = emptyBox('x', 'Algo salió mal', e.message); }
  if (token !== renderToken) return;
  main.replaceChildren(el);
  main.dataset.route = raw;
  main.scrollTop = scroll;
  // Navegación activa
  $$('[data-nav] a').forEach(a => {
    const r = a.dataset.r || '';
    const cur = parts.join('/');
    a.classList.toggle('active', !!r && (cur === r || (r === 'library' && name === 'library') || (r === name && !parts[1]) || (name === 'playlist' && a.dataset.pid === parts[1])));
  });
  updatePlayingRows();
}
let renderQueued = false;
function softRender() {
  if (renderQueued) return; renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; if (!document.activeElement || !document.activeElement.isContentEditable) render(); });
}

function handleHashImport(data) {
  let payload = null;
  try { payload = JSON.parse(decodeURIComponent(data)); } catch { }
  history.replaceState(null, '', '#/home');
  if (!importPayload(payload)) render();
}
function importPayload(p) {
  if (!p || typeof p !== 'object') return false;
  if (p.type === 'album' && p.album) {
    const al = St.upsertAlbum(p.album);
    if (!al) return false;
    emit('albums');
    toast('Álbum recibido: ' + al.title, { label: 'Guardar', fn: () => { if (!S().saved.includes(al.id)) saveAlbum(al.id); } });
    go('/album/' + enc(al.id));
    return true;
  }
  if (p.type === 'list' && p.list) {
    const sel = St.upsertSelection(p.list, { pinned: true });
    if (!sel) return false;
    emit('selections');
    toast('Lista recibida: ' + sel.title);
    go('/sel/' + sel.id);
    return true;
  }
  return false;
}
onImport(importPayload);

/* =========================================================
 * Sidebar
 * ========================================================= */
function renderSidebar() {
  const box = $('[data-side-playlists]');
  box.replaceChildren(...S().playlists.map(p => {
    const a = h('a', { href: '#/playlist/' + p.id, 'data-pid': p.id }, playlistCover(p, 'mini-art'), p.name);
    a.firstChild.style.position = 'relative'; a.firstChild.style.overflow = 'hidden';
    if (a.firstChild.classList.contains('mosaic')) a.firstChild.style.display = 'grid';
    return a;
  }));
  const c = $('.conn');
  c.classList.toggle('on', isConnected());
  $('[data-conn-label]').textContent = isConnected() ? 'Conectado a khinsider' : hasProxy() ? 'Usando proxy' : 'Conectar khinsider';
}

/* =========================================================
 * Barra de reproducción, pantalla completa y panel
 * ========================================================= */
function buildProgress(el) {
  el.replaceChildren(
    h('div', { class: 'rail' }, h('div', { class: 'buf' }), h('div', { class: 'fill' })),
    h('div', { class: 'region' }), h('div', { class: 'knob' }),
    h('div', { class: 'mk', 'data-mk': 'a', title: 'Arrastra para mover A' }, h('span', null, 'A')),
    h('div', { class: 'mk', 'data-mk': 'b', title: 'Arrastra para mover B' }, h('span', null, 'B')),
    h('div', { class: 'hover-t' }));
  const dur = () => P.audio.duration || (Pl.currentTrack() || {}).duration || 0;
  const tAt = x => { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)) * dur(); };
  let drag = null;
  el.addEventListener('pointerdown', e => {
    if (!dur()) return;
    const mk = e.target.closest('[data-mk]');
    drag = mk ? mk.dataset.mk : 'seek';
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    move(e);
  });
  const move = e => {
    const t = tAt(e.clientX);
    const ht = el.querySelector('.hover-t');
    ht.textContent = fmtPrecise(t); ht.style.left = (t / (dur() || 1) * 100) + '%';
    if (!drag) return;
    if (drag === 'seek') { el._preview = t; }
    else if (drag === 'a') { P.loop.a = Math.min(t, (P.loop.b ?? Infinity) - 0.05); Pl.P.loop.done = 0; }
    else if (drag === 'b') { P.loop.b = Math.max(t, (P.loop.a ?? 0) + 0.05); }
  };
  el.addEventListener('pointermove', move);
  const end = e => {
    if (!drag) return;
    if (drag === 'seek' && el._preview != null) Pl.seek(el._preview);
    el._preview = null; drag = null; el.classList.remove('dragging');
    updatePlayer(); renderPanel();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
const progEls = $$('[data-progress]');
progEls.forEach(buildProgress);
const miniProg = h('div', { class: 'mini-prog' });
$('[data-player]').append(miniProg);

function frame() {
  const a = P.audio;
  const d = a.duration || (Pl.currentTrack() || {}).duration || 0;
  progEls.forEach(el => {
    const t = el._preview ?? a.currentTime;
    const pct = d ? t / d * 100 : 0;
    el.querySelector('.fill').style.width = pct + '%';
    el.querySelector('.knob').style.left = pct + '%';
    let buf = 0; try { if (a.buffered.length) buf = a.buffered.end(a.buffered.length - 1); } catch { }
    el.querySelector('.buf').style.width = (d ? buf / d * 100 : 0) + '%';
    const L = P.loop;
    const hasA = L.a != null && d, hasB = L.b != null && d;
    el.classList.toggle('loop-on', !!(L.on && hasA && hasB));
    el.classList.toggle('loop-set', !!(!L.on && hasA && hasB));
    const mA = el.querySelector('[data-mk=a]'), mB = el.querySelector('[data-mk=b]');
    mA.classList.toggle('show', !!hasA); mB.classList.toggle('show', !!hasB);
    if (hasA) mA.style.left = (L.a / d * 100) + '%';
    if (hasB) mB.style.left = (L.b / d * 100) + '%';
    if (hasA && hasB) { const r = el.querySelector('.region'); r.style.left = (L.a / d * 100) + '%'; r.style.width = ((L.b - L.a) / d * 100) + '%'; }
  });
  miniProg.style.width = (d ? a.currentTime / d * 100 : 0) + '%';
  $$('[data-cur]').forEach(e => e.textContent = fmtTime(a.currentTime));
  $$('[data-dur]').forEach(e => e.textContent = d ? '-' + fmtTime(Math.max(0, d - a.currentTime)) : '0:00');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function setVolUI() {
  $$('[data-vol]').forEach(v => { v.value = P.audio.volume; v.style.setProperty('--p', (P.audio.volume * 100) + '%'); });
}
$$('[data-vol]').forEach(v => v.addEventListener('input', () => { Pl.setVolume(+v.value); setVolUI(); }));

function updatePlayer() {
  const t = Pl.currentTrack();
  const al = t && (S().albums[t.albumId] || {});
  const cover = t ? albumArt(t.albumId) : '';
  const title = t ? t.title : 'Nada en reproducción';
  [[$('[data-art]'), $('[data-art-ph]')], [$('[data-np-art]'), $('[data-np-ph]')]].forEach(([img, ph]) => {
    ph.style.background = phBg(t ? albumTitle(t.albumId) : '♪');
    ph.textContent = t ? initials(albumTitle(t.albumId)) : '♪';
    if (cover) { if (img.getAttribute('src') !== cover) { img.style.display = ''; img.src = cover; img.onerror = () => { img.style.display = 'none'; }; } }
    else { img.removeAttribute('src'); img.style.display = 'none'; }
  });
  $('[data-np-bg]').style.backgroundImage = cover ? `url("${cover.replace(/"/g, '%22')}")` : '';
  $('[data-title]').textContent = P.error && t ? t.title + ' — ' + P.error : title;
  $('[data-np-title]').textContent = title;
  [$('[data-sub]'), $('[data-np-sub]')].forEach(a => {
    a.textContent = t ? (al.title || albumTitle(t.albumId)) : '';
    if (t) a.href = '#/album/' + enc(t.albumId); else a.removeAttribute('href');
  });
  const playing = !P.audio.paused;
  $$('[data-playicon]').forEach(u => u.setAttribute('href', playing ? '#i-pause' : '#i-play'));
  $$('[data-act=toggle]').forEach(b => b.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir'));
  $$('[data-act=shuffle]').forEach(b => b.classList.toggle('on', P.shuffle));
  $$('[data-act=repeat]').forEach(b => b.classList.toggle('on', P.repeat !== 'off'));
  $$('[data-repeaticon]').forEach(u => u.setAttribute('href', P.repeat === 'one' ? '#i-repeat1' : '#i-repeat'));
  const liked = t && S().liked.includes(t.id);
  $$('[data-act=like-current]').forEach(b => { b.classList.toggle('on', !!liked); b.querySelector('use').setAttribute('href', liked ? '#i-heart-f' : '#i-heart'); });
  const L = P.loop;
  $$('.ab').forEach(b => b.classList.toggle('on', !!L.on));
  $$('[data-ab-badge]').forEach(b => b.textContent = 'A‑B');
  $('[data-a-time]').textContent = L.a != null ? fmtTime(L.a) : '—';
  $('[data-b-time]').textContent = L.b != null ? fmtTime(L.b) : '—';
  $('[data-loop-pill]').classList.toggle('on', !!L.on);
  $('[data-np-loop]').textContent = L.on && L.a != null && L.b != null ? '⟳ ' + fmtTime(L.a) + ' – ' + fmtTime(L.b) + (L.times ? ` (${L.done}/${L.times})` : '') : (P.repeat === 'one' ? '⟳ canción' : '');
  $('[data-np]').classList.toggle('paused', !playing);
  document.title = t ? (playing ? '▶ ' : '') + t.title + ' · KH Player' : 'KH Player';
  setVolUI();
  updatePlayingRows();
}

/* ---------- Panel lateral: Cola y Bucle ---------- */
const panel = $('[data-panel]');
let panelTab = 'queue';
function openPanel(tab) {
  if (!panel.hidden && panelTab === tab) { panel.hidden = true; return; }
  panelTab = tab; panel.hidden = false;
  renderPanel();
}
$$('[data-tab]').forEach(b => b.addEventListener('click', () => { panelTab = b.dataset.tab; renderPanel(); }));
function renderPanel() {
  if (panel.hidden) return;
  $$('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === panelTab)));
  const body = $('[data-panel-body]');
  const st = body.scrollTop;
  body.replaceChildren(panelTab === 'queue' ? queueView() : loopView());
  body.scrollTop = st;
}
function qItem(qi, orderPos, isCur) {
  const it = P.queue[qi]; const t = S().tracks[it.trackId]; if (!t) return null;
  const row = h('div', { class: 'q-item' + (isCur ? ' cur' : ''), onclick: () => Pl.jump(orderPos), draggable: isCur ? 'false' : 'true' },
    art(albumArt(t.albumId), albumTitle(t.albumId), 'art'),
    h('div', { class: 'm' }, h('div', null, t.title), h('small', null, albumTitle(t.albumId) + (it.seg ? ' · ⟳ ' + fmtTime(it.seg.a) + '–' + fmtTime(it.seg.b) : ''))),
    isCur ? null : h('button', { class: 'icon-btn sm', 'aria-label': 'Quitar', onclick: e => { e.stopPropagation(); Pl.removeFromQueue(orderPos); } }, icon('x')));
  if (!isCur) {
    row.addEventListener('dragstart', e => e.dataTransfer.setData('text/x-q', String(orderPos)));
    row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('drag-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', e => { e.preventDefault(); row.classList.remove('drag-over'); const f = +e.dataTransfer.getData('text/x-q'); if (!isNaN(f)) Pl.moveInQueue(f, f < orderPos ? orderPos - 1 : orderPos); });
  }
  return row;
}
function queueView() {
  const box = h('div');
  if (!P.queue.length) return emptyBox('queue', 'La cola está vacía', 'Reproduce un álbum o una playlist.');
  add(box, h('h4', null, 'Reproduciendo'), qItem(P.order[P.pos], P.pos, true));
  const up = P.order.slice(P.pos + 1);
  add(box, h('h4', null, h('span', null, 'A continuación' + (P.shuffle ? ' (aleatorio)' : '')),
    up.length ? h('button', { class: 'btn ghost small', onclick: Pl.clearUpcoming }, 'Borrar') : null));
  up.slice(0, 200).forEach((qi, k) => add(box, qItem(qi, P.pos + 1 + k, false)));
  if (!up.length) add(box, h('p', { class: 'muted small', style: 'padding:0 6px' }, P.repeat === 'all' ? 'Se repetirá desde el principio.' : 'No hay más canciones.'));
  const hist = P.order.slice(0, P.pos);
  if (hist.length) { add(box, h('h4', null, 'Anteriores')); hist.slice(-30).forEach((qi, k) => add(box, qItem(qi, P.pos - Math.min(30, hist.length) + k, false))); }
  return box;
}
function savedLoopRow(tid, l) {
  return h('div', { class: 'saved-loop' },
    h('button', { class: 'icon-btn', 'aria-label': 'Reproducir bucle', onclick: () => playLoop(tid, l) }, icon('play')),
    h('div', { class: 'm' }, h('div', null, l.name || 'Bucle'), h('small', null, fmtPrecise(l.a) + ' → ' + fmtPrecise(l.b) + ' · ' + fmtTime(l.b - l.a))),
    h('button', { class: 'icon-btn sm', 'aria-label': 'Más', onclick: e => showMenu(e.currentTarget, [
      { label: 'Reproducir bucle', icon: 'loop', fn: () => playLoop(tid, l) },
      { label: 'Añadir fragmento a playlist…', icon: 'plus', keep: true, fn: () => addToPlaylistMenu(e.target, () => [{ trackId: tid, seg: { a: l.a, b: l.b } }]) },
      { label: 'Renombrar', icon: 'note', fn: async () => { const n = await ask('Nombre del bucle', l.name); if (n != null) { l.name = n.slice(0, 80); emit('loops'); renderPanel(); } } },
      { label: 'Eliminar', icon: 'x', danger: true, fn: () => { S().loops[tid] = S().loops[tid].filter(x => x !== l); if (!S().loops[tid].length) delete S().loops[tid]; emit('loops'); renderPanel(); } }
    ]) }, icon('more')));
}
function loopView() {
  const t = Pl.currentTrack();
  if (!t) return emptyBox('loop', 'Bucle A‑B', 'Reproduce una canción para repetir una parte concreta o la canción entera.');
  const L = P.loop;
  const nud = w => h('div', { class: 'nud' }, ['-1', '-0.1', '+0.1', '+1'].map(d => h('button', { onclick: () => { Pl.nudge(w, +d); renderPanel(); } }, d)));
  const box = h('div');
  box.replaceChildren(
    h('div', { class: 'loop-box' },
      h('div', { class: 'lt' }, t.title), h('div', { class: 'muted small' }, albumTitle(t.albumId)),
      h('div', { class: 'ab-grid' },
        h('div', { class: 'ab-cell' }, h('div', { class: 'lbl' }, 'INICIO A'), h('div', { class: 'tm' }, L.a != null ? fmtPrecise(L.a) : '—'), nud('a'),
          h('button', { class: 'btn small', onclick: () => { Pl.setA(); renderPanel(); } }, 'Marcar A')),
        h('div', { class: 'ab-cell' }, h('div', { class: 'lbl' }, 'FIN B'), h('div', { class: 'tm' }, L.b != null ? fmtPrecise(L.b) : '—'), nud('b'),
          h('button', { class: 'btn small', onclick: () => { if (Pl.setB() === false) toast('B debe ir después de A'); renderPanel(); } }, 'Marcar B'))),
      h('label', { class: 'switch' }, h('span', null, h('b', null, 'Repetir de A a B'), h('br'), h('small', { class: 'muted' }, L.a != null && L.b != null ? 'Duración ' + fmtPrecise(L.b - L.a) : 'Marca A y B, o arrastra los marcadores de la barra')),
        h('input', { type: 'checkbox', checked: L.on, disabled: L.a == null || L.b == null, onchange: () => { Pl.toggleLoop(); renderPanel(); } })),
      h('div', { class: 'opt-grid' },
        h('label', null, h('span', { class: 'small muted' }, 'Repeticiones'),
          (() => { const s = h('select', { onchange: () => { P.loop.times = +s.value; P.loop.done = 0; updatePlayer(); } }, [0, 2, 3, 4, 5, 8, 10, 16].map(n => h('option', { value: n }, n ? n + ' veces' : 'Infinitas'))); s.value = L.times || 0; return s; })()),
        h('label', null, h('span', { class: 'small muted' }, 'Velocidad'),
          (() => { const s = h('select', { onchange: () => Pl.setRate(+s.value) }, [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2].map(n => h('option', { value: n }, n + '×'))); s.value = P.audio.playbackRate || 1; return s; })())),
      h('div', { class: 'loop-row' },
        h('button', { class: 'btn small', disabled: L.a == null || L.b == null, onclick: async () => {
          const n = await ask('Guardar bucle', 'Bucle ' + fmtTime(L.a) + '–' + fmtTime(L.b), { ok: 'Guardar' });
          if (n == null) return;
          (S().loops[t.id] ||= []).push({ id: St.uid(), name: n.slice(0, 80), a: L.a, b: L.b }); emit('loops'); renderPanel(); toast('Bucle guardado');
        } }, 'Guardar bucle'),
        h('button', { class: 'btn small soft', disabled: L.a == null || L.b == null, onclick: e => addToPlaylistMenu(e.currentTarget, () => [{ trackId: t.id, seg: { a: L.a, b: L.b } }]) }, 'Fragmento a playlist'),
        h('button', { class: 'btn small ghost', onclick: () => { Pl.clearLoop(); renderPanel(); } }, 'Quitar'))),
    h('div', { class: 'loop-box' },
      h('label', { class: 'switch' }, h('span', null, h('b', null, 'Repetir la canción entera'), h('br'), h('small', { class: 'muted' }, 'Igual que «Repetir una» en Apple Music')),
        h('input', { type: 'checkbox', checked: P.repeat === 'one', onchange: e => Pl.setRepeat(e.target.checked ? 'one' : 'off') }))),
    (S().loops[t.id] || []).length ? h('div', null, h('h4', null, 'Bucles guardados de esta canción'), S().loops[t.id].map(l => savedLoopRow(t.id, l))) : null,
    h('p', { class: 'muted small', style: 'padding:0 4px' }, 'Atajos: ', h('span', { class: 'kbd' }, '['), ' marca A, ', h('span', { class: 'kbd' }, ']'), ' marca B, ', h('span', { class: 'kbd' }, 'L'), ' activa o desactiva el bucle.')
  );
  return box;
}

/* ---------- Pantalla Reproduciendo ---------- */
const np = $('[data-np]');
function openNP() { if (!Pl.current()) return; np.hidden = false; updatePlayer(); }
function closeNP() { np.hidden = true; }

/* =========================================================
 * Eventos globales
 * ========================================================= */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const map = {
    toggle: Pl.toggle, next: () => Pl.next(), prev: Pl.prev,
    shuffle: () => Pl.setShuffle(!P.shuffle),
    repeat: Pl.cycleRepeat,
    'panel-queue': () => openPanel('queue'), 'panel-loop': () => openPanel('loop'),
    'close-panel': () => { panel.hidden = true; },
    nowplaying: openNP,
    'close-np': closeNP,
    'like-current': () => { const t = Pl.currentTrack(); if (t) likeTrack(t.id); },
    'more-current': () => { const t = Pl.currentTrack(); if (t) trackMenu(b, t.id); },
    'set-a': () => Pl.setA(), 'set-b': () => { if (Pl.setB() === false) toast('B debe ir después de A'); },
    'toggle-loop': () => { if (!Pl.toggleLoop()) toast('Marca primero A y B'); },
    'clear-loop': Pl.clearLoop,
    'new-playlist': newPlaylist,
    connect: connectModal
  };
  if (map[act]) { e.preventDefault(); map[act](); }
});
// En móvil, tocar el mini reproductor abre la pantalla completa
$('[data-player]').addEventListener('click', e => {
  if (matchMedia('(max-width: 860px)').matches && !e.target.closest('button,a,input')) openNP();
});
let sTimer;
$('[data-search-form]').addEventListener('submit', e => { e.preventDefault(); clearTimeout(sTimer); go('/search?q=' + enc(e.target.q.value.trim())); });
$('[data-search-form] input').addEventListener('input', e => {
  clearTimeout(sTimer);
  const q = e.target.value.trim();
  sTimer = setTimeout(() => {
    if (document.activeElement !== e.target) return;
    if (q.length >= 2 || (!q && location.hash.startsWith('#/search'))) go('/search?q=' + enc(q));
  }, 450);
});

document.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!modalLayer.hidden) return;
  const k = e.key;
  const a = P.audio;
  const acts = {
    ' ': Pl.toggle, 'k': Pl.toggle,
    'ArrowRight': () => e.shiftKey ? Pl.next() : Pl.seek(a.currentTime + 5),
    'ArrowLeft': () => e.shiftKey ? Pl.prev() : Pl.seek(a.currentTime - 5),
    'ArrowUp': () => { Pl.setVolume(a.volume + 0.05); setVolUI(); },
    'ArrowDown': () => { Pl.setVolume(a.volume - 0.05); setVolUI(); },
    '[': () => { Pl.setA(); toast('A en ' + fmtPrecise(P.loop.a)); renderPanel(); },
    ']': () => { if (Pl.setB() === false) toast('B debe ir después de A'); else toast('Bucle ' + fmtPrecise(P.loop.a) + ' → ' + fmtPrecise(P.loop.b)); renderPanel(); },
    'l': () => { if (!Pl.toggleLoop()) toast('Marca primero A y B'); else toast(P.loop.on ? 'Bucle activado' : 'Bucle desactivado'); renderPanel(); },
    '\\': () => { Pl.clearLoop(); renderPanel(); },
    'r': Pl.cycleRepeat, 's': () => Pl.setShuffle(!P.shuffle),
    'q': () => openPanel('queue'), 'f': () => (np.hidden ? openNP() : closeNP()),
    '/': () => { const i = matchMedia('(max-width: 860px)').matches ? null : $('[data-search-form] input'); if (i) i.focus(); else go('/search'); },
    'Escape': () => { if (!menuLayer.hidden) closeMenu(); else if (!np.hidden) closeNP(); else panel.hidden = true; }
  };
  const fn = acts[k] || acts[k.toLowerCase()];
  if (fn) { e.preventDefault(); fn(); }
});

/* =========================================================
 * Arranque
 * ========================================================= */
let lastPlayerSig = '';
Pl.onChange(() => {
  updatePlayer();
  const sig = [Pl.current() && Pl.current().key, P.queue.length, P.pos, P.shuffle, P.repeat, P.loop.on, P.loop.a, P.loop.b, P.loop.times].join('|');
  if (sig !== lastPlayerSig) { lastPlayerSig = sig; renderPanel(); }
});
St.on(what => {
  renderSidebar();
  if (what === 'history' || what === 'tracks' || what === 'stubs-silent') return;
  const r = main.dataset.route || '';
  if (what === 'recents' && !r.startsWith('/home') && !r.startsWith('/library')) return;
  softRender();
  updatePlayer();
});
onState(on => {
  renderSidebar();
  toast(on ? 'Conectado a khinsider' : 'Se perdió la conexión con khinsider');
  if (on) discover();
  render();
});
window.addEventListener('hashchange', () => { closeMenu(); if (!np.hidden && !location.hash.startsWith('#kh')) closeNP(); render(); });
window.addEventListener('resize', closeMenu);
main.addEventListener('scroll', closeMenu, { passive: true });

Pl.restore();
renderSidebar();
updatePlayer();
render();
