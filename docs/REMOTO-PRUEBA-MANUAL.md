# Prueba manual del control remoto (celular, misma Wi-Fi)

Ya probado: activar y escanear, vincular con PIN, crear un chat y enviar un mensaje. Esta lista cubre lo que falta.
Marca cada paso con [x] si salió como se describe. Si no, anota lo que se pide en «Si falla».

**Cómo leer el registro (cuando algo se rechaza).** En el Mac, abre Terminal y pega:
`tail -n 20 ~/Library/Application\ Support/OnyxCode/remote-audit.jsonl`
Cada línea es un suceso: `kind` (qué pasó), `ts` (hora en milisegundos), `device` (huella del celular), `ch` (qué pidió) y
`why` (el motivo corto del rechazo, p. ej. `out-of-scope`). Copia las últimas líneas. También se ve en Ajustes › Celular › Actividad.

## Protocolo v3: reconexión sin diálogo y vinculación (F8-B66)
0. [ ] **Un iPhone ya vinculado reconecta sin volver a vincular y sin diálogo en el Mac.** Con la versión nueva instalada y el ajuste «Pedir confirmación en el
   Mac en cada conexión» APAGADO (por defecto), abre la página en un celular que ya estaba vinculado: debe conectar, pedir el PIN en frío y **no aparecer ningún
   diálogo en el Mac**. En Ajustes › Celular › Actividad debe verse `connected` en cada conexión. Si falla: anota el texto del aviso del celular («No se pudo verificar tu Mac»,
   «Tu Mac no reconoció este celular»…) y las últimas líneas del registro (`auth-bad-proof`). Este paso también prueba que el SDP real del navegador pasa la comprobación estricta de huellas.
0b. [ ] **Activar «Pedir confirmación en el Mac en cada conexión».** Reconecta: vuelve el diálogo «Permitir» (con «Recordar 12 h»). Apágalo: el diálogo desaparece y «Recordar 12 h» se borra.
0c. [ ] **Vincular un celular nuevo.** Los dos códigos de 6 dígitos coinciden y el del celular aparece solo después de que la conexión con el Mac se verifica. Si alguien escanea un QR distinto
   o falla 5 veces seguidas, el QR se anula («El código QR se anuló tras varios intentos fallidos. Genera otro.»).
0d. [ ] **Pestaña abierta antes de actualizar.** Con la página del celular abierta de la versión anterior, actualiza el Mac y reconecta: debe decir «Versión incompatible» (las pestañas anteriores no
   saben recargarse: basta recargar a mano una vez). Las pestañas de la versión nueva se recargan solas una vez.
0e. [ ] **«Bloquear ahora» con la vista de chat abierta:** no deben llegar eventos nuevos hasta escribir el PIN; tras el PIN, aparecen los pendientes.
0f. [ ] **«Cortar todo» y reactivar:** al volver a conectar pide PIN (aunque hayan pasado menos de 5 min) y, con el ajuste encendido, el «Permitir».

## Bloqueo y reconexión
1. [ ] **Bloquear 1 min y volver.** En el celular: Más › Conexión con tu Mac › «Bloquear ahora». Espera 1 minuto y escribe el PIN.
   Debe: pedir el PIN al bloquear; no dejar hacer nada hasta ponerlo; con el PIN correcto vuelve a funcionar. Con un PIN malo debe
   esperar unos segundos (1, 2, 4… hasta 30 s) y 5 fallos seguidos quitan el celular. Si falla: anota si pidió o no el PIN y el `kind` `locked`/`pin-fail`.
2. [ ] **Reconexión tras bloquear la pantalla del celular.** Bloquea el celular 1-2 min, desbloquéalo y abre la página. Debe: mostrar
   «Reconectando con tu Mac…» y volver solo; si pasaron más de 5 min sin usarlo o es una conexión en frío, pide el PIN; solo si activaste «Pedir confirmación
   en el Mac en cada conexión» (y no marcaste «Recordar 12 h») el Mac pide «Permitir». Si falla: anota el texto del aviso y cuánto tardó.

## Mensajes y permisos
3. [ ] **Aprobar y rechazar un permiso.** Desde el celular pide algo que obligue a un permiso (p. ej. editar un archivo en un proyecto de Code). Debe
   aparecer en el celular con solo «Permitir una vez» y «Rechazar» (no existe «Siempre»). Prueba una vez cada una: el agente sigue o se detiene.
   Los permisos de controlar el Mac o de carpetas externas solo dicen «Apruébalo en el Mac». Si falla: anota qué permiso era y el `why`.
