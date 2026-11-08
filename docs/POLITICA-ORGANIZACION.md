# Política de la organización (`managed.json`)

Lazunox lee, solo lectura, un archivo `managed.json` que solo un administrador puede escribir:

| Sistema | Ruta                                                |
| ------- | --------------------------------------------------- |
| macOS   | `/Library/Application Support/Lazunox/managed.json` |
| Windows | `%ProgramData%\Lazunox\managed.json`                |

En desarrollo (app NO empaquetada) se puede forzar otra ruta con la variable `LAZUNOX_MANAGED_POLICY`. En la app
empaquetada esa variable se ignora. El archivo se relee cuando cambia (mtime/tamaño); no hace falta reiniciar.

Este documento describe el bloque **`remote`** (control remoto desde el celular). Las claves de Tareas
(`disableFullAccess`, `allowedFolderRoots`, `disableCustomHosts`, `extraAllowedHosts`, `disableAlwaysAllow`,
`disableRoutines`, `disableAutoMode`, `disableBrowser`, `disableWslTasks`, `disableComputerUse`, `disableHostCommands`, `maxAutoArchiveDays`) viven en el mismo archivo y se leen en
`src/main/tasks/policy.ts`.

`disableComputerUse` (booleano) apaga **el control de apps desde el chat aislado** (el puente de apps del modo unificado) para
toda la organización. Es independiente de `disableFullAccess`: esa clave apaga el modo sin aislamiento; esta solo apaga el control
de apps. Se valida igual que el resto de booleanos y falla cerrado: cualquier valor distinto de `false` cuenta como `true`, y un
`managed.json` ilegible o inválido también lo activa. Si la clave no está, el control de apps sigue permitido. Por ahora la clave
se lee y se valida, pero todavía no cambia nada visible: el cableado al puente llega en una entrega posterior.

`disableWslTasks` (booleano) apaga **Tareas en Windows** (WSL2, beta) para toda la organización: aunque el usuario active
«Tareas (beta)», la bandera efectiva `tasksWin` queda apagada. Se valida como el resto de booleanos y falla cerrado: cualquier
valor distinto de `false` (texto, número, `null`) cuenta como `true`, y un `managed.json` ilegible o inválido también lo activa.
No tiene efecto en macOS. **Estado 2026-11-06 (1.8.11).** La puerta de compilación `TASKS_WIN_BUILD` está encendida, así que Overdrive (Tareas) existe en Windows y esta clave sí lo apaga. (Con la puerta apagada, como en versiones anteriores, esta clave no cambiaba nada visible.)

## Bloque `remote`

```json
{
  "remote": {
    "enabled": true,
    "allowRemember": true,
    "requirePin": true,
    "maxDevices": 2,
    "deviceTtlDays": 30,
    "allowConfirmRemember12h": false,
    "requireConnectionConfirm": false,
    "allowOutsideNetwork": false,
    "allowRelay": false,
    "allowPush": false,
    "requirePasskey": false,
    "allowTravelMode": false,
    "travelMaxHours": 4,
    "allowTravelRelay": false,
    "allowTravelDownload": false
  }
}
```

Todas las claves son opcionales. Sin la clave, rige el comportamiento normal de la app. **Excepción**: las tres de «fuera de casa»
(`allowOutsideNetwork`, `allowRelay`, `allowPush`) valen `false` en cuanto existe un `managed.json` y no las dice expresamente
(una política escrita antes de esa función no la autorizó); sin archivo valen `true`. Lo mismo vale para las del **modo viaje**
(`allowTravelMode`, `allowTravelRelay`, `allowTravelDownload`) y `travelMaxHours` (con archivo y la clave ausente, 1 hora).

