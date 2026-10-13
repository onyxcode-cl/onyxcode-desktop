# Sitio de Lazunox (`onyxcode.cl/lazunox`)

Página estática (HTML, CSS y un JS corto), sin dependencias ni paso de compilación. Todo vive en `site/lazunox/`.

- `index.html`: contenido (qué hace, cómo instalar, confianza).
- `style.css`: diseño; claro y oscuro según el sistema; respeta «reducir movimiento».
- `app.js`: busca la última versión **publicada** en GitHub (`releases/latest`) y apunta los botones al `.dmg` y al `.exe`; si no hay
  ninguna publicada o GitHub no responde, los botones llevan a la lista de versiones. Marca el botón del sistema de quien visita.
- `_headers`: cabeceras de seguridad (CSP estricta: solo recursos propios y `api.github.com`) para Cloudflare Pages / Netlify.

## Probar en local

```sh
python3 -m http.server 8765 --directory site/lazunox
# abrir http://127.0.0.1:8765/
```

## Publicar (no se hace solo; lo decide el dueño)

La ruta `onyxcode.cl/lazunox` debe servir el contenido de esta carpeta. Con Cloudflare Pages: proyecto nuevo con directorio de
salida `site/lazunox` y una ruta/regla que lo exponga bajo `/lazunox` en `onyxcode.cl` (o un Worker que sirva los archivos con
ese prefijo). Antes de publicar:

1. Que exista al menos una **versión publicada** (no borrador) en `onyxcode-cl/onyxcode-desktop`; hoy `v0.5.9` está en borrador y
   los botones llevarían a la lista de versiones.
2. Que el dueño confirme el nombre «Lazunox» (el README del proyecto lo marca como **no verificado**) y lo que dice la página.
3. Revisar que cada afirmación de «Qué hace» exista en la versión publicada (p. ej. documentos con ArtCraft y arrastrar carpetas).