4. [ ] **Detener una respuesta.** Pide algo largo y pulsa Detener en el celular. Debe parar en pocos segundos, también en el Mac.
5. [ ] **Tareas no deben verse.** Con una sesión de Tareas abierta en el Mac, mira la lista de chats del celular. Debe mostrar solo Chat y
   proyectos recientes de Code; ninguna de Tareas. Si aparece una: anótala (es un fallo de seguridad) y corta con «Cortar todo».
6. [ ] **Abrir proyecto desde el celular.** Pide abrir una carpeta nueva. Debe aparecer un aviso en el Mac (y rebote en el Dock) con
   «Rechazar» enfocado y «Permitir» activo tras 1,5 s; sin respuesta se rechaza a los 90 s. Prueba rechazar y luego permitir.
   Si no aparece o abre sin preguntar: anota la hora y el `ch`/`why` del registro.

## Vínculos y caducidad
7. [ ] **Recordar 12 h** (solo con «Pedir confirmación en el Mac en cada conexión» encendido). Al reconectar, en el Mac marca «Recordar 12 h en este celular» y pulsa «Permitir». Reconecta de nuevo: no debe pedir
   «Permitir» otra vez (el PIN sí puede pedirse). También se activa en Ajustes › Celular › «Recordar 12 h». Si falla: anota si volvió a pedir y cuándo.
8. [ ] **Caducidad del dispositivo.** En Ajustes › Celular elige 30, 90, 365 días o «Sin caducidad» para ese celular. Debe mostrar la fecha
   de caducidad (o «No caduca») y recordar el plazo al reabrir Ajustes. Para ver el caso caducado, cambia la fecha del Mac a más de 30 días
   adelante: el celular debe decir que debe volver a vincularse, Ajustes muestra «Caducado» y el registro `expired`. Devuelve la fecha del Mac después.
9. [ ] **Revocar desde el Mac.** En Ajustes › Celular pulsa «Quitar» en el celular conectado y confirma. Debe cortarse al instante y al
   volver a entrar debe pedir vincular de nuevo. Si falla: anota cuántos segundos tardó y el `kind` `revoked`.
10. [ ] **«Cortar todo».** Con el celular conectado, pulsa «Cortar todo» (Ajustes o menú de la barra superior). Deben cerrarse las conexiones, apagarse
    el modo y dejar de abrir la dirección. Un QR anterior ya no sirve. Anota si el celular siguió respondiendo.

## Red y tiempos
11. [ ] **QR caducado (120 s).** Genera un QR, espera más de 2 minutos sin escanear y luego escanéalo. Debe decir
    «El código QR caducó o ya se usó. Genera otro.» Genera uno nuevo y escanea de inmediato: debe funcionar. Escanear el mismo QR dos veces
    también debe fallar la segunda. Si falla: anota los segundos reales que esperaste.
12. [ ] **Wi-Fi con aislamiento de clientes.** Conecta el celular a una red de invitados (o activa «aislamiento» en el router) y abre el enlace.
    Debe decir «no se encuentra el equipo» (esperado: la función necesita que ambos se vean en la red). Anota el nombre de la red y el texto exacto.
13. [ ] **Apagado a los 30 min sin conexiones.** Activa el modo, desconecta el celular (o ciérralo) y no lo uses 30 minutos. Al cabo de ese tiempo
    el modo debe quedar apagado solo (Ajustes lo muestra desactivado y la dirección ya no abre). Si sigue activo: anota la hora de desconexión
    y la de la revisión; en el registro busca `stopped`.

## Fuera de casa (F8-B77, entrega 1) — requiere publicar el sitio y el servicio (los pasos son del dueño: `cloud/remoto-worker/README.md`)
Antes: sitio publicado en `remoto.onyxcode.cl`, `SITE_PUBLIC_KEY` puesta en `src/shared/brand.ts` (si no, la vigilancia dirá «sin verificar» y todo lo demás funciona) y Lazunox empaquetado con ella. TURN está apagado: la prueba 5 solo vale si lo activas.
14. [ ] **Vincular en casa con «También fuera de casa».** Ajustes › Celular › Dónde se puede usar › «También fuera de casa», «Activar». Debe verse el QR **y** un código de 16 caracteres. Android: escanea el QR con la cámara; iPhone: abre la página en Safari, instálala
    («Compartir › Añadir a pantalla de inicio») y **escribe el código dentro de la app instalada**. Los códigos de 6 dígitos coinciden y al aceptar en el Mac queda vinculado. Si falla: anota el texto de la pantalla del celular y la actividad (`kind`).
