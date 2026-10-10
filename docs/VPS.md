# Publicar actualizaciones desde tu propio servidor (lazunox.onyxcode.cl)

La app consulta `https://lazunox.onyxcode.cl` (constante `RELEASES_ORIGIN` de `src/shared/brand.ts`) y descarga de ahí las
actualizaciones. Son **archivos estáticos**: no hace falta ningún programa propio en el servidor, solo nginx con HTTPS.

**El servidor no necesita ser de confianza.** Cada actualización lleva un manifiesto firmado con tu clave privada (Ed25519,
`~/.lazunox-keys/update.pem`, nunca se sube); la app verifica la firma, el tamaño y el hash antes de instalar. Si alguien
hackeara el servidor no podría instalar nada falso, solo impedir que lleguen actualizaciones.

## 1. Una sola vez en el servidor

1. **DNS:** crea un registro `A` (y `AAAA` si tienes IPv6) de `lazunox.onyxcode.cl` hacia la IP del VPS.
2. **Carpeta:** `sudo mkdir -p /var/www/lazunox && sudo chown -R $USER /var/www/lazunox`.
3. **nginx** (`/etc/nginx/sites-available/lazunox`, enlazado en `sites-enabled`):

   ```nginx
   server {
     listen 80;
     server_name lazunox.onyxcode.cl;
     root /var/www/lazunox;

     location / { autoindex on; try_files $uri $uri/ =404; }

     # «Última versión»: archivo sin extensión que contiene JSON. Nunca debe quedar en caché.
     location ~ ^/repos/.+/releases/latest$ {
       default_type application/json;
       add_header Cache-Control "no-store";
     }
     # Manifiestos y firmas: tampoco se cachean (cada versión nueva los cambia).
     location ~ \.(json|sig)$ { add_header Cache-Control "no-store"; }
   }
   ```

4. **HTTPS gratis:** `sudo certbot --nginx -d lazunox.onyxcode.cl` (Let's Encrypt; renueva solo). La app solo acepta `https`.
5. `sudo nginx -t && sudo systemctl reload nginx`.

## 2. Cada versión nueva (en tu Mac)

1. Sube la versión en `package.json` y construye: `npm run package` (Mac) y el instalador de Windows (`npm run package:win`).
2. Prepara y firma las actualizaciones (pasos 3–4 de `docs/RELEASE.md`): `scripts/publish-update.mjs` y `scripts/sign-update.mjs`
   para `darwin-arm64` y `win32-x64`. Obtienes, por plataforma, el manifiesto, su `.sig` y el ZIP.
3. Arma la carpeta del servidor (no sube nada):

   ```sh
   node scripts/publish-vps.mjs --tag v0.5.9 --out dist/vps \
     dist/update/* dist/update-win/* \
     dist/lazunox-0.5.9-arm64.dmg dist/Lazunox-Setup-0.5.9-x64.exe
   ```

4. Súbela tú con el `rsync` que imprime el script (cambia usuario y servidor):

   ```sh
   rsync -av dist/vps/ USUARIO@SERVIDOR:/var/www/lazunox/
   ```

   Sube primero las carpetas de la versión y por último el archivo `repos/…/releases/latest`: la app solo ve la versión nueva
   cuando ese archivo ya apunta a ella. (Con `rsync -av` de una sola vez también sirve; el orden solo evita una ventana de segundos.)

5. Comprueba: `curl -s https://lazunox.onyxcode.cl/repos/lazunox/lazunox/releases/latest` debe mostrar `"tag_name": "v0.5.9"`.

## 3. Cómo le llega a la persona

A los ~8 s de abrir la app (y cada pocas horas) pregunta por `…/releases/latest`. Si la versión es mayor, avisa; al pulsar
«Actualizar» descarga el manifiesto y el ZIP de `…/releases/download/vX.Y.Z/`, verifica la firma Ed25519, el tamaño y el
SHA-256, comprueba que no sea una versión anterior y reemplaza la app al reiniciar (en Windows sin permisos de administrador).

## 4. Instaladores por terminal

`scripts/install/install.sh` (Mac) e `install.ps1` (Windows) descargan de
`https://lazunox.onyxcode.cl/lazunox/lazunox/releases/latest/download/` y verifican el SHA-256 contra `SHA256SUMS`
(lo genera `publish-vps.mjs`). Ejemplo en Mac: `curl -fsSL https://lazunox.onyxcode.cl/install.sh | sh` si copias `install.sh`
a la raíz del servidor; en Windows, `irm https://lazunox.onyxcode.cl/install.ps1 | iex` con `install.ps1`.

## 5. Revertir una versión mala

La app nunca instala una versión anterior (anti-downgrade). Para retirar una mala: sube una **versión nueva** (por ejemplo
0.5.10) con el arreglo, o borra el archivo `repos/lazunox/lazunox/releases/latest` para que deje de ofrecerse mientras tanto.

## 6. Límites

- El canal beta (lista de releases) no está en el servidor: solo existe el canal estable.
- Si cambias el dominio, hay que publicar una versión con el nuevo `RELEASES_ORIGIN` **desde el dominio antiguo**; las apps ya
  instaladas solo conocen el que traían compilado.
