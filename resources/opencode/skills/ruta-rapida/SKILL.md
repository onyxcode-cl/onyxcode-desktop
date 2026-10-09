---
name: ruta-rapida
description: Úsala SIEMPRE al empezar una tarea en el Mac, antes de escribir el plan: elige para cada paso el mecanismo más rápido, barato y fiable (comandos, scripts, AppleScript, accesibilidad o pantalla) y trae recetas exactas.
---

# Elegir la ruta más rápida (antes de planificar)

Cada paso por pantalla cuesta 2-4 llamadas (captura, clic, comprobar) y puede fallar. Un comando cuesta 1 llamada y se
comprueba solo. **Para cada paso del plan, usa el primer peldaño de esta escalera que sirva:**

1. **Comandos de terminal** (`bash`): archivos y carpetas, texto, datos, comprimir, buscar, abrir cosas, información del sistema.
2. **Scripts**: `osascript` (AppleScript/JXA) para apps de Apple con diccionario (Finder, Notas, Recordatorios, Calendario,
   Música, Safari) y para Spotify. **Word, Excel, PowerPoint y PDF NO se improvisan** (nada de descomprimir el `.docx` o
   escribir XML a mano): si el archivo es `.docx`, `.xlsx`, `.pptx` o `.pdf` —crearlo, leerlo o editarlo—, carga ANTES de planificar
   la skill `docx`, `xlsx`, `pptx` o `pdf` (herramienta `skill`) y usa sus scripts con `$LAZUNOX_PYTHON`.
3. **Atajos de macOS** (`shortcuts run "Nombre"`) solo si el usuario ya tiene ese atajo.
4. **Accesibilidad** (`computer_app_press`, `computer_app_set_value`, `computer_app_find`): apps sin comandos, sin mover el ratón.
5. **Ratón y teclado con la lista numerada** (`element: N`) y **lotes** (`computer_batch`).
6. **Pantalla por visión** (x, y): último recurso.

## Cuándo SÍ usar la pantalla aunque exista un comando
- El usuario pide **verlo, enseñarlo o hacerlo en una app concreta** («con Finder», «muéstrame», «en Notas»): respeta cómo lo pidió.
- La tarea consiste en **leer lo que muestra una ventana** o manejar una app sin automatización (Discord, Slack, juegos…).
- El comando necesita un permiso que no hay (ver «Permisos»).

## Cómo planificar con esta skill
1. Lista los pasos del encargo.
2. Etiqueta cada uno con su peldaño (1-6). Agrupa los de comandos en UN solo `bash` (`&&`) o un script.
3. Deja la pantalla solo para los pasos que de verdad la necesitan; di en el plan «con comandos» o «por pantalla».
4. Si el encargo toca un `.docx/.xlsx/.pptx/.pdf`, el paso «cargar la skill de ese formato» va ANTES del plan. **Comprueba con un comando**, no con una captura: `test -d carpeta && echo ok`, `ls`, `cat archivo`, `wc -l`.
5. Si un peldaño falla UNA vez (error de permiso, app sin diccionario), sube al siguiente; no insistas con el mismo.

## Permisos y límites
- `osascript` y `open` están pensados para el modo Control total; en Tareas con Sandbox están bloqueados (usa solo comandos de archivos).
- `osascript` puede pedir un permiso de Automatización de macOS la primera vez por app (aparece un aviso del sistema que
  solo el usuario puede aceptar). Si no responde o lo deniega, pasa al peldaño 4 o 5.
- Borrar, mover fuera de la carpeta o sobrescribir: pregunta antes, como siempre. Nunca `sudo`.
- No metas contraseñas ni datos sensibles en la línea de comandos.

## Recetas (✓ = comprobada en este Mac; ⚠ = sin comprobar: si falla, sube un peldaño)

### Archivos y carpetas ✓
| Tarea | Comando |
|---|---|
| Crear carpeta (y las de en medio) | `mkdir -p ~/Desktop/Mi\ Carpeta/sub` |
| Mover | `mv origen.txt ~/Desktop/destino/` |
| Renombrar | `mv viejo.txt nuevo.txt` |
| Renombrar en lote | `for f in *.jpeg; do mv "$f" "${f%.jpeg}.jpg"; done` |
| Copiar sin duplicar espacio | `cp -c origen.txt copia.txt` |
| Crear archivo de texto | `printf 'contenido\n' > ~/Desktop/nota.txt` |
| Comprimir / descomprimir | `zip -qr paquete.zip carpeta` · `unzip -q paquete.zip -d salida` |
| Listar por fecha | `ls -t ~/Desktop \| head` |
| Buscar por nombre | `find ~/Documents -name "*informe*" -not -path "*/.*"` |
| Contar / ver | `wc -l archivo` · `cat archivo` · `head -n 20 archivo` |

### Información del sistema ✓ (solo lectura)
`sw_vers -productVersion` (versión de macOS) · `scutil --get ComputerName` (nombre del Mac) · `df -h /` (disco) ·
`date "+%Y-%m-%d"` · `python3 -c "print(1234*5678)"` (cálculos) · `pmset -g batt` (batería ⚠).

### Abrir cosas ⚠ (Control total)
`open -a "TextEdit" archivo.txt` · `open -R archivo` (mostrarlo en Finder) · `open "https://…"` · `mdfind -name "texto" 2>/dev/null` (Spotlight; puede tardar en indexar).

### Apps de Apple con osascript ⚠
```
osascript -e 'tell application "Finder" to make new folder at desktop with properties {name:"Mi carpeta"}'
osascript -e 'tell application "Notes" to make new note with properties {name:"Título", body:"Cuerpo"}'
osascript -e 'tell application "Reminders" to make new reminder with properties {name:"Comprar pan"}'
osascript -e 'tell application "Spotify" to name of current track & " - " & artist of current track'
osascript -e 'tell application "Spotify" to play track "spotify:track:ID"'
```
Comprueba siempre el resultado (leer la nota, listar el recordatorio) antes de darlo por hecho.

## Ejemplo
Encargo: «Crea una carpeta Clientes en el Escritorio y mueve ahí los PDF que empiecen por factura».
Plan: 1) `mkdir -p ~/Desktop/Clientes && mv ~/Desktop/factura*.pdf ~/Desktop/Clientes/` — con comandos. 2) `ls ~/Desktop/Clientes` — comprobar.
Total: 2 llamadas, sin tocar la pantalla. Por pantalla serían 15 o más.
