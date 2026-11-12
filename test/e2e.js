// Prueba de extremo a extremo con un khinsider SIMULADO (fixtures locales).
// Uso: node test/e2e.js [url-de-la-app]   (por defecto http://localhost:8123/)
// Necesita un servidor estático sirviendo la raíz del repo.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = process.argv[2] || 'http://localhost:8123/';
const FX = path.join(__dirname, 'fixtures');
const read = f => fs.readFileSync(path.join(FX, f));
const shots = process.env.SHOTS || '';
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failures++; };

async function routeFake(ctx) {
  await ctx.route('https://downloads.khinsider.com/**', route => {
    const u = new URL(route.request().url());
    let body = read('list.html');
    if (/^\/game-soundtracks\/album\/[^/]+$/.test(u.pathname)) body = read('album.html').toString().replace(/super-test-game/g, u.pathname.split('/').pop());
    else if (/\.mp3$/.test(u.pathname)) body = read('track.html').toString().replace(/1-01\.%20Main%20Theme/g, decodeURIComponent(u.pathname.split('/').pop()).replace(/\.mp3$/, '').replace(/ /g, '%20'));
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });
  await ctx.route('https://vgmtreasurechest.com/**', route => {
    const u = route.request().url();
    if (/\.(mp3|flac)$/i.test(u)) return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: read('tone.mp3') });
    route.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(path.join(__dirname, '..', 'icons', 'icon-192.png')) });
  });
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  await routeFake(ctx);
  const errors = [];
  ctx.on('page', p => p.on('pageerror', e => errors.push(e.message)));

  const app = await ctx.newPage();
  app.on('pageerror', e => errors.push(e.message));
  await app.goto(APP + '#/home');
  await app.waitForSelector('.hero');
  console.log('Portada sin conexión');
  ok(await app.locator('.hero').isVisible(), 'muestra la bienvenida con instrucciones');
  if (shots) await app.screenshot({ path: shots + '/1-welcome.png' });

  // --- Parsers ---
  console.log('Lectores de HTML');
  const parsed = await app.evaluate(async () => {
    const get = async f => new DOMParser().parseFromString(await (await fetch('test/fixtures/' + f)).text(), 'text/html');
    const al = KHParse.parseAlbum(await get('album.html'), 'https://downloads.khinsider.com/game-soundtracks/album/super-test-game');
    const li = KHParse.parseList(await get('list.html'), 'https://downloads.khinsider.com/top40');
    const tr = KHParse.parseTrack(await get('track.html'));
    const tops = KHParse.parseTopLinks(await get('list.html'), 'https://downloads.khinsider.com/top40');
    return { al, li, tr, tops };
  });
  ok(parsed.al.title === 'Super Test Game Original Soundtrack', 'título del álbum');
  ok(parsed.al.tracks.length === 4, '4 pistas (' + parsed.al.tracks.length + ')');
  ok(parsed.al.tracks[1].title === 'Field (Day)' && parsed.al.tracks[1].duration === 12, 'nombre y duración de pista');
  ok(parsed.al.tracks[2].cd === 2 && parsed.al.tracks[2].num === 1, 'CD y número de pista');
  ok(parsed.al.cover.endsWith('/cover.jpg') && parsed.al.covers.length === 2, 'portadas');
  ok(parsed.al.meta.year === '2017' && parsed.al.meta.platforms === 'Switch' && parsed.al.meta.developer === 'Nintendo', 'metadatos');
  ok(parsed.li.length === 3 && parsed.li[0].thumb && parsed.li[1].title === 'Other Game OST', 'lista de álbumes');
  ok(parsed.li[0].info.includes('Switch') && parsed.li[0].info.includes('2017'), 'info de fila');
  ok(/zxqw\/1-01\.%20Main%20Theme\.mp3$/.test(parsed.tr.src) && /\.flac$/.test(parsed.tr.flac), 'MP3 directo de la pista');
  ok(parsed.tops.some(t => t.title === 'Top 40') && !parsed.tops.some(t => /random|forum/i.test(t.url)), 'enlaces de tops');

  // --- Puente: marcador en una pestaña de khinsider abierta por la app ---
  console.log('Puente (marcador)');
  const bm = await app.evaluate(async () => {
    // obtiene el código del marcador que genera la app
    const a = document.querySelector('.bookmarklet');
    for (let i = 0; i < 50 && a.getAttribute('href') === '#'; i++) await new Promise(r => setTimeout(r, 100));
    return a.getAttribute('href');
  });
  ok(bm.startsWith('javascript:') && bm.length > 2000, 'marcador generado (' + bm.length + ' caracteres)');
  const [kh] = await Promise.all([ctx.waitForEvent('page'), app.click('.hero .btn:has-text("Abrir khinsider")')]);
  await kh.waitForLoadState();
  await kh.evaluate(code => { (0, eval)(decodeURIComponent(code.slice('javascript:'.length))); }, bm);
  await app.waitForSelector('.conn.on', { timeout: 8000 });
  ok(true, 'la app queda conectada');
  if (shots) await kh.screenshot({ path: shots + '/2-khinsider-bridge.png' });

  // Tops cargados como selecciones
  await app.bringToFront();
  await app.waitForSelector('.shelf .card', { timeout: 8000 });
  ok(await app.locator('h2:has-text("Top 40 Most Downloaded"), h2:has-text("Top 40")').count() > 0, 'los tops aparecen en Inicio');
  if (shots) await app.screenshot({ path: shots + '/3-home.png' });

  // Búsqueda
  console.log('Búsqueda');
  await app.fill('[data-search-form] input', 'zelda');
  await app.press('[data-search-form] input', 'Enter');
  await app.waitForSelector('section:has-text("En khinsider") .card', { timeout: 8000 });
  const nres = await app.locator('section:has-text("En khinsider") .card').count();
  ok(nres === 3, 'resultados desde khinsider (' + nres + ')');

  // Álbum
  console.log('Álbum y reproducción');
  await app.goto(APP + '#/album/super-test-game');
  await app.waitForSelector('.tr', { timeout: 8000 });
  ok(await app.locator('.tr').count() === 4, 'pistas del álbum');
  ok(await app.locator('.cd-head').count() === 2, 'separadores de disco');
  if (shots) await app.screenshot({ path: shots + '/4-album.png' });
  await app.click('.detail-head .btn:has-text("Reproducir")');
  await app.waitForFunction(() => !document.querySelector('[data-act=toggle]').getAttribute('aria-label').includes('Reproducir'), null, { timeout: 8000 });
  const st = await app.evaluate(() => ({ title: document.querySelector('[data-title]').textContent }));
  ok(st.title === 'Main Theme', 'reproduce la primera pista (' + st.title + ')');
  await app.waitForTimeout(800);
  const pc = await app.locator('.tr.playing').count();
  ok(pc === 1, 'resalta la pista en reproducción (' + pc + ')');
  if (pc !== 1) console.log(await app.evaluate(() => [location.hash, main.dataset.route, ...[...document.querySelectorAll('.tr')].map(r => r.className + ' ' + r.dataset.tid)].join('\n')));

  // Bucle A-B
  console.log('Bucle A-B');
  await app.click('.player [data-act=panel-loop]');
  await app.evaluate(() => new Promise(r => { const iv = setInterval(() => { if (document.querySelector('[data-cur]').textContent !== '0:00') { clearInterval(iv); r(); } }, 50); }));
  await app.keyboard.press('[');
  await app.waitForTimeout(1500);
  await app.keyboard.press(']');
  await app.waitForTimeout(2000);
  const loopInfo = await app.evaluate(() => document.querySelector('[data-np-loop]').textContent);
  ok(/⟳/.test(loopInfo), 'bucle activo (' + loopInfo + ')');
  const marks = await app.locator('.player .progress .mk.show').count();
  ok(marks === 2, 'marcadores A y B en la barra');
  // comprueba que el tiempo se mantiene dentro de A-B tras 4 s
  const times = await app.evaluate(async () => {
    const out = []; for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 200)); out.push(document.querySelector('.player [data-cur]').textContent); } return out;
  });
  ok(new Set(times).size <= 3 && times.every(t => t.startsWith('0:0')), 'el audio vuelve a A al llegar a B (' + [...new Set(times)].join(',') + ')');
  if (shots) await app.screenshot({ path: shots + '/5-loop.png' });
  // guardar bucle
  await app.click('.panel .btn:has-text("Guardar bucle")');
  await app.click('.modal .btn:has-text("Guardar")');
  ok(await app.locator('.panel .saved-loop').count() === 1, 'bucle guardado');

  // Playlist
  console.log('Playlists');
  await app.click('[data-act=new-playlist]');
  await app.fill('.modal input', 'Mi playlist');
  await app.click('.modal .btn:has-text("Crear")');
  await app.waitForSelector('h1:has-text("Mi playlist")');
  await app.goto(APP + '#/album/super-test-game');
  await app.waitForSelector('.tr');
  await app.locator('.tr').nth(2).locator('.tm').click();
  await app.click('.menu button:has-text("Añadir a playlist")');
  await app.click('.menu button:has-text("Mi playlist")');
  await app.click('.panel .btn:has-text("Fragmento a playlist")');
  await app.click('.menu button:has-text("Mi playlist")');
  await app.click('[data-side-playlists] a');
  await app.waitForSelector('.detail-head h1:has-text("Mi playlist")');
  const pn = await app.locator('.tr').count();
  ok(pn === 2, 'playlist con 2 elementos (' + pn + ', ' + await app.evaluate(() => location.hash) + ')');
  ok(await app.locator('.seg-badge').count() === 1, 'fragmento con bucle en la playlist');
  if (shots) await app.screenshot({ path: shots + '/6-playlist.png' });

  // Cola
  await app.click('.player [data-act=panel-queue]');
  ok(await app.locator('.panel .q-item').count() >= 4, 'cola visible');

  // Siguiente / repetir
  await app.click('.player [data-act=repeat]');
  await app.click('.player [data-act=repeat]');
  ok(await app.evaluate(() => document.querySelector('.player [data-repeaticon]').getAttribute('href')) === '#i-repeat1', 'repetir una (canción entera)');

  // Pantalla completa
  await app.click('.player [data-act=nowplaying]');
  await app.waitForSelector('[data-np]:not([hidden])');
  if (shots) await app.screenshot({ path: shots + '/7-nowplaying.png' });
  await app.keyboard.press('Escape');

  // Persistencia
  console.log('Persistencia');
  await app.reload();
  await app.waitForSelector('[data-side-playlists] a');
  ok(await app.locator('[data-side-playlists] a').count() === 1, 'playlist persiste tras recargar');
  ok(await app.evaluate(() => document.querySelector('[data-title]').textContent) !== 'Nada en reproducción', 'sesión restaurada');

  // Importación por hash (cuando el puente no puede mantener la conexión)
  console.log('Importación por enlace');
  const payload = { type: 'list', list: { title: 'Lista enviada', url: 'https://downloads.khinsider.com/most-favorites', items: [{ id: 'x-game', title: 'X Game', url: 'https://downloads.khinsider.com/game-soundtracks/album/x-game', thumb: 'javascript:alert(1)' }] } };
  await app.goto(APP + '#kh=' + encodeURIComponent(JSON.stringify(payload)));
  await app.waitForSelector('h1:has-text("Lista enviada")');
  ok(true, 'lista importada por enlace');
  ok(await app.evaluate(() => !document.querySelector('img[src^="javascript"]')), 'descarta URLs no seguras');

  // Móvil
  console.log('Móvil');
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await routeFake(m);
  const mp = await m.newPage();
  mp.on('pageerror', e => errors.push(e.message));
  await mp.goto(APP + '#/home');
  await mp.waitForSelector('.tabbar');
  ok(await mp.locator('.tabbar').isVisible(), 'barra de pestañas en móvil');
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector('#main').scrollWidth > innerWidth);
  ok(!overflow, 'sin desbordamiento horizontal');
  ok(await mp.locator('.hero li:has-text("Compartir")').count() === 0 && await mp.locator('.hero li:has-text("⋮")').count() === 0 && await mp.locator('.hero .bookmarklet').count() === 1, 'pasos de computador en navegador genérico');
  const ip = await browser.newContext({ ...require('playwright').devices['iPhone 13'] });
  await routeFake(ip);
  const ipp = await ip.newPage();
  await ipp.goto(APP + '#/home');
  await ipp.waitForSelector('.hero');
  ok(await ipp.locator('.hero li:has-text("Compartir")').count() === 1, 'pasos específicos para iPhone');
  if (shots) await ipp.screenshot({ path: shots + '/10-iphone.png' });
  const an = await browser.newContext({ ...require('playwright').devices['Pixel 7'] });
  await routeFake(an);
  const anp = await an.newPage();
  await anp.goto(APP + '#/home');
  await anp.waitForSelector('.hero');
  ok(await anp.locator('.hero li:has-text("estrella")').count() >= 1, 'pasos específicos para Android');
  if (shots) await mp.screenshot({ path: shots + '/8-mobile.png' });

  ok(errors.length === 0, 'sin errores de JavaScript' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failures ? `\n${failures} fallo(s)` : '\nTodo correcto');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
