# KH Player

Reproductor estilo Apple Music para la música de videojuegos de [khinsider](https://downloads.khinsider.com/). Es una página estática que funciona en GitHub Pages y no necesita servidor ni compilación.

## Qué tiene

- **Inicio**: «Seguir escuchando», los tops de khinsider como selecciones de música, novedades, tus playlists y lo escuchado hace poco.
- **Explorar**: todas las listas de tops que tiene khinsider, más las selecciones que guardes. También puedes añadir cualquier lista por URL.
- **Buscar**: en tu biblioteca al instante y en todo el catálogo de khinsider.
- **Álbumes**: portada, datos del álbum, discos, reproducir, aleatorio, guardar en la biblioteca, favoritos y un menú ⋯ con más opciones.
- **Playlists**: crear, renombrar, describir, reordenar arrastrando, duplicar, exportar y eliminar. Pueden incluir **fragmentos** de una canción que se repiten de A a B.
- **Bucle A‑B**: marca A y B (botones, teclas `[` y `]`, o arrastrando los marcadores en la barra). Tiene ajuste fino de ±0,1 s y ±1 s, número de repeticiones y velocidad de 0,5× a 2×. Puedes guardar varios bucles por canción.
- **Repetir la canción entera** («repetir una»), repetir todo y aleatorio.
- **Cola**: «a continuación», añadir a la cola, reordenar y quitar.
- **Pantalla de reproducción** a pantalla completa con la portada difuminada, como en Apple Music.
- **Biblioteca**: recientes, álbumes, canciones, favoritos y bucles.
- Controles del sistema y de la pantalla de bloqueo (Media Session), atajos de teclado y diseño para móvil con barra de pestañas.
- Todo se guarda en tu navegador. Puedes exportarlo e importarlo como JSON.

## Cómo obtiene los datos (y por qué hace falta un marcador)

`downloads.khinsider.com` está protegido por Cloudflare. Responde con un desafío anti-bot a cualquier petición que no venga de una persona en un navegador. Además, no permite que otras webs lean sus páginas (CORS). Por eso una página en GitHub Pages no puede leer khinsider directamente, y los proxies también reciben el bloqueo.

La solución es un **marcador** (bookmarklet). No hay nada que instalar:

1. En la app, arrastra el botón **KH Player ▸** a la barra de marcadores.
2. Pulsa **Abrir khinsider** y, en esa pestaña, pulsa el marcador.
3. Esa pestaña (tu navegador, con tu sesión normal) hace de puente. Lee las páginas de khinsider y se las pasa a la app con `postMessage`. Mientras siga abierta, puedes buscar, ver tops y abrir cualquier álbum desde la app.

También puedes pulsar el marcador en cualquier página de khinsider (un álbum, un top o una búsqueda) y luego **Abrir en el reproductor** para enviarla a la app.

Los MP3 se reproducen directamente desde los servidores de audio de khinsider. Lo que ya cargaste (álbumes guardados, playlists, bucles) sigue funcionando aunque cierres la pestaña puente.

### En el móvil

Los navegadores del móvil pausan las pestañas que quedan de fondo, así que la conexión en vivo no es fiable ahí. Por eso el marcador tiene **Preparar y abrir**:

1. En khinsider abre un top, una búsqueda o un álbum y toca el marcador.
2. En un top o una búsqueda, elige cuántos álbumes preparar (5, 10, 20… o todos) y toca **Preparar y abrir**. El marcador obtiene cada álbum con los enlaces de audio de todas sus canciones. Mantén la pantalla encendida mientras termina.
3. Toca **Abrir en el reproductor**. Todo llega a la app comprimido dentro del enlace, sin depender de que la pestaña de khinsider siga activa. Ya puedes escuchar, hacer playlists y bucles.

La app muestra pasos específicos para crear el marcador en **iPhone (Safari)** y en **Android (Chrome)**. Los tres casos están en Ajustes.

Usa la app en una pestaña normal del navegador. Si la abres desde un ícono en la pantalla de inicio en modo app, queda separada del navegador y no recibe los datos del marcador. Por eso el manifest usa `"display": "browser"` y la app avisa si detecta ese modo.

## Publicar en GitHub Pages

1. Ve a **Settings → Pages** del repositorio.
2. En **Source**, elige **Deploy from a branch**.
3. Elige la rama (por ejemplo `main`) y la carpeta **/ (root)**. Guarda.
4. En uno o dos minutos la app estará en `https://<usuario>.github.io/khinsider_player/`.

No hay paso de compilación: son HTML, CSS y JavaScript estáticos con rutas relativas (`.nojekyll` incluido).

## Desarrollo y pruebas

```bash
python3 -m http.server 8123
```

```bash
node test/e2e.js http://localhost:8123/
```

`test/e2e.js` usa Playwright con un khinsider **simulado** (`test/fixtures/`). Prueba los lectores de HTML, el puente, la búsqueda, la reproducción, el bucle A‑B, las playlists, la persistencia y el diseño móvil.

Estructura:

| Archivo | Qué hace |
| --- | --- |
| `js/parsers.js` | Lee el HTML de khinsider (listas, álbumes, pistas, tops). Lo usan el marcador y el modo proxy. |
| `js/bridge.js` | Código del marcador, que se ejecuta en la pestaña de khinsider. |
| `js/source.js` | Comunicación con el puente (o con un proxy propio opcional). |
| `js/player.js` | Cola, aleatorio, repetir, bucle A‑B y Media Session. |
| `js/store.js` | Estado persistente en `localStorage`, validación e import/export. |
| `js/app.js` | Interfaz y vistas. |

## Aviso

Proyecto no oficial, sin relación con khinsider. La música pertenece a sus autores. Apoya a los compositores comprando las bandas sonoras.
