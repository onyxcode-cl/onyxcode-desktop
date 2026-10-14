# Sitio de Lazunox (`onyxcode.cl/lazunox`)

Página estática (HTML, CSS y un JS corto), sin dependencias ni paso de compilación. Vive en `site/lazunox/`; los instaladores NO están en el
repositorio: se suben aparte a `descargas/` en el servidor.

- `lazunox/index.html`: contenido (qué hace, cómo instalar, verifica tu descarga, confianza).
- `lazunox/style.css`: diseño, siempre en modo claro; respeta «reducir movimiento».
- `lazunox/app.js`: lee `descargas/latest.json` (versión, tamaño y SHA-256 de cada instalador) y marca el botón del sistema de quien visita.
- `deploy/nginx-lazunox.conf`: configuración del servidor (cabeceras de seguridad con una CSP estricta, y `descargas/` servido como archivo, sin comprimir y con reanudación).

## Probar en local

```sh
python3 -m http.server 8765 --directory site/lazunox   # http://127.0.0.1:8765/
```

## Publicar una versión nueva (a mano; lo decide el dueño)

1. Armar los instaladores desde `main`: `npm run package` + `scripts/sign-release-mac.sh` (Mac) y `scripts/win/sync.sh` con `STEPS=package` (Windows).
2. En una carpeta aparte: `shasum -a 256 Lazunox-X.Y.Z-arm64.dmg Lazunox-Setup-X.Y.Z-x64.exe > SHA256SUMS` y un `latest.json` con
   `{"version":"X.Y.Z","files":{"mac":{"file","size","sha256"},"win":{"file","size","sha256"}}}`.
3. Copiar los cuatro archivos a `descargas/` del servidor y comprobar `sha256sum -c SHA256SUMS` allí.
4. Actualizar en `index.html` los nombres de archivo y las huellas del bloque «Verifica tu descarga», y subir `index.html`, `style.css` y `app.js`.
5. Probar bajando desde el dominio y comparando la huella.

## Cómo está montado hoy

Un contenedor `nginx:stable-alpine` (`lazunox-site`) en la red del proxy (Traefik de Coolify), solo lectura, con dos rutas para
`Host(www.onyxcode.cl)`: `PathPrefix(/lazunox)` (prioridad 100, con compresión) y `PathPrefix(/lazunox/descargas)` (prioridad 110, SIN
compresión para los instaladores). Monta `nginx-lazunox.conf` y la carpeta `html/`. No toca el resto del sitio. Para deshacerlo:
`docker rm -f lazunox-site && rm -rf /opt/lazunox-site`.

## Antes de dar la página por buena

- La marca «Lazunox» está marcada como **no verificada** en el README del proyecto.
- Los instaladores no están firmados con certificados de pago (Apple/Microsoft): el sistema muestra un aviso la primera vez; la página lo explica
  y ofrece la huella para verificar.
