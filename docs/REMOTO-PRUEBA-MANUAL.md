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

## Qué mandar si algo falla
Número de paso, qué esperabas, qué viste (captura del celular si se puede), hora aproximada, y las últimas 20 líneas de `remote-audit.jsonl`.
Nunca copies el PIN ni el contenido de `remote.bin`.
