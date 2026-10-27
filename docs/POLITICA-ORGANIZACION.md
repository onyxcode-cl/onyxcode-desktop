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
`disableRoutines`, `disableAutoMode`, `disableBrowser`, `disableWslTasks`, `disableComputerUse`, `maxAutoArchiveDays`) viven en el mismo archivo y se leen en
`src/main/tasks/policy.ts`.

`disableComputerUse` (booleano) apaga **el control de apps desde el chat aislado** (el puente de apps del modo unificado) para
toda la organización. Es independiente de `disableFullAccess`: esa clave apaga el modo sin aislamiento; esta solo apaga el control
de apps. Se valida igual que el resto de booleanos y falla cerrado: cualquier valor distinto de `false` cuenta como `true`, y un
`managed.json` ilegible o inválido también lo activa. Si la clave no está, el control de apps sigue permitido. Por ahora la clave
se lee y se valida, pero todavía no cambia nada visible: el cableado al puente llega en una entrega posterior.

`disableWslTasks` (booleano) apaga **Tareas en Windows** (WSL2, beta) para toda la organización: aunque el usuario active
«Tareas (beta)», la bandera efectiva `tasksWin` queda apagada. Se valida como el resto de booleanos y falla cerrado: cualquier
valor distinto de `false` (texto, número, `null`) cuenta como `true`, y un `managed.json` ilegible o inválido también lo activa.
No tiene efecto en macOS. Mientras la puerta de compilación `TASKS_WIN_BUILD` siga apagada, Tareas en Windows no existe y esta
clave no cambia nada visible.

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

## Política del motor (`LAZUNOX_POLICY_FILE`): estado actual, SIN conectar

El motor propio (Ola 7, 7.20) sabe leer un archivo de política con listas `deny` (proveedores, modelos, MCP, herramientas, habilidades y
agentes) que la app le fija con la variable `LAZUNOX_POLICY_FILE` (ruta absoluta, en la carpeta de datos de la app y nunca dentro de un
proyecto). Formato y comportamiento exactos: `LAZUNOX.md` del motor, sección «7.20 Políticas duras de nivel superior».

**La app todavía NO la usa.** Ninguna parte del código de la app escribe ese archivo ni fija esa variable (se comprobó con una búsqueda en
`src` y `scripts`), así que hoy no cambia nada de lo que ve o hace una persona, y `managed.json` no se traduce a esa política. Lo que sí
existe hoy es lo de este documento: el bloque `remote` y las claves de Tareas, que se aplican dentro de la app.

Si más adelante se conecta, el diseño que se propone (sin probar) es:

- Que `managed.json` pueda traer un bloque `engine` con las mismas listas `deny`, y que la app lo escriba en `userData` (modo 0600, escritura
  atómica) antes de lanzar el motor y pase su ruta absoluta en `LAZUNOX_POLICY_FILE`. Debe ir por el mismo punto que ya fija otras variables del
  motor (`src/main/opencode/engine-flags-restart.ts`), y cambiarla debe reiniciar el motor cuando no haya nada en curso.
- Falla cerrado también aquí: si el archivo de la organización es ilegible, se escribe una política que niega todo o no se arranca el motor;
  nunca se arranca «sin política» por un error. Ojo: el motor trata un archivo AUSENTE como «sin política» y uno ROTO como «deniega todo».
- La política del motor solo añade negaciones. No sustituye `disableWslTasks` ni las claves de Tareas, que siguen aplicándose en la app.
- Un proveedor denegado se evalúa al cargar la instancia del motor: un cambio de política no lo quita en caliente hasta reiniciar.
- Hay que probar con el motor real (archivo ausente, roto, y un `deny` de proveedor, de MCP y de herramienta) antes de prometerlo a una
  organización. Hasta entonces no se debe ofrecer como función.

## Semántica fail closed

- **Sin archivo**: no hay restricciones de la organización.
- **Archivo presente pero ilegible, vacío, con JSON inválido o que no es un objeto**: control remoto DESHABILITADO. Ajustes
  muestra «Bloqueado por la política de tu organización» y explica que el archivo no es válido.
