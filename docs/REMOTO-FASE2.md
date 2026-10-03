# Control remoto, fase 2: diseño (sin código)

Estado: **propuesta por escrito**, nada de esto está implementado. La fase 1 (hoy) es red local: el Mac sirve la PWA por `http://<ip-privada>:<puerto>`,
señaliza por un WebSocket local, abre un DataChannel WebRTC y autentica con secreto de dispositivo + PIN + confirmación en el Mac
(`docs/SEGURIDAD.md` §3 vicies). La fase 2 busca usarlo **fuera de la red local** y con credenciales mejores, sin que ningún
servidor vea contenido ni credenciales. Cada punto marca qué se sabe y qué hay que verificar antes de construirlo.

## 1. Por qué hace falta HTTPS y un origen estable

- **WebAuthn/passkeys, service workers, instalación de la PWA y Web Push exigen contexto seguro (HTTPS)**. `http://192.168.x.x` no lo es, así que hoy no se pueden usar.
- Una página HTTPS no puede abrir `ws://` hacia la red local (contenido mixto): la señalización de la fase 2 sale por `wss://` a un servicio público (sección 3).
- La PWA se sirve como **sitio estático** desde un origen fijo (por ejemplo `https://remoto.onyxcode.cl`, en Cloudflare Pages o GitHub Pages). Un origen estable es lo que fija el `rpId` de las passkeys: si el dominio cambia, todas las passkeys dejan de servir.
- El Mac solo acepta conexiones cuyo `origin` esté en una lista propia (por defecto, el origen oficial); la política de la organización (`docs/POLITICA-ORGANIZACION.md`) podría fijarlo.

## 2. Passkeys (WebAuthn)

**Papeles.** El Mac es la parte que confía («relying party» propia, sin servidor): genera los retos y verifica las respuestas. La PWA solo llama a `navigator.credentials`. El `rpId` es el dominio de la PWA (`remoto.onyxcode.cl`); el origen de verificación es `https://remoto.onyxcode.cl`.

**Registro (al vincular).**
1. Se vincula igual que hoy (QR con secreto de un solo uso y código de 6 dígitos comparado en el Mac).
2. Ya dentro del canal, el Mac envía un reto aleatorio (32 bytes, un uso, caduca en 60 s) y los parámetros (`rpId`, `userVerification: "required"`, `residentKey: "preferred"`, `attestation: "none"`, algoritmos ES256/EdDSA).
3. El celular crea la credencial y devuelve `clientDataJSON` + `attestationObject`. El Mac comprueba tipo, reto, origen, hash del `rpId`, bandera UV y guarda la clave pública (COSE) y el contador **dentro de `remote.bin`** (cifrado con `safeStorage`), nunca el material privado (no existe fuera del autenticador).

**Autenticación (cada conexión).** El Mac envía un reto nuevo; el celular firma con la passkey (con huella/rostro/PIN del teléfono); el Mac verifica firma, origen, `rpId`, UV y que el contador no retroceda (si el autenticador lo usa; las passkeys sincronizadas suelen dar 0).

**Relación con lo existente.**
- **PIN**: con passkey con verificación de usuario, la passkey sustituye al PIN como segundo factor de cada conexión y de la reconexión tras inactividad. El PIN queda como respaldo (dispositivo sin passkey, p. ej. navegadores que no la ofrecen) y mantiene sus límites (5 fallos revocan).
- **Confirmación en el Mac**: se mantiene. Una passkey prueba «es mi teléfono y soy yo», no «quiero esto ahora»; las acciones de clase D siguen pidiendo confirmación local ligada al hash de la llamada, y cada conexión nueva se confirma (o «Recordar 12 h»).
- **Secreto de dispositivo y caducidad**: siguen mandando (el vínculo caduca igual); la passkey se invalida al revocar.
- Ventaja de seguridad principal: una passkey no se puede copiar ni robar con JavaScript (a diferencia del PIN o del secreto de `IndexedDB`). Un script malicioso aún podría **usarla** mientras la página esté abierta: por eso la confirmación en el Mac no se quita.

**Recuperación.** Perder el teléfono: «Quitar» (o «Quitar todos») en el Mac y vincular de nuevo con QR. Perder el Mac: las passkeys no sirven sin él; hay que vincular al nuevo Mac. Passkeys sincronizadas (iCloud/Google): comodidad y recuperación, pero amplían quién podría presentarlas; no se puede distinguir de una no sincronizada con `attestation: "none"`, así que no se promete más seguridad de la real. Varias passkeys por dispositivo vinculado: no, una por vínculo, para que «Quitar» sea claro.

**Por verificar antes de construir**: soporte real de passkeys en la PWA instalada de iOS y en Android; qué librería (o código propio de ~200 líneas con `node:crypto` para ES256) verifica `attestationObject`/`authenticatorData` con un conjunto mínimo de formatos; comportamiento del contador.

## 3. Señalización en un Worker sin estado persistente

- Objetivo: que Mac y celular intercambien oferta/respuesta SDP y candidatos ICE fuera de la LAN, **sin ver ni guardar** contenido.
- Un Cloudflare Worker con una **sala efímera por vinculación** (un Durable Object con WebSockets hibernables, sin almacenamiento persistente, caduca a los 2 min; honestidad: un Worker a secas no puede unir dos conexiones, el estado mínimo y volátil de la sala es inevitable). Solo reenvía mensajes de señalización; no guarda mensajes, registros con contenido ni identidades.
- Mac y celular se identifican con un `roomId` aleatorio del QR (128 bits, un uso). El Worker limita tasa y tamaño de trama (mismos límites que `maxSignalFrameBytes`) y no autentica a nadie por sí mismo.
- **Un Worker comprometido no debe poder suplantar al Mac**: el SDP lleva las huellas DTLS y el código de 6 dígitos que el dueño compara en el Mac se deriva de ellas (hoy ya es así); después, passkey/PIN/confirmación van **dentro** del canal DTLS ya verificado.
- El Mac se conecta al Worker de forma saliente (sin abrir puertos). Con la función apagada no hay ninguna conexión.

