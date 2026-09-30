# Servidor de cuentas — contrato de la API (especificación para la Fase 2)

Esta es la especificación del servidor que el cliente de OnyxCode (Fase 1, ya hecho) espera. **Nada de esto está
desplegado.** La implementación de referencia de los casos de borde es el servidor falso `e2e/fake-auth/server.mjs`
(con `server.test.mjs`); el cliente es `src/main/account/client.ts` y la decisión de acceso `src/shared/account.ts`.
Enciende la cuenta poniendo el origen en `ACCOUNT_API` (`src/shared/brand.ts`). Ver también `docs/SEGURIDAD.md` §3 sexies.

## 1. Reglas generales

- **Un solo origen** `https://<dominio>` (sin ruta, TLS ≥ 1.2), rutas bajo `/v1`. JSON UTF-8. Cuerpos de petición ≤ 4 KB
  (`413` si no); `Content-Type: application/json` obligatorio en POST (`415` si no). Respuestas con `Cache-Control: no-store`.
- **Sin CORS.** No enviar `Access-Control-*`; `OPTIONS` → `404`. **Rechazar con `403 {"error":"origin_not_allowed"}` todo
  `POST`/`DELETE` que lleve cabecera `Origin`** (la app de escritorio nunca la manda; un navegador siempre) y cualquier
  petición con `Cookie` no se usa para nada: no hay sesiones por cookie.
- **Sesión:** `Authorization: Bearer <token>`. Token **opaco de 256 bits** (CSPRNG, base64url de 32 bytes = 43 caracteres).
  En base de datos solo se guarda su **SHA-256**. Vida de **90 días**; **rotación**: si en `GET /v1/me` quedan < 30 días,
  responder un `session_token` nuevo (el anterior sigue válido 10 minutos más, por si el cliente no alcanza a guardarlo).
- **Errores:** cuerpo `{"error":"<codigo>"}` con un código corto (`invalid_email`, `invalid_request`, `invalid_code`,
  `too_many_attempts`, `rate_limited`, `unauthorized`, `gone`, `origin_not_allowed`, `invalid_redirect_uri`, `not_found`).
  `429` incluye `Retry-After` (segundos).
- **Límites** (devolver `429`):
  - **Por IP: 20 peticiones/minuto** a `/v1/auth/*`.
  - **Por correo: 3 envíos de código por hora y 10 por día.** El contador es **por correo solicitado, exista o no la
    cuenta**, para que el `429` no revele nada.
  - **5 intentos por código**; al sexto, `429 too_many_attempts` y el código queda inutilizado.
- **Código de correo:** 6 dígitos (CSPRNG), válido **10 minutos**, de un solo uso, **uno vigente por correo** (pedir otro
  invalida el anterior). En BD solo se guarda **HMAC-SHA256(pepper, correo‖código)** (el *pepper* va en un almacén de
  secretos, no en la BD); comparar en tiempo constante.
- **Logs:** nada de correo, IP, token ni código. Solo identificador de petición, método, ruta, estado y latencia.
  Conservación de logs: **7 días**.
- **Retención:** cuentas sin acceso 24 meses se borran (avisando por correo antes); copias de seguridad 30 días.

## 2. Endpoints

### `POST /v1/auth/email/start`
Cuerpo: `{"email": "<correo>"}` (≤ 254, forma `a@b.tld`; el cliente ya normalizó a minúsculas).
- **`202 {"ok":true}` SIEMPRE** que el correo tenga formato válido y no se haya excedido un límite, **exista o no la cuenta**
  (para no enumerar cuentas). El envío del correo es asíncrono (cola) y el tiempo de respuesta no debe depender de si existe.
- `400 invalid_email` (formato), `429 rate_limited` (IP o correo), `403` (Origin).
- El correo lleva solo el código y el nombre de la app; nunca un enlace que inicie sesión.

### `POST /v1/auth/email/verify`
Cuerpo: `{"email": "...", "code": "123456"}` (`code` = `^\d{6}$`, si no `400 invalid_request`).
- `200 {"token","email","provider":"email","expires_at"}`. Si la cuenta no existe, **se crea** aquí. Consume el código.
- `401 invalid_code` (incorrecto, caducado o ya usado; respuesta uniforme), `429 too_many_attempts`.

