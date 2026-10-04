# Prueba de medio día: dictado local (Fase 0)

Prototipo aislado: no toca la app. No guarda audio ni texto en disco (el texto solo sale por la terminal).

## 1. Compilar
```sh
scripts/dictation/build.sh            # deja el binario en $TMPDIR/onyx-dictate-build/onyx-dictate
# Sin swiftc: xcode-select --install. Comando exacto equivalente:
# swiftc -O -swift-version 5 resources/dictation/onyx-dictate/main.swift -o /tmp/onyx-dictate
B=${TMPDIR:-/tmp}/onyx-dictate-build/onyx-dictate
$B --version && $B --self-test       # sin micrófono; debe terminar con "self-test-ok"
```

## 2. Permisos que aparecen
Se piden al primer `listen`, a nombre de la **terminal** que uses (Terminal/iTerm), no de OnyxCode.
- **Micrófono**: elige **Permitir**.
- **Reconocimiento de voz**: solo aparece en macOS 25 o anterior (motor antiguo). **Anota si te salió** en macOS 26+: es lo que queremos saber.
- Si el idioma no tiene modelo local: error `no-disponible` y sale (nunca usa internet). Para bajar el modelo del sistema (sin enviar voz): añade `--install`.

## 3. Ejecutar (habla ~20 s; Ctrl+C para terminar)
```sh
$B --locale es-CL
```
Las líneas `state` indican motor (`analyzer`/`legacy`); cada `partial`/`final` trae `ms` desde que empezó a escuchar. Se detiene solo tras 8 s de silencio o 120 s. Prueba también `--locale es-ES` y `--locale en-US`.

## 4. Anotar
**Latencia al primer parcial** (campo `ms` del primer `partial`): ____ ms.

| # | Frase de prueba (es-CL) | Lo que escribió | Calidad (1-5) |
|---|---|---|---|
| 1 | Hola, necesito revisar el pull request de ayer. | | |
| 2 | ¿Puedes ejecutar los tests y decirme cuáles fallan? | | |
| 3 | Cambia el nombre de la función a obtenerUsuario. | | |
| 4 | Abre la carpeta de descargas y borra los archivos temporales. | | |
| 5 | Son las ocho y cuarto, nos juntamos en la once. | | |
| 6 | El proyecto tiene doscientos cuarenta y cinco archivos. | | |
| 7 | Pásame el correo de la Bentec, por fa. | | |
| 8 | Instala las dependencias con npm install y corre el build. | | |
| 9 | Oye, ¿cachai cómo se arregla este error de TypeScript? | | |
| 10 | Quiero que el botón sea más grande, pero sin romper el diseño. | | |

Puntuación y mayúsculas automáticas: sí / no / a medias. ¿Pidió permiso de Reconocimiento de voz?: sí / no.

## 5. CPU y batería (1 minuto, sin carga artificial)
Con el dictado escuchando normalmente (puedes hablar o callar; sin bucles ni tareas extra), en otra terminal:
```sh
top -pid $(pgrep -n onyx-dictate) -stats pid,command,cpu,mem -l 6 -s 10
pmset -g batt        # antes y después; anota el % (1 min es poco: solo orientativo)
```
O mira «onyx-dictate» en el Monitor de Actividad (CPU y Energía). El punto naranja del micrófono debe apagarse al terminar; `pgrep -fl onyx-dictate` debe quedar vacío.
CPU media: ____ %  · Memoria: ____ MB  · Batería antes/después: ____ / ____

## 6. Borrar los permisos de prueba
```sh
tccutil reset Microphone com.apple.Terminal      # cambia el id si usaste otra terminal (iTerm: com.googlecode.iterm2)
tccutil reset SpeechRecognition com.apple.Terminal
```
Decisión de la puerta: si la calidad en es-CL o la latencia son malas, se pasa a la alternativa (modelo local en Mac también).