15. [ ] **Fuera de la Wi-Fi (solo datos móviles).** Reconecta: pide el PIN y **no aparece ningún diálogo en el Mac** (salvo que hayas activado «Pedir confirmación en el Mac en cada conexión»). El chat en vivo funciona.
16. [ ] **De datos a Wi-Fi a mitad.** Reconecta solo; si pasaron menos de 5 min desde la última actividad, sin PIN.
17. [ ] **Mac dormido.** El celular dice «Tu Mac no está disponible… Lazunox no puede despertarlo a distancia»; al despertar el Mac y pulsar «Reintentar» conecta. Mira Ajustes: «Servicio de conexión: sin conexión» mientras dormía.
18. [ ] **Red que bloquea UDP** (compartir datos de otro teléfono con restricciones). Sin TURN debería fallar con «No se encuentra el equipo»; con TURN activado, conecta y Ajustes dice «La conexión actual pasa por un relé».
19. [ ] **Ajustes.** Estado del servicio en línea, «Página del celular verificada» (con la clave puesta), «Cortar todo» cierra el servicio **y apaga «Disponible fuera de casa»**; con «Disponible fuera de casa» encendido, al reabrir Lazunox el servicio arranca solo sin QR.
20. [ ] **Política.** Con `managed.json` con `remote.allowOutsideNetwork:false` (o sin esa clave en un archivo existente): el selector queda en «Solo esta red», lo explica y no hay conexión saliente (mira `lsof -i -P | grep Lazunox`).
21. [ ] **Sitio alterado (prueba de la vigilancia, opcional).** Cambia un byte de un archivo publicado sin volver a firmar: en la siguiente comprobación (o al reactivar) Ajustes dice «La página del celular no coincide con la versión firmada», la nube queda en pausa y la actividad muestra `site-mismatch`; la red local sigue.
22. [ ] **Versiones distintas.** Con la app del Mac de una versión anterior al sitio, la página debe seguir conectando (v3) o decir «Actualiza la página del celular o Lazunox en tu Mac».
(Entrega 2, no incluida: passkey con Face ID + PIN. Entrega 3: aviso genérico con la app cerrada en iPhone instalado.)

