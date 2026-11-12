/* KHParse: lectores de HTML de downloads.khinsider.com.
 * Script clásico (no módulo) porque también se concatena dentro del marcador.
 * Se basa en patrones de enlaces y no en clases CSS concretas, para resistir
 * cambios de diseño del sitio. */
var KHParse = (function () {
  var ALBUM_RE = /^\/game-soundtracks\/album\/([^\/?#]+)\/?$/;
  var TRACK_RE = /^\/game-soundtracks\/album\/([^\/?#]+)\/([^\/?#]+\.(?:mp3|flac|ogg|m4a))$/i;
  var TIME_RE = /^\d{1,3}:\d{2}(?::\d{2})?$/;
  var SIZE_RE = /^[\d.,]+\s*(?:KB|MB|GB|B)$/i;
  var AUDIO_RE = /https?:\/\/[^"'<>\s]+?\.(mp3|flac|ogg|m4a)(?=["'<>\s?#]|$)/gi;

  function abs(u, base) {
    if (!u) return null;
    try { return new URL(u, base); } catch (e) { return null; }
  }
  function txt(el) { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  // Texto sin iconos (<i class="material-icons">get_app</i>, svg…)
  function linkText(a) {
    var c = a.cloneNode(true);
    var ic = c.querySelectorAll('i, svg, .material-icons, img');
    for (var k = 0; k < ic.length; k++) ic[k].remove();
    return txt(c);
  }
  function dec(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  function imgSrc(img, base) {
    if (!img) return '';
    var s = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('src') || '';
    var u = abs(s, base);
    return u && /^https?:$/.test(u.protocol) ? u.href : '';
  }
  function isChallenge(doc) {
    var t = doc.title || '';
    return /just a moment|attention required|cloudflare/i.test(t) && !doc.querySelector('a[href*="/game-soundtracks/album/"]');
  }
  function toSeconds(s) {
    if (!s || !TIME_RE.test(s)) return 0;
    return s.split(':').reduce(function (acc, p) { return acc * 60 + parseInt(p, 10); }, 0);
  }

  /* Lista de álbumes (tops, búsqueda, portada, etc.) */
  function parseList(doc, baseUrl) {
    var base = baseUrl || (doc.location && doc.location.href) || 'https://downloads.khinsider.com/';
    var origin = new URL(base).origin;
    var map = new Map();
    var links = doc.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var u = abs(a.getAttribute('href'), base);
      if (!u || u.origin !== origin) continue;
      var m = u.pathname.match(ALBUM_RE);
      if (!m) continue;
      var id = dec(m[1]);
      var e = map.get(id);
      if (!e) { e = { id: id, url: origin + '/game-soundtracks/album/' + m[1], title: '', thumb: '', info: [], order: map.size }; map.set(id, e); }
      var t = linkText(a);
      if (t.length > e.title.length && t.length < 300) e.title = t;
      var img = a.querySelector('img');
      if (img && !e.thumb) e.thumb = imgSrc(img, base);
      var row = a.closest('tr') || a.closest('li') || a.closest('.albumListItem') || null;
      if (row) {
        if (!e.thumb) { var ri = row.querySelector('img'); if (ri) e.thumb = imgSrc(ri, base); }
        if (!e.row && row.tagName === 'TR') e.row = row;
      }
    }
    var out = [];
    map.forEach(function (e) {
      if (!e.title) e.title = e.id.replace(/-/g, ' ');
      if (e.row) {
        var cells = e.row.querySelectorAll('td');
        for (var c = 0; c < cells.length; c++) {
          var ct = txt(cells[c]);
          if (ct && ct !== e.title && ct.length < 60 && !/^\d{1,3}\.?$/.test(ct)) e.info.push(ct);
        }
        e.info = e.info.slice(0, 4);
      }
      delete e.row;
      e.info = e.info.filter(function (x) { return x !== e.title; });
      delete e.order;
      out.push(e);
    });
    return out;
  }

  function metaFromText(text) {
    var meta = {};
    var keys = [
      ['platforms', /Platforms?:\s*([^\n]+)/i],
      ['year', /Year:\s*(\d{4})/i],
      ['developer', /Developed by:\s*([^\n]+)/i],
      ['publisher', /Published by:\s*([^\n]+)/i],
      ['catalog', /Catalog(?:\s*Number)?:\s*([^\n]+)/i],
      ['type', /Album type:\s*([^\n]+)/i],
      ['files', /Number of Files:\s*([^\n]+)/i],
      ['size', /Total Filesize:\s*([^\n]+)/i],
      ['added', /Date Added:\s*([^\n]+)/i]
    ];
    keys.forEach(function (k) {
      var m = text.match(k[1]);
      if (m) meta[k[0]] = m[1].replace(/\s+/g, ' ').trim().slice(0, 200);
    });
    return meta;
  }

  /* Página de álbum */
  function parseAlbum(doc, baseUrl) {
    var base = baseUrl || (doc.location && doc.location.href);
    var bu = new URL(base);
    var origin = bu.origin;
    var am = bu.pathname.match(ALBUM_RE);
    var slugRaw = am ? am[1] : null;
    var content = doc.querySelector('#pageContent') || doc.querySelector('#EchoTopic') || doc.body;

    var title = txt(content.querySelector('h2')) || txt(doc.querySelector('h2'));
    if (!title) title = (doc.title || '').replace(/\s*(MP3|FLAC)?\s*-\s*Download.*$/i, '').trim();

    // Tracks
    var tracks = new Map();
    var links = content.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var u = abs(a.getAttribute('href'), base);
      if (!u || u.origin !== origin) continue;
      var m = u.pathname.match(TRACK_RE);
      if (!m) continue;
      if (!slugRaw) slugRaw = m[1];
      if (m[1] !== slugRaw) continue;
      var key = u.pathname;
      var r = tracks.get(key);
      if (!r) { r = { pageUrl: origin + u.pathname, file: m[2], texts: [], row: a.closest('tr') }; tracks.set(key, r); }
      var t = linkText(a);
      if (t) r.texts.push(t);
    }
    var slug = slugRaw ? dec(slugRaw) : bu.pathname;
    var list = [];
    var n = 0;
    tracks.forEach(function (r) {
      n++;
      var name = '', dur = '', num = 0, cd = 0;
      r.texts.forEach(function (t) {
        if (TIME_RE.test(t)) { if (!dur) dur = t; }
        else if (SIZE_RE.test(t)) { /* tamaño */ }
        else if (!name && !/^(download|get|mp3|flac)$/i.test(t)) name = t;
      });
      if (r.row) {
        var cells = r.row.querySelectorAll('td');
        var nums = [];
        for (var c = 0; c < cells.length; c++) {
          var ct = txt(cells[c]);
          if (/^\d{1,4}\.?$/.test(ct)) nums.push(parseInt(ct, 10));
          else if (!dur && TIME_RE.test(ct)) dur = ct;
          var cr = cells[c].className || '';
          if (!name && /clickable-row/.test(cr) && ct && !TIME_RE.test(ct) && !SIZE_RE.test(ct)) name = ct;
        }
        if (nums.length >= 2) { cd = nums[0]; num = nums[1]; }
        else if (nums.length === 1) num = nums[0];
      }
      if (!name) name = dec(r.file).replace(/\.[a-z0-9]+$/i, '').replace(/^\d+[\s._-]+/, '');
      list.push({
        id: slug + '/' + dec(r.file),
        title: name,
        num: num || n,
        cd: cd || 0,
        duration: toSeconds(dur),
        pageUrl: r.pageUrl,
        src: ''
      });
    });

    // Portadas
    var covers = [];
    var imgs = content.querySelectorAll('img');
    for (var j = 0; j < imgs.length; j++) {
      var im = imgs[j];
      var s = imgSrc(im, base);
      if (!s) continue;
      var inAlbumImage = !!im.closest('.albumImage');
      var hostOk = /vgmtreasurechest|vgmsite|khinsider\.(?:info|com)\/soundtracks|\/soundtracks\//i.test(s);
      if (!inAlbumImage && !hostOk) continue;
      if (slugRaw && !inAlbumImage && s.indexOf(slugRaw) === -1 && s.indexOf(slug) === -1) continue;
      var full = s;
      var pa = im.closest('a');
      if (pa) {
        var fu = abs(pa.getAttribute('href'), base);
        if (fu && /\.(jpe?g|png|gif|webp)$/i.test(fu.pathname)) full = fu.href;
      }
      if (covers.indexOf(full) === -1) covers.push(full);
    }

    // Metadatos
    var html = content.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n');
    var tmp = doc.createElement('div');
    tmp.innerHTML = html;
    var meta = metaFromText(tmp.textContent || '');

    return {
      id: slug,
      url: origin + '/game-soundtracks/album/' + (slugRaw || ''),
      title: title,
      cover: covers[0] || '',
      covers: covers.slice(0, 12),
      meta: meta,
      tracks: list
    };
  }

  /* Página de una pista: devuelve URL directa del audio */
  function parseTrack(doc, html) {
    var audio = doc && doc.querySelector('audio#audio, audio');
    var cand = [];
    if (audio) {
      var s = audio.getAttribute('src') || (audio.querySelector('source') && audio.querySelector('source').getAttribute('src'));
      if (s) cand.push(s);
    }
    var raw = html || (doc && doc.documentElement ? doc.documentElement.outerHTML : '');
    var m; AUDIO_RE.lastIndex = 0;
    while ((m = AUDIO_RE.exec(raw))) cand.push(m[0]);
    cand = cand.map(function (c) { return c.replace(/&amp;/g, '&'); })
      .filter(function (c) { return /^https?:\/\//i.test(c) && !/downloads\.khinsider\.com\/game-soundtracks/i.test(c); });
    var mp3 = cand.filter(function (c) { return /\.mp3(?:$|[?#])/i.test(c); })[0];
    var any = cand[0];
    var flac = cand.filter(function (c) { return /\.flac(?:$|[?#])/i.test(c); })[0];
    return { src: mp3 || any || '', flac: flac || '' };
  }

  /* Enlaces a listas de tops desde cualquier página */
  function parseTopLinks(doc, baseUrl) {
    var base = baseUrl || (doc.location && doc.location.href);
    var origin = new URL(base).origin;
    var out = [], seen = {};
    var links = doc.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var u = abs(a.getAttribute('href'), base);
      if (!u || u.origin !== origin) continue;
      if (/\/game-soundtracks\/album\//.test(u.pathname) || /forums?|login|register|random/i.test(u.pathname)) continue;
      var t = txt(a);
      if (!t || t.length > 60) continue;
      if (!/top|popular|most|favou?rite|newly|latest|recent/i.test(t + ' ' + u.pathname)) continue;
      var k = u.pathname + u.search;
      if (seen[k] || k === '/') continue;
      seen[k] = 1;
      out.push({ title: t, url: u.href });
    }
    return out.slice(0, 20);
  }

  function detect(doc, baseUrl) {
    var base = baseUrl || (doc.location && doc.location.href);
    var p = new URL(base).pathname;
    if (ALBUM_RE.test(p)) return 'album';
    if (TRACK_RE.test(p)) return 'track';
    return 'list';
  }

  return {
    parseList: parseList, parseAlbum: parseAlbum, parseTrack: parseTrack,
    parseTopLinks: parseTopLinks, detect: detect, isChallenge: isChallenge,
    toSeconds: toSeconds, ALBUM_RE: ALBUM_RE, TRACK_RE: TRACK_RE
  };
})();
if (typeof window !== 'undefined') window.KHParse = KHParse;