- **`remote` presente pero no es un objeto** (`"remote": "sí"`, `null`, lista): DESHABILITADO.
- **`enabled`**: solo `true` lo deja activo. `false` = deshabilitado; cualquier otro valor (`"true"`, `1`, `null`) =
  deshabilitado por inválido.
- Booleanos que **relajan** (`allowRemember`, `allowConfirmRemember12h`, `allowOutsideNetwork`, `allowRelay`, `allowPush`): solo `true` exacto los permite; todo lo demás cuenta `false`. Con archivo, las tres últimas ausentes también valen `false`; con un archivo inválido, las tres valen `false`.
- Modo viaje: `allowTravelMode`, `allowTravelRelay` y `allowTravelDownload` relajan (solo `true` exacto permite; con archivo y la clave ausente, `false`; con un archivo inválido, `false`). `travelMaxHours`: entero 1–24 (se recorta); no entero o ausente con archivo = 1.
- Booleano que **endurece** y no viene activado (`requirePasskey`): ausente = `false`; presente y distinto de `false` exacto = `true`; con un archivo inválido, `true`.
- Booleano que **endurece** (`requirePin`): solo `false` exacto lo desactiva; todo lo demás cuenta `true`.
- Booleano que endurece pero **no viene activado** (`requireConnectionConfirm`): ausente = `false`; presente y distinto de `false` exacto (`true`, `"sí"`, `1`…) = `true`. Con un archivo inválido queda en `true`.
- Números: un entero fuera de rango se recorta (`maxDevices` > 3 → 3, `deviceTtlDays` > 365 → 365; negativos → 0 y 1). Un valor que no
  es un entero cuenta como lo más restrictivo (`maxDevices` 0, `deviceTtlDays` 1).
- Las claves desconocidas se ignoran.

La política manda sobre los ajustes del usuario y sobre variables de entorno; el usuario no puede desactivarla desde la app.
Cada cambio se aplica al activar, en cada conexión y cada 5 s mientras el control remoto está encendido.

## Despliegue

El archivo debe pertenecer a root/Administradores y no ser escribible por el usuario (si el usuario pudiera escribirlo, podría
quitar la política).

### Jamf Pro (macOS)

Opción A, script de política (se ejecuta como root):

```bash
#!/bin/bash
set -euo pipefail
dir="/Library/Application Support/Lazunox"
mkdir -p "$dir"
cat > "$dir/managed.json" <<'JSON'
{ "remote": { "enabled": true, "requirePin": true, "deviceTtlDays": 30, "allowConfirmRemember12h": false } }
JSON
chown root:wheel "$dir/managed.json"
chmod 644 "$dir/managed.json"
```

Opción B: un paquete `.pkg` que instale el archivo en esa ruta (propietario `root:wheel`, modo `644`). Para deshabilitar el control
remoto en toda la flota basta con `{ "remote": { "enabled": false } }`.

### Microsoft Intune

- **macOS**: script de shell (Dispositivos › macOS › Scripts) con el mismo contenido que el script de Jamf, ejecutado como root.
- **Windows**: script de PowerShell (Dispositivos › Windows › Scripts), ejecutado con el contexto del sistema:

```powershell
$dir = Join-Path $env:ProgramData 'Lazunox'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$json = '{ "remote": { "enabled": false } }'
Set-Content -Path (Join-Path $dir 'managed.json') -Value $json -Encoding UTF8
icacls (Join-Path $dir 'managed.json') /inheritance:r /grant:r 'SYSTEM:(F)' 'Administrators:(F)' 'Users:(R)' | Out-Null
```

(El control remoto hoy solo existe en macOS; el bloque `remote` se lee igual en Windows para cuando llegue.)

## Cómo comprobarlo

1. Escribe el archivo y abre Ajustes › Celular: debe aparecer «Bloqueado por la política de tu organización» si `enabled` es `false` o el archivo es inválido.
2. Con el control remoto activo y un celular conectado, cambia `enabled` a `false`: en 5 s como máximo se corta todo y se anota «Cortado por la política de tu organización» en Actividad.
3. Borra el archivo: la función vuelve a depender solo de los ajustes del usuario.

Aún no se ha probado con Jamf ni Intune reales; las pruebas automáticas usan archivos temporales (`src/main/remote/org-policy*.test.ts`).