## 4. TURN

- STUN no basta en redes móviles con CGNAT o NAT simétrico; se necesita un relé TURN. El relé solo ve tráfico ya cifrado por DTLS.
- Opciones: servicio gestionado (Cloudflare Realtime/Calls TURN u otro; **verificar condiciones y costes vigentes**) o `coturn` propio con IP pública (el Proxmox detrás de Cloudflare Tunnel **no** sirve: el túnel no reenvía UDP/TURN).
- Credenciales **efímeras** (usuario con marca de tiempo + HMAC del secreto compartido, validez de minutos) que entrega el Worker en cada sala; nunca credenciales fijas en la PWA. `iceTransportPolicy: "all"` por defecto (directo si se puede), relé como último recurso; se muestra al dueño si la conexión va por relé.
- Límite de ancho de banda por sesión y cierre al desconectar el celular.

## 5. Notificaciones (Web Push)

- **Web Push con VAPID**: el celular se suscribe (permiso pedido con un gesto del usuario) y entrega la suscripción al Mac por el canal; el Mac la guarda en `remote.bin` y envía los avisos él mismo al servicio push del navegador. No hay servidor propio con las suscripciones.
- **Avisos genéricos**, sin contenido: «OnyxCode necesita tu atención» (permiso pendiente, tarea terminada). Nunca texto de conversaciones, rutas ni nombres. El servicio push del navegador (Apple/Google/Mozilla) ve metadatos y que hay un aviso, no el contenido.
- **iOS**: solo funciona con la PWA **instalada en la pantalla de inicio** (iOS 16.4 o superior), con permiso explícito y sin notificaciones silenciosas; Safari como pestaña no recibe push. Android/Chrome funciona sin instalar. Por eso la instalación guiada de la PWA es parte de la fase.
- Se revocan al quitar el celular. Límite de avisos por hora para no usar el canal como vía de spam.
- Con el Mac dormido o apagado no hay aviso (el Mac es quien lo emite): se documenta, no se promete lo contrario.

## 6. Instalación de la PWA y service worker

- `manifest.webmanifest` (nombre, iconos, `display: standalone`, `start_url` dentro del origen) y un aviso propio de «Añadir a pantalla de inicio» (en iOS no hay evento `beforeinstallprompt`).
- **Service worker solo para el cascarón estático** (HTML/JS/CSS/iconos), con caché versionada y actualización controlada (aviso «Hay una versión nueva»). Nunca cachea el canal, ni respuestas con contenido, ni guarda secretos. Funciona sin él (degrada a recargar).
- Almacenamiento: la identidad del vínculo en `IndexedDB`; pedir `navigator.storage.persist()`. Safari puede borrar el almacenamiento de sitios sin uso: lo cubre la recuperación por QR.
- CSP estricta en la PWA (`connect-src` solo al Worker; sin terceros), cabeceras de seguridad y SRI/hashes de los scripts.

## 7. Riesgos principales

| Riesgo | Mitigación prevista |
|---|---|
| **Cadena de suministro de la PWA**: quien controle el despliegue estático controla el JavaScript que ve el PIN/secreto | Passkeys (no exportables), confirmación en el Mac, origen en lista blanca del Mac, despliegues solo desde CI con revisión, hash de la versión visible en el Mac, SRI |
| Worker/TURN comprometido o caído | No ven contenido ni credenciales; código de 6 dígitos de las huellas DTLS; fallo = la LAN sigue funcionando (modo local se conserva) |
| Aumenta la superficie: un servicio público que antes no existía | Sin estado persistente, límites de tasa, nada que registrar; el control remoto sigue apagado por defecto y se corta con «Cortar todo» |
| Passkeys sincronizadas en la nube del usuario | Informar; la confirmación y la caducidad no dependen de la passkey |
| Dependencia del dominio (`rpId`) | Dominio propio y estable; cambiarlo exige revincular todo |
| Privacidad: IP y metadatos visibles para el Worker/TURN/push | Documentarlo en la política de privacidad antes de lanzar; sin identificadores de cuenta |
| iOS limita push y almacenamiento | Instalación guiada; recuperación por QR |
| Política de la organización | Un bloque `remote` hoy no cubre «solo LAN»: añadir una clave (`allowRemoteAccess`) con la misma semántica fail closed antes de ofrecerlo |
| Coste operativo (Workers, TURN) | Medir antes; tope de uso; apagar la señalización pública sin romper el modo local |

## 8. Orden sugerido

1. HTTPS + origen estable + instalación de la PWA + service worker (sin cambiar la seguridad).
2. Señalización por Worker, solo con STUN (LAN y Wi-Fi comparable).
3. Passkeys con el PIN de respaldo.
4. TURN.
5. Web Push.

Cada paso entra con su prueba, su sección en `docs/SEGURIDAD.md` y la política de la organización actualizada. Nada de esto requiere cuentas de usuario del servidor `api.onyxcode.cl` ni se aprueba sin una decisión del dueño sobre dominio, coste y privacidad.
