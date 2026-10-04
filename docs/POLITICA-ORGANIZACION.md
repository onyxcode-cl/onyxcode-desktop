# Política de la organización (`managed.json`)

OnyxCode lee, solo lectura, un archivo `managed.json` que solo un administrador puede escribir:

| Sistema | Ruta |
| --- | --- |
| macOS | `/Library/Application Support/OnyxCode/managed.json` |
| Windows | `%ProgramData%\OnyxCode\managed.json` |

En desarrollo (app NO empaquetada) se puede forzar otra ruta con la variable `ONYXCODE_MANAGED_POLICY`. En la app
empaquetada esa variable se ignora. El archivo se relee cuando cambia (mtime/tamaño); no hace falta reiniciar.

Este documento describe el bloque **`remote`** (control remoto desde el celular). Las claves de Tareas
(`disableFullAccess`, `allowedFolderRoots`, `disableCustomHosts`, `extraAllowedHosts`, `disableAlwaysAllow`,
`disableRoutines`, `disableAutoMode`, `disableBrowser`, `maxAutoArchiveDays`) viven en el mismo archivo y se leen en
`src/main/tasks/policy.ts`.

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
    "requireConnectionConfirm": false
  }
}
```

Todas las claves son opcionales. Sin la clave, rige el comportamiento normal de la app.

| Clave | Tipo | Efecto |
| --- | --- | --- |
| `enabled` | booleano | `false` deshabilita el control remoto: no se puede activar y, si estaba activo, se cortan de inmediato las conexiones vivas. |
| `allowRemember` | booleano | `false`: los vínculos no sobreviven a «Cortar todo» ni a un reinicio (se borran al activar y al cortar); cada uso exige vincular de nuevo con QR. |
| `requirePin` | booleano | `true`: el PIN se pide en CADA conexión (sin reconexión «en caliente» de 5 min). Hoy el PIN ya es obligatorio siempre; `false` no lo relaja. |
| `maxDevices` | entero 0–3 | Máximo de celulares vinculados (0 = no se puede vincular ninguno; 3 es el tope de fábrica). |
| `deviceTtlDays` | entero 1–365 | Tope de validez de un vínculo desde su último uso. Manda sobre lo que elija el usuario, también sobre «Sin caducidad». |
| `allowConfirmRemember12h` | booleano | `false`: se quita «Recordar 12 h»; cada conexión se confirma en el Mac. |
| `requireConnectionConfirm` | booleano | `true`: cada conexión de un celular ya vinculado se confirma en el Mac y el usuario no puede apagar el ajuste «Pedir confirmación en el Mac en cada conexión». Desde el protocolo v3 esa confirmación es opcional y viene **apagada** por defecto (el celular entra con su PIN); esta clave devuelve el comportamiento anterior. Un dispositivo sin PIN siempre confirma, y la vinculación de un celular nuevo siempre se confirma. |

## Semántica fail closed

- **Sin archivo**: no hay restricciones de la organización.
- **Archivo presente pero ilegible, vacío, con JSON inválido o que no es un objeto**: control remoto DESHABILITADO. Ajustes
  muestra «Bloqueado por la política de tu organización» y explica que el archivo no es válido.
- **`remote` presente pero no es un objeto** (`"remote": "sí"`, `null`, lista): DESHABILITADO.
- **`enabled`**: solo `true` lo deja activo. `false` = deshabilitado; cualquier otro valor (`"true"`, `1`, `null`) =
  deshabilitado por inválido.
- Booleanos que **relajan** (`allowRemember`, `allowConfirmRemember12h`): solo `true` exacto los permite; todo lo demás cuenta `false`.
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
dir="/Library/Application Support/OnyxCode"
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
$dir = Join-Path $env:ProgramData 'OnyxCode'
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