## Modo viaje (sin cuenta, experimental) — F8-B86
Hace falta: el Mac en casa con Lazunox abierta, un celular con **datos móviles de tu operadora** (Wi-Fi apagada) y acceso a **otra Wi-Fi** (casa de un familiar, café). Nada de esto se ha probado todavía con redes reales: los resultados de cada paso son los que faltan para la tabla de `docs/SEGURIDAD.md` §3 quadragies. Si en el Mac hay un `cloudflared` tuyo con `~/.cloudflared/config.yml`, anótalo.
23. [ ] **Elegir el modo y descargar.** Ajustes › Celular › Dónde se puede usar › «Modo viaje (sin cuenta), experimental». Debe verse la explicación con sus límites y, en el botón de arriba, «Descargar y activar». Púlsalo: aparece el diálogo con «unos 20 MB», el origen oficial, la verificación de firma y huellas y «se puede borrar». Prueba **Cancelar**: no debe descargar nada (comprueba que `~/Library/Application Support/OnyxCode/bin` no tenga `cloudflared-*`). Repite y acepta: estado «Descargando y verificando…», luego «Abriendo el enlace…», «Comprobando que el enlace responde…» y «Enlace activo» con el nombre `…trycloudflare.com` y el QR («válido solo para este túnel»). Si falla: anota el texto rojo exacto y las últimas líneas del registro (`travel-binary-*`).
24. [ ] **Vincular en casa.** Con el celular en la Wi-Fi de casa escanea el QR: la página debe decir que es un enlace temporal y que no se instala. Los códigos de 6 dígitos coinciden, aceptas en el Mac y el celular **te obliga a crear un PIN**. Guarda la página en favoritos. Si falla: anota el texto del celular.
25. [ ] **Salir de casa con datos móviles.** Apaga la Wi-Fi del celular y abre el favorito: debe pedir el PIN **sin ningún diálogo en el Mac** y conectar. En este modo no hay un indicador de «directa/relé»: anota cuánto tardó en conectar y, si no conecta, el texto de la pantalla («Tu red bloquea la conexión directa», «El enlace caducó», «El Mac no responde»). Anota **operadora**, si el teléfono tiene IPv6 y si es 4G o 5G. Repite con cada operadora que tengas.
26. [ ] **Otra Wi-Fi.** Con el celular en la Wi-Fi de otra casa (y luego en un café u hotel), abre el favorito. Anota si carga, si conecta, y el texto si no. En una red de empresa, si puedes: lo esperable es que ni cargue la página.
27. [ ] **Reconectar.** Bloquea el celular 2 minutos y vuelve: «Reconectando…» y vuelve solo (sin PIN si pasaron < 5 min). Cierra la pestaña y reábrela desde favoritos: pide PIN y conecta.
28. [ ] **Bloquear y volver.** En el celular: Más › Conexión con tu Mac › «Bloquear ahora» y escribe el PIN. Debe volver a funcionar.
29. [ ] **Mac dormido.** Con el celular fuera de casa, duerme el Mac 10 minutos y despiértalo: ¿el favorito sigue funcionando (misma URL) o dice «El enlace caducó»? Repite con **2 horas** si puedes (esto aún NO está verificado: anota el resultado). Mientras duerme debe decir «El Mac no responde».
30. [ ] **Reinicio del túnel.** Con el modo activo, sal de Lazunox (⌘Q) y ábrela otra vez, activa el modo viaje: el nombre del túnel **es otro** y el favorito viejo debe decir «El enlace caducó, vuelve a escanear el código en casa». En Ajustes debe haberse vaciado el celular de viaje. Comprueba además `ps aux | grep cloudflared` (solo debe haber el del túnel nuevo) y tras ⌘Q, **ninguno**. Prueba también `kill -9` a Lazunox: en ≤ 3 s no debe quedar `cloudflared`.
31. [ ] **Cortar todo.** Con el celular conectado fuera de casa, pulsa «Cortar todo»: el celular dice «Modo viaje cerrado» (su vínculo se borra) y el favorito viejo ya no carga. Anota si hubo un aviso antes del corte.
32. [ ] **Duración.** Con «Cerrar a los 30 min sin uso» deja el túnel sin conectar 30 minutos: debe cerrarse solo. Con «Mantener abierto hasta 4 h» debe verse «Se corta en …» con cuenta atrás. Con `travelMaxHours` en la política, el selector no debe ofrecer más que el tope.
33. [ ] **Enlace caducado.** Con un túnel cerrado, abre el favorito: Cloudflare mostrará su propio error (la página no carga; es lo esperado). Si la pestaña estaba abierta, la PWA debe mostrar «El enlace caducó». Anota qué viste.
34. [ ] **Bloqueos.** Activa «Pedir confirmación en cada conexión»: el modo viaje queda bloqueado con explicación (no abre nada). Con `managed.json` con `allowTravelMode:false` el selector lo deshabilita; con `allowTravelDownload:false` no debe descargar nada.
35. [ ] **Sin el modo.** Con «Solo esta red» elegido no debe haber ningún `cloudflared` ni puerto del túnel (`lsof -i -P | grep -i cloudflared` vacío).

**Si el Modo viaje falla, anota:** número de paso, operadora o nombre de la red, 4G/5G/Wi-Fi, si el teléfono tiene IPv6, iPhone o Android y navegador, hora exacta, el texto de la pantalla del celular, el estado y el texto rojo de Ajustes, `ps aux | grep cloudflared`, y las últimas 20 líneas de `remote-audit.jsonl` (busca `travel-started`, `travel-stopped`, `travel-url-changed`, `travel-ice-failed`, `travel-gate-reject`). No copies el enlace completo (lleva la clave de acceso `/k/…`): basta el nombre sin esa parte.

## Qué mandar si algo falla
Número de paso, qué esperabas, qué viste (captura del celular si se puede), hora aproximada, y las últimas 20 líneas de `remote-audit.jsonl`.
Nunca copies el PIN ni el contenido de `remote.bin`.
