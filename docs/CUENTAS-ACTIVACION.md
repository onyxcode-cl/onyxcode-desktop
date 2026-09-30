# Cuentas — qué cambiar al ACTIVAR

Hoy las cuentas están **apagadas** (`ACCOUNT_API = null`) y los textos públicos dicen lo contrario de lo que pasará al
activarlas. Esta lista es el «paso 0» de la activación: no se cambian antes para no mentir sobre la versión actual.

## Interruptor

- [ ] `src/shared/brand.ts`: `ACCOUNT_API = 'https://<dominio>'` (servidor de la Fase 2 ya desplegado y probado).
- [ ] `src/shared/brand.ts`: `PRIVACY_URL` y `TERMS_URL` con las páginas publicadas (revisadas por un abogado; partir de
      `docs/PRIVACIDAD-BORRADOR.md` y `docs/TERMINOS-BORRADOR.md`). Si quedan vacías, la app muestra el borrador corto
      de `src/shared/account-legal.ts` **y eso no debe salir en una versión pública**.
- [ ] Mantener alineado `src/shared/account-legal.ts` (texto corto en la app) con los documentos largos.
- [ ] Google Cloud: cliente OAuth de tipo **«Aplicación web»** con una única URI de redirección,
      `https://api.onyxcode.cl/v1/auth/google/callback`; el `client_secret` solo en el almacén de secretos del servidor
      (ver `docs/CUENTAS-SERVIDOR.md` §2). El cliente Electron no cambia.
- [ ] `npm run verify` completo y una prueba manual con el servidor real: correo + código, Google real, cerrar sesión,
      descargar datos, borrar cuenta, servidor caído (gracia) y Llavero real.

## Textos que dejarán de ser ciertos

- [ ] **README › «Privacidad»** (línea ~160): hoy solo menciona al proveedor de IA y la consulta a GitHub. Añadir: la cuenta
      (correo y, con Google, su identificador), qué guarda el servidor, que conversaciones y claves siguen en el Mac, enlaces
      a la política y los términos.
- [ ] **README, apartado de credenciales** (línea ~30): «no la envía a ningún sitio salvo al proveedor» sigue siendo cierto
      para las **claves de IA**, pero conviene aclarar que el correo de la cuenta sí va al servidor de cuentas.
- [ ] **docs/SEGURIDAD.md §1 y §2**: la CSP (`connect-src 'self' http://127.0.0.1:*`) no cambia (todo va por main), pero
      añadir una referencia a §3 sexies y quitar la marca «pendiente de activación» de ese apartado.
- [ ] **docs/SEGURIDAD.md §3 quinquies** (aviso de versión): recordar que ya no es la única conexión de red propia de la app.
- [ ] **docs/DISTRIBUCION.md** y **AUDIT.md**: mencionar el dominio de cuentas y que `verify:release` podría exigir `ACCOUNT_API`.
- [ ] Acerca de (`AboutSection.tsx`): decidir si se enlaza la política de privacidad.

## Búsquedas para no dejar nada atrás

```sh
grep -rniE "ningún sitio|telemetr|sin cuenta|sin registr|no se envía|no envía" README.md docs src --include='*.md' --include='*.ts' --include='*.tsx'
grep -rniE "privacidad|privacy" README.md docs/SEGURIDAD.md docs/DISTRIBUCION.md src/renderer
```

Coincidencias esperables que **no** hay que tocar: comentarios internos («sin registro = nunca abierta», `sandbox.ts`).