| Clave                      | Tipo         | Efecto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                  | booleano     | `false` deshabilita el control remoto: no se puede activar y, si estaba activo, se cortan de inmediato las conexiones vivas.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `allowRemember`            | booleano     | `false`: los vínculos no sobreviven a «Cortar todo» ni a un reinicio (se borran al activar y al cortar); cada uso exige vincular de nuevo con QR.                                                                                                                                                                                                                                                                                                                                                                                 |
| `requirePin`               | booleano     | `true`: el PIN se pide en CADA conexión (sin reconexión «en caliente» de 5 min). Hoy el PIN ya es obligatorio siempre; `false` no lo relaja.                                                                                                                                                                                                                                                                                                                                                                                      |
| `maxDevices`               | entero 0–3   | Máximo de celulares vinculados (0 = no se puede vincular ninguno; 3 es el tope de fábrica).                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `deviceTtlDays`            | entero 1–365 | Tope de validez de un vínculo desde su último uso. Manda sobre lo que elija el usuario, también sobre «Sin caducidad».                                                                                                                                                                                                                                                                                                                                                                                                            |
| `allowConfirmRemember12h`  | booleano     | `false`: se quita «Recordar 12 h»; cada conexión se confirma en el Mac.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `requireConnectionConfirm` | booleano     | `true`: cada conexión de un celular ya vinculado se confirma en el Mac y el usuario no puede apagar el ajuste «Pedir confirmación en el Mac en cada conexión». Desde el protocolo v3 esa confirmación es opcional y viene **apagada** por defecto (el celular entra con su PIN); esta clave devuelve el comportamiento anterior. Un dispositivo sin PIN siempre confirma, y la vinculación de un celular nuevo siempre se confirma.                                                                                               |
| `allowOutsideNetwork`      | booleano     | `false`: «Solo esta red». El modo «También fuera de casa» no existe: no se abre **ningún** socket hacia el servicio de conexión, el selector de Ajustes lo explica y, si estaba en marcha, se corta al instante (queda `policy-blocked` en la actividad). Con archivo y la clave ausente vale `false`.                                                                                                                                                                                                                            |
| `allowRelay`               | booleano     | `false`: el Mac no concede relé (TURN) a ningún celular; solo conexión directa. Con archivo y la clave ausente vale `false`.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `allowPush`                | booleano     | `false`: sin avisos al celular (función de una entrega posterior). Con archivo y la clave ausente vale `false`.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `requirePasskey`           | booleano     | `true`: el acceso exige una passkey además del PIN. Hasta que existan las passkeys (entrega posterior) el modo «También fuera de casa» queda bloqueado si se exige, porque no puede cumplirlo; la red local sigue como siempre. Ausente = `false`; presente y distinto de `false` exacto = `true`.                                                                                                                                                                                                                                |
| `allowTravelMode`          | booleano     | `false`: el **modo viaje** (túnel rápido de Cloudflare, sin cuenta) no existe: no se abre ningún puerto ni proceso `cloudflared`, el selector de Ajustes lo explica y, si estaba en marcha, se corta al instante (`policy-blocked` en la actividad) y se borra su vínculo. Sin archivo `true`; con archivo y la clave ausente `false`. Además el modo viaje queda bloqueado si `requireConnectionConfirm` o `requirePasskey` están activos (o si el usuario pidió confirmar cada conexión): lejos de casa nadie podría confirmar. |
| `travelMaxHours`           | entero 1–24  | Vida máxima del túnel de viaje, también con «Cerrar a los 30 min sin uso». Sin archivo 24; con archivo y la clave ausente, no entera o rara, 1; un entero fuera de rango se recorta.                                                                                                                                                                                                                                                                                                                                              |
| `allowTravelDownload`      | booleano     | `false`: la app no descarga `cloudflared`. Una organización puede preinstalarlo en `~/Library/Application Support/Lazunox/bin/cloudflared-<versión>/cloudflared` (permisos 0700) con el mismo binario del pin: se verifica su SHA-256 y su firma (Developer ID de Cloudflare Inc., equipo `68WVV388M8`) antes de cada arranque. Con archivo y la clave ausente `false`.                                                                                                                                                           |
| `allowTravelRelay`         | booleano     | Reservada para el respaldo cifrado por el WebSocket del túnel (entrega posterior; hoy no hace nada). Misma regla que `allowRelay`.                                                                                                                                                                                                                                                                                                                                                                                                |

## Política del motor (`motor-policy.json`, 1.8.12)

Desde la 1.8.12 la app pasa al motor `LAZUNOX_POLICY_FILE` apuntando a un archivo que solo un administrador escribe, y solo si existe:

| Sistema | Ruta |
|---|---|
| macOS   | `/Library/Application Support/Lazunox/motor-policy.json` |
| Windows | `%ProgramData%\Lazunox\motor-policy.json`                |

Formato (listas `deny` de proveedores, modelos, MCP, herramientas, habilidades y agentes): `LAZUNOX.md` del motor, sección «7.20 Políticas
duras de nivel superior». Archivo ausente (o enlace roto) = sin política; ilegible o inválido = el motor deniega todo. La app no lo escribe ni
lo valida y no llega a Overdrive. En Windows, crea la carpeta tú y quita la herencia de permisos de la CARPETA
(`icacls "%ProgramData%\Lazunox" /inheritance:r`), o un usuario normal podría ser su dueño y borrar el archivo. Detalle y residuales:
`docs/SEGURIDAD.md`, «3 octogies terdecies».
