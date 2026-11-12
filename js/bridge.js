/* Puente: se ejecuta como marcador (bookmarklet) dentro de una pestaña de
 * downloads.khinsider.com, es decir, en el navegador real del usuario.
 * Lee la página donde está y, si el reproductor está conectado, atiende sus
 * peticiones (buscar, abrir álbum, resolver MP3) con fetch del mismo origen.
 * __APP_URL__ lo reemplaza el reproductor al generar el marcador. */
(function () {
  var APP_URL = '__APP_URL__';
  var APP_ORIGIN = new URL(APP_URL).origin;
  var P = KHParse;
  if (!/(^|\.)khinsider\.com$/.test(location.hostname)) {
    alert('Este marcador se usa en una pestaña de downloads.khinsider.com.\n\nSe abrirá khinsider; pulsa el marcador otra vez allí.');
    location.href = 'https://downloads.khinsider.com/';
    return;
  }
  if (window.__khBridge) { window.__khBridge.show(); return; }

  var appWin = null, connected = false, helloTimer = null, lastSeen = 0;
  var cache = {};

  /* ---------- Panel ---------- */
  var host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;';
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  root.innerHTML =
    '<style>' +
    '.p{font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;width:300px;max-width:calc(100vw - 32px);background:rgba(28,28,30,.96);color:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.45);padding:14px 16px;box-sizing:border-box}' +
    '.h{display:flex;align-items:center;gap:8px;font-weight:700;margin-bottom:6px}' +
    '.d{width:9px;height:9px;border-radius:50%;background:#8e8e93;flex:none}.d.on{background:#30d158}' +
    '.x{margin-left:auto;background:none;border:0;color:#8e8e93;font-size:20px;cursor:pointer;line-height:1}' +
    '.s{color:#c7c7cc;font-size:13px;margin:4px 0 10px;word-wrap:break-word}' +
    '.b{display:block;width:100%;border:0;border-radius:10px;padding:10px;font:600 14px/1 inherit;font-family:inherit;cursor:pointer;margin-top:8px;background:#fa2d48;color:#fff}' +
    '.b.g{background:#3a3a3c}.b:disabled{opacity:.5;cursor:default}' +
    '.bar{height:4px;background:#3a3a3c;border-radius:2px;overflow:hidden;margin-top:8px;display:none}.bar i{display:block;height:100%;width:0;background:#fa2d48;transition:width .2s}' +
    '.pk{display:none;margin-top:10px;padding-top:10px;border-top:1px solid #3a3a3c}.pk label{display:flex;align-items:center;gap:8px;font-size:13px;color:#c7c7cc}' +
    '.pk select{background:#3a3a3c;color:#fff;border:0;border-radius:8px;padding:6px 8px;font:inherit}' +
    '.n{font-size:12px;color:#8e8e93;margin-top:8px}' +
    '</style>' +
    '<div class="p"><div class="h"><span class="d"></span><span>KH Player</span><button class="x" title="Ocultar">×</button></div>' +
    '<div class="s">Analizando la página…</div><div class="bar"><i></i></div>' +
    '<div class="pk"><label>Preparar <select data-a="count"></select> álbumes para escuchar en la app</label>' +
    '<button class="b" data-a="pack">Preparar y abrir</button></div>' +
    '<button class="b" data-a="send" disabled>Abrir en el reproductor</button>' +
    '<button class="b g" data-a="cancel" style="display:none">Cancelar</button>' +
    '<div class="n" data-a="note"></div>' +
    '</div>';
  document.documentElement.appendChild(host);
  var $s = root.querySelector('.s'), $d = root.querySelector('.d'), $bar = root.querySelector('.bar'), $bi = root.querySelector('.bar i');
  var $send = root.querySelector('[data-a=send]'), $pk = root.querySelector('.pk'), $pack = root.querySelector('[data-a=pack]');
  var $count = root.querySelector('[data-a=count]'), $cancel = root.querySelector('[data-a=cancel]'), $note = root.querySelector('[data-a=note]');
  root.querySelector('.x').onclick = function () { host.style.display = 'none'; };
  function status(t) { $s.textContent = t; }
  function progress(f) { $bar.style.display = f == null ? 'none' : 'block'; $bi.style.width = Math.round((f || 0) * 100) + '%'; }
  function setConnected(on) {
    connected = on;
    $d.className = 'd' + (on ? ' on' : '');
    if (on) {
      $note.textContent = 'Conectado: deja esta pestaña abierta, el reproductor la usa para buscar y abrir álbumes.';
      if (payload && $cancel.style.display === 'none') $send.disabled = false;
    }
  }

  /* ---------- Red (mismo origen, sesión del usuario) ---------- */
  function getDoc(path) {
    var u = new URL(path, location.origin);
    if (u.origin !== location.origin) return Promise.reject(new Error('Origen no permitido'));
    var key = u.pathname + u.search;
    if (cache[key] && Date.now() - cache[key].t < 10 * 60 * 1000) return Promise.resolve(cache[key].v);
    return fetch(u.href, { credentials: 'include' }).then(function (r) {
      return r.text().then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        if (P.isChallenge(doc)) throw new Error('challenge');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var v = { doc: doc, html: html, url: r.url || u.href };
        cache[key] = { t: Date.now(), v: v };
        return v;
      });
    });
  }
  function resolveTrack(pageUrl) {
    return getDoc(pageUrl).then(function (x) { return P.parseTrack(x.doc, x.html); });
  }
  var cancelled = false;
  function resolveAll(tracks, onProg) {
    var i = 0, done = 0, N = tracks.length, C = 4;
    return new Promise(function (res) {
      if (!N) return res(tracks);
      function next() {
        if (i >= N) return;
        if (cancelled) { done += N - i; i = N; return res(tracks); }
        var t = tracks[i++];
        resolveTrack(t.pageUrl).then(function (r) { t.src = r.src; if (r.flac) t.flac = r.flac; })
          .catch(function () {})
          .then(function () { done++; onProg && onProg(done / N); if (done === N) res(tracks); else next(); });
      }
      for (var k = 0; k < Math.min(C, N); k++) next();
    });
  }
  function albumFromTrackUrl(url) {
    var p = new URL(url).pathname.split('/');
    return location.origin + p.slice(0, 4).join('/');
  }

  var handlers = {
    album: function (a) {
      return getDoc(a.url).then(function (x) { return P.parseAlbum(x.doc, x.url); });
    },
    list: function (a) {
      return getDoc(a.url).then(function (x) {
        if (P.detect(x.doc, x.url) === 'album') { var al = P.parseAlbum(x.doc, x.url); return { title: al.title, items: [{ id: al.id, url: al.url, title: al.title, thumb: al.cover, info: [] }] }; }
        return { title: (x.doc.querySelector('h2') || {}).textContent || x.doc.title, items: P.parseList(x.doc, x.url) };
      });
    },
    search: function (a) {
      return handlers.list({ url: '/search?search=' + encodeURIComponent(a.q || '') });
    },
    track: function (a) { return resolveTrack(a.url); },
    discover: function () {
      return getDoc('/').then(function (x) { return { links: P.parseTopLinks(x.doc, x.url), home: P.parseList(x.doc, x.url).slice(0, 60) }; });
    },
    ping: function () { return Promise.resolve('pong'); }
  };

  /* ---------- Mensajes ---------- */
  window.addEventListener('message', function (ev) {
    if (ev.origin !== APP_ORIGIN) return;
    var m = ev.data;
    if (!m || m.kh !== 1) return;
    lastSeen = Date.now();
    if (m.type === 'welcome') {
      if (!appWin) appWin = ev.source;
      clearInterval(helloTimer);
      setConnected(true);
      return;
    }
    if (m.type === 'req' && handlers[m.cmd]) {
      var src = ev.source;
      handlers[m.cmd](m.args || {}).then(function (data) {
        src.postMessage({ kh: 1, type: 'res', id: m.id, ok: true, data: data }, APP_ORIGIN);
      }, function (err) {
        src.postMessage({ kh: 1, type: 'res', id: m.id, ok: false, error: String(err && err.message || err) }, APP_ORIGIN);
      });
    }
  });
  function hello(win) {
    if (!win) return;
    clearInterval(helloTimer);
    var n = 0;
    helloTimer = setInterval(function () {
      if (connected || n++ > 30 || win.closed) { clearInterval(helloTimer); return; }
      try { win.postMessage({ kh: 1, type: 'hello', page: location.href }, APP_ORIGIN); } catch (e) {}
    }, 500);
  }

  /* ---------- Página actual ---------- */
  var kind = P.detect(document, location.href);
  var payload = null, payloadHref = '', listItems = [];
  var MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // Codifica los datos en la URL del reproductor (comprimidos si se puede).
  function b64url(buf) {
    var bytes = new Uint8Array(buf), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function encode(p) {
    var json = JSON.stringify(p);
    if (!window.CompressionStream) return Promise.resolve('#kh=' + encodeURIComponent(json));
    try {
      var stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Response(stream).arrayBuffer().then(function (buf) { return '#khz=' + b64url(buf); },
        function () { return '#kh=' + encodeURIComponent(json); });
    } catch (e) { return Promise.resolve('#kh=' + encodeURIComponent(json)); }
  }
  // Fija lo que se enviará y deja el botón listo cuando la URL está calculada
  // (window.open debe llamarse justo al tocar, sin esperas, o el navegador lo bloquea).
  function setPayload(p, label) {
    payload = p; payloadHref = '';
    $send.disabled = !connected;
    $send.textContent = label || 'Abrir en el reproductor';
    encode(p).then(function (href) { if (payload === p) { payloadHref = href; $send.disabled = false; } });
  }
  function busy(on) {
    $cancel.style.display = on ? 'block' : 'none';
    $pack.disabled = on;
    if (on) $send.disabled = true;
  }
  var ready = function (tracks) { return tracks.filter(function (t) { return t.src; }).length; };

  function prepareAlbum(al) {
    status('Álbum: ' + al.title + ' (' + al.tracks.length + ' pistas). Preparando audio…');
    payload = { type: 'album', album: al };
    $send.disabled = !connected;
    $send.textContent = connected ? 'Abrir en el reproductor' : 'Preparando audio…';
    progress(0); busy(true); cancelled = false;
    return resolveAll(al.tracks, function (f) {
      progress(f);
      if (!connected) $send.textContent = 'Preparando audio… ' + Math.round(f * 100) + '%';
    }).then(function () {
      progress(null); busy(false);
      status('Álbum: ' + al.title + ' — ' + ready(al.tracks) + '/' + al.tracks.length + ' pistas listas para escuchar.');
      setPayload({ type: 'album', album: al });
    });
  }

  // Prepara varios álbumes de una lista (tops, búsqueda) con sus MP3,
  // para poder escucharlos en la app sin mantener esta pestaña conectada.
  function packList(n) {
    var items = listItems.slice(0, n), albums = [], idx = 0;
    cancelled = false; busy(true); progress(0);
    function step() {
      if (cancelled || idx >= items.length) return Promise.resolve();
      var it = items[idx];
      status('Álbum ' + (idx + 1) + '/' + items.length + ': ' + it.title);
      return getDoc(it.url).then(function (x) {
        var al = P.parseAlbum(x.doc, x.url);
        if (!al.cover && it.thumb) al.cover = it.thumb;
        return resolveAll(al.tracks, function (f) { progress((idx + f) / items.length); }).then(function () { albums.push(al); });
      }).catch(function (e) {
        if (e && e.message === 'challenge') { cancelled = true; status('khinsider pidió verificar que eres una persona. Recarga esta página y vuelve a pulsar el marcador.'); }
      }).then(function () { idx++; return step(); });
    }
    return step().then(function () {
      busy(false); progress(null);
      var tracks = albums.reduce(function (s, a) { return s + ready(a.tracks); }, 0);
      if (!albums.length) { if (!cancelled) status('No pude preparar ningún álbum.'); return; }
      status((cancelled ? 'Cancelado. ' : '') + albums.length + ' álbumes y ' + tracks + ' canciones listos. Toca el botón para abrirlos en la app.');
      setPayload({ type: 'bundle', list: payload.list, albums: albums }, 'Abrir en el reproductor (' + albums.length + ' álbumes)');
    });
  }

  function prepare() {
    if (kind === 'album' || kind === 'track') {
      var p = kind === 'track' ? getDoc(albumFromTrackUrl(location.href)).then(function (x) { return P.parseAlbum(x.doc, x.url); })
        : Promise.resolve(P.parseAlbum(document, location.href));
      return p.then(prepareAlbum);
    }
    listItems = P.parseList(document, location.href);
    var h = document.querySelector('#pageContent h2, h2');
    var title = (h && h.textContent.trim()) || document.title.replace(/\s*-\s*Khinsider.*$/i, '');
    if (location.pathname === '/search') title = 'Búsqueda: ' + (new URL(location.href).searchParams.get('search') || '');
    var list = { title: title, url: location.href, items: listItems };
    status(listItems.length ? 'Lista: ' + title + ' (' + listItems.length + ' álbumes)' : 'No encontré álbumes en esta página, pero puedes conectar el reproductor.');
    if (listItems.length) {
      var opts = [5, 10, 20, 40, 100].filter(function (n) { return n < listItems.length; }).concat([listItems.length]);
      $count.innerHTML = '';
      opts.forEach(function (n) { var o = document.createElement('option'); o.value = n; o.textContent = n === listItems.length ? 'todos (' + n + ')' : n; $count.appendChild(o); });
      $count.value = String(opts.filter(function (n) { return n <= 10; }).pop() || opts[0]);
      $pk.style.display = 'block';
      $note.textContent = MOBILE ? 'En el móvil conviene «Preparar y abrir»: la app recibe los álbumes con su audio y no depende de esta pestaña.' : '';
    }
    setPayload({ type: 'list', list: list }, 'Abrir solo la lista');
    return Promise.resolve();
  }

  function openApp(p) {
    if (pushToApp(p)) {
      try { appWin.focus(); } catch (e) {}
      status('Enviado al reproductor.');
      return;
    }
    var url = APP_URL + (p ? (payloadHref || '#kh=' + encodeURIComponent(JSON.stringify(p))) : '#kh-connect');
    var w = window.open(url, 'khplayer');
    if (!w) { location.href = url; return; }
    appWin = w;
    hello(w);
  }

  function pushToApp(p) {
    if (connected && appWin && !appWin.closed) {
      try { appWin.postMessage({ kh: 1, type: 'import', payload: p }, APP_ORIGIN); return true; } catch (e) {}
    }
    return false;
  }

  $send.onclick = function () { if (payload) openApp(payload); };
  $pack.onclick = function () { packList(+$count.value || 10); };
  $cancel.onclick = function () { cancelled = true; status('Cancelando…'); };
  // Si esta pestaña la abrió el reproductor, conéctate de inmediato.
  try { if (window.opener && !window.opener.closed) { appWin = window.opener; hello(appWin); } } catch (e) {}

  prepare().catch(function (e) { busy(false); status('No pude leer la página: ' + e.message); });

  window.__khBridge = { show: function () { host.style.display = ''; } };
})();
