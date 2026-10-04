# Servicio de conexión del remoto fuera de casa

Subproyecto aparte (no entra en la app ni en su build). Reenvía señalización entre tu Mac y tu celular; **no guarda nada** y no ve
credenciales ni conversaciones. Código del comportamiento: `src/shared/remote/room-core.ts` (con sus pruebas). Este directorio solo
tiene la envoltura de Cloudflare.

**Estado: nada de esto está publicado ni lo puede publicar un agente.** Todo lo de abajo lo haces tú, en tu Mac, en la Terminal.
Nunca pegues una clave ni un token en un chat: se escriben solo en la Terminal.

Cuenta: entra con la cuenta **Onyx** (`Onyx.code.2026@gmail.com`), nunca con la de Bentec. Activa la verificación en dos pasos.

## Pasos (en orden)

1. **Iniciar sesión** (no crea ningún token que copiar):
   `cd cloud/remoto-worker && npx wrangler@4 login` — se abre el navegador; acepta con la cuenta Onyx.
   Comprueba con `npx wrangler@4 whoami` que sale la cuenta Onyx.
2. **Clave de firma del sitio** (una vez; la privada no sale de tu Mac ni va a CI):
   `mkdir -p ~/.onyxcode-keys && /opt/homebrew/bin/openssl genpkey -algorithm ed25519 -out ~/.onyxcode-keys/site.pem && chmod 600 ~/.onyxcode-keys/site.pem`
   (usa el OpenSSL 3 de Homebrew; el de `/usr/bin` no sabe Ed25519). Saca la **pública**, que no es secreta, y se la pasas a quien
   mantiene el código para ponerla en `src/shared/brand.ts` (`SITE_PUBLIC_KEY`):
   `/opt/homebrew/bin/openssl pkey -in ~/.onyxcode-keys/site.pem -pubout`
3. **Publicar el sitio** (siempre desde tu Mac): `ONYXCODE_SITE_KEY_FILE=~/.onyxcode-keys/site.pem node scripts/site-release.mjs`
   Compila `pwa/dist-site`, firma `site-manifest.json` y **no despliega**: imprime el comando final. Ejecútalo tú, desde
   `cloud/remoto-worker`: `npx wrangler@4 deploy`.
4. **Dominio**: panel de Cloudflare → *Workers & Pages* → `onyx-remoto` → *Settings* → *Domains & Routes* → *Add* → *Custom domain* →
   `remoto.onyxcode.cl`.
5. **Seguridad del dominio** (`onyxcode.cl`): *SSL/TLS* → *Edge Certificates*: «Always Use HTTPS» activado, «Minimum TLS Version» 1.2 y
   HSTS (6 meses; «include subdomains» solo si todo `*.onyxcode.cl` ya va por HTTPS).
6. **Fallo cerrado**: en *Workers & Pages* → `onyx-remoto` → *Settings*, si aparece la opción de «fail open / fail closed» para las rutas,
   elige *fail closed*.
7. **Límite por IP**: *Security* → *WAF* → *Rate limiting rules* → regla «remoto»: si la ruta empieza por `/v1/`, más de 60 peticiones
   en 10 s por IP → bloquear 1 minuto (el plan gratuito admite una regla). Además `wrangler.jsonc` trae un límite de 30 conexiones
   por minuto por IP (`ratelimits`); si `wrangler` rechaza ese bloque en tu plan, bórralo y quédate con la regla del panel.
8. **Avisos de coste**: *Manage Account* → *Notifications* → crea alertas de uso y de facturación (Workers y Realtime) a tu correo.
9. **Comprobar**: abre `https://remoto.onyxcode.cl` en el celular (debe cargar sin avisos) y sigue `docs/REMOTO-PRUEBA-MANUAL.md`.

## TURN (relé): APAGADO. No lo necesitas para empezar

La primera entrega funciona **solo con STUN** (`stun.cloudflare.com`) y conexión directa: sirve en la mayoría de redes. El relé
(TURN) está implementado pero detrás de un interruptor apagado (`TURN_ENABLED` = `"false"` en `wrangler.jsonc`) y sin secretos.
Si algún día lo quieres:

1. Panel → *Realtime* → *TURN* → *Create*, nombre `onyxcode-remoto` (puede pedir método de pago).
2. En la Terminal, dentro de `cloud/remoto-worker`: `npx wrangler@4 secret put TURN_KEY_ID` y `npx wrangler@4 secret put TURN_KEY_API_TOKEN`;
   pega cada valor **en la Terminal** cuando lo pida.
3. Cambia `"TURN_ENABLED"` a `"true"` y vuelve a publicar (paso 3). Para apagarlo de emergencia: vuelve a `"false"` y publica.

Tope de uso: 20 credenciales por hora y por Mac; duran 8 h; solo se piden después de que tu Mac acepte la conexión.

## Dependencias

Ninguna en la app. Aquí `package.json` declara `wrangler` como dependencia de desarrollo **sin instalarla**: usa
`npx wrangler@4 …`. No hace falta `@cloudflare/workers-types` (los tipos mínimos están en `src/cf.d.ts`).
Comprobación de tipos del Worker (sin red): desde la raíz del repo, `node_modules/.bin/tsc -p cloud/remoto-worker/tsconfig.json`.

## Qué ve Cloudflare

IP del Mac y del celular, horas y duración de las conexiones, la sala (un seudónimo estable de tu Mac), el `deviceId` del celular y el
SDP (candidatos de red y huellas públicas). **No ve**: el código de vinculación, el secreto del dispositivo, la clave, el PIN ni nada de
las conversaciones. Detalle en `docs/SEGURIDAD.md` (control remoto fuera de casa) y `docs/PRIVACIDAD-BORRADOR.md`.

## Límites gratuitos (compartidos por todos los Macs que usen el servicio)

100 000 peticiones de Worker al día y 100 000 de Durable Object (se reinician a las 00:00 UTC). Un Mac con «fuera de casa» activo gasta
unas 100 al día gracias a la hibernación. Si se agotan, la nube se cae hasta el reinicio y **la red local sigue funcionando**.
Por verificar en tu cuenta: si el binding de límite por IP está en el plan gratuito y el máximo de archivos de los estáticos.