### `POST /v1/auth/google/start`
Cuerpo: `{"redirect_uri","state","code_challenge","code_challenge_method":"S256"}`.
- Validar `redirect_uri` con `^http://127\.0\.0\.1:\d{1,5}/callback$` (loopback, RFC 8252), `state` ≥ 16 caracteres y
  `code_challenge_method = "S256"`; si no `400 invalid_redirect_uri | invalid_request`.
- Guardar (TTL 10 min) `{hash(state), code_challenge, redirect_uri, nonce}` y responder `200 {"auth_url":"https://accounts.google.com/o/oauth2/v2/auth?..."}`
  con `client_id` (tipo «Aplicación de escritorio» de Google), `redirect_uri`, `response_type=code`, `scope=openid email`,
  `state`, `code_challenge`/`code_challenge_method=S256` (el mismo de la app), `nonce`, `prompt=select_account`.
- Google redirige al loopback de la app (`GET <redirect_uri>?code=…&state=…`); el servidor **no** recibe esa redirección.

### `POST /v1/auth/exchange`
Cuerpo: `{"code","code_verifier","redirect_uri"}` (el `code` de Google).
- El servidor canjea el código con el endpoint de tokens de Google enviando `code`, `code_verifier`, `redirect_uri`,
  `client_id` (y `client_secret` si el tipo de cliente lo exige). Validar el `id_token`: firma (JWKS), `iss`, `aud`, `exp`,
  `nonce` y **`email_verified = true`**. Crear o vincular el usuario por `sub` (+ correo) y abrir sesión.
- `200 {"token","email","provider":"google","expires_at"}`. Cualquier fallo (código usado/inválido, `redirect_uri` distinto,
  PKCE que no cuadra, `id_token` inválido): `401 invalid_code`. El `code` es de **un solo uso** aunque falle.

### `GET /v1/me`   (Bearer)
- `200 {"email","provider","created_at","last_seen","session_token"?}`. Es también el contenido de «Descargar mis datos»:
  debe incluir **todo** lo que se guarda de la persona (y nada de secretos). `session_token` solo si se rota (ver §1).
- `401 unauthorized` (desconocido, caducado o revocado) · **`410 gone`** (la cuenta fue borrada; `404` también lo trata
  así el cliente). Actualiza `last_seen`.

### `POST /v1/logout`   (Bearer)
- `204` y la sesión queda revocada. Idempotente: `401` si ya no valía (el cliente lo acepta).

### `DELETE /v1/me`   (Bearer)
- `204`: borra el usuario, sus sesiones y códigos. Borrado duro en BD (las copias de seguridad caducan a los 30 días).
  El cliente confirma antes con el usuario. `401`/`404`/`410` → el cliente da la cuenta por borrada.

## 3. Qué hace el cliente con cada respuesta (contrato de la app)

| Petición | Respuesta | La app… |
|---|---|---|
| `GET /v1/me` (al arrancar y cada 24 h) | `200` | abre; anota la validación; si trae `session_token`, lo guarda |
| | `401` | **bloquea al instante**, borra la sesión, «Tu sesión terminó» |
| | `404`/`410` | bloquea, borra la sesión, «Esta cuenta ya no existe» |
| | sin respuesta, `5xx`, `429`, otro `4xx`, `200` ilegible | **gracia:** abre si la última validación correcta tiene < 30 días; si no, «Sin conexión con el servidor» |
| `email/start` | `202` | pasa a pedir el código |
| | `429` | «Demasiados intentos. Prueba de nuevo más tarde» (usa `Retry-After`) |
| `email/verify` / `exchange` | `401`/`400` | «El código es incorrecto o ya venció» / «No se pudo iniciar sesión con Google» |
| `google/start` | `200 auth_url` | abre la URL en el navegador del sistema solo si es `https:` |

Tiempo máximo por petición en el cliente: 10 s. Sin cookies, sin redirecciones (`redirect:'error'`), respuestas ≤ 256 KB.

## 4. Despliegue y operación (a decidir en la Fase 2)

Fuera de alcance de este documento: hosting, base de datos, proveedor de correo, cuenta de Google Cloud y su pantalla de
consentimiento, dominio y certificados. Requisitos que sí impone el cliente: HTTPS con certificado público válido,
un único dominio fijo (`ACCOUNT_API`) y las reglas de la §1.
