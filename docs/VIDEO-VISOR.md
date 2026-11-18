# Video: skill y visor MP4 (F8-B335)

La skill `resources/opencode/skills/video/SKILL.md` se copia mediante la configuración común de habilidades, igual que PDF/Office. Chat recibe una indicación de cargarla al disponer de video; Code y Overdrive también. El catálogo la presenta en español e inglés. No cambia las herramientas del paso 2.

El visor admite `.mp4` con `ftyp` en desplazamiento 4, cabecera mínima de 16 bytes y hasta **500 MiB**. Emplea `<video controls muted playsInline preload="metadata">`, sin `autoplay`. La persona activa el sonido y la reproducción. Se sirve desde `/doc/<token>` del esquema aislado; cada petición valida de nuevo el ámbito, el token y el archivo. Un solo rango, incluyendo sufijos y extremos abiertos: 206 con `Content-Range`/`Content-Length`; rangos inválidos o múltiples: 416; ruta no autorizada: 404. El MP4 se transmite por descriptor con bloques de 64 KiB, sin leerlo completo a memoria.

Solo el esquema `lazunox-viewer` añade `stream: true`. La CSP de cabecera y del HTML abre **únicamente** `media-src lazunox-viewer://viewer`. No añade protocolos u orígenes externos. La sesión sigue sin red saliente, permisos ni descargas. Los otros tipos mantienen sus visores.

Las tarjetas de Chat, Code y Overdrive muestran el primer cuadro y la duración; al pulsar abren el visor. Conservan los botones de abrir con el programa del sistema y mostrar en carpeta. Las miniaturas usan los canales de lectura existentes, revalidan sus ámbitos y nunca instalan nada. Si faltan las piezas, falla el decodificador o el MP4 requiere búsqueda que la tubería no permite, muestran icono y duración cuando es legible. La reproducción no requiere ffmpeg. La miniatura usa ffmpeg ya instalado: entrada por pipe, sin rutas/URLs, sin otros protocolos, un hilo, 8 s y salida máxima de 256 KiB.

## Verificación de este entorno

- Build y typecheck correctos. Tanda principal dirigida: 565 pruebas correctas, antes de añadir las últimas pruebas de MP4/tarjetas. El informe del paso 3 recoge la tanda final.
- Revisión independiente de seguridad aprobada tras corregir propagación de errores al servir MP4 y terminación forzada del decodificador.
- Electron de desarrollo abortó con SIGABRT antes de ejecutar el script. Chrome Headless fijado, bajo Node, falló al registrar su puerto Mach (`bootstrap_check_in`, Permission denied). La herramienta de control del navegador existente también rechazó el acceso a Brave por no estar autorizado.
- Diagnóstico real **solo Node**, con el MP4 de 15 s del paso 2: 1.164.031 bytes; rangos 0–31 y 524288–525311 devueltos exactamente; rangos imposibles/múltiples rechazados; miniatura JPEG real y duración 15 s correctas.
- **No comprobado:** reproducción y avance por controles en el visor real, captura del visor, CSP/protocolo Electron en ejecución y Windows real. La decodificación de una miniatura y las respuestas 206 no prueban reproducción. No se ofrece una imagen del MP4 como si fuera captura del visor.

## Prueba nativa en Mac y Windows (Claude)

Desde este árbol construido, con Node propio y en una terminal no elevada de Windows. Usar un MP4 del paso 2 y una carpeta de evidencia de prueba, nunca datos personales ni Lazunox instalado:

```text
npm run typecheck
npx vitest run src/main/viewer src/main/video/preview.test.ts src/main/video/preview-process.test.ts src/viewer/video src/main/files src/main/tasks/agent-prompts.test.ts src/main/tasks/opencode-config.test.ts src/main/opencode/code-docs-prompt.test.ts src/renderer/src/features/chat/ChatFiles.test.tsx src/renderer/src/features/code/impl/doc-files.test.ts
npm run build
node scripts/video/viewer-smoke.mjs --mp4 RUTA_AL_MP4 --evidence CARPETA_DE_CAPTURAS
npx vitest run -c vitest.e2e.config.ts e2e/specs/video-visor.e2e.ts
```

Build, script y E2E deben tomar el cerrojo de `docs/REVIEW-FASE7.md`. El script crea userData y sessionData temporales propios; el E2E usa el harness temporal habitual. El script nativo exige: inicio pausado/silenciado/con controles, duración 15 s, imagen 1080×1920, reproducción con avance de tiempo y salto terminado a 10 s; deja `visor-informe.json` y `visor-mp4-10s.png`. El E2E usa un MP4 sintético de un segundo, sin datos reales, incluido en `e2e/fixtures/video-1s.mp4`.

En Windows probar además con rutas con espacios, acentos, `#`, unidad C: y otra unidad fija disponible. En cada modo (Chat, Code y Overdrive): pedir un reel de 15 s, confirmar que se carga `video`, observar tres cuadros antes del render, abrir la miniatura de la tarjeta, reproducir, activar/desactivar audio y adelantar/retroceder. Probar «Abrir con…» y «Mostrar en carpeta» tanto desde tarjeta como desde el panel. Cambiar de archivo/cerrar y revocar la carpeta: el token anterior debe responder 404. PDF/Word/Excel/PowerPoint deben verse igual que antes.

Alternativa diagnóstica sin Electron (no certifica la reproducción):

```text
node scripts/video/viewer-smoke.mjs --node --no-browser --mp4 RUTA_AL_MP4 --ffmpeg RUTA_FFMPEG_FIJADO --evidence CARPETA_DE_EVIDENCIA
```

El modo Node con Chrome (`--node --hyperframes CARPETA_DEL_PAQUETE --chrome RUTA_CHROME`) sirve el mismo bundle y el handler real por un origen HTTP local efímero; adapta **solo en el script de diagnóstico** `media-src` a `'self'`. No valida el esquema, CSP ni sesión de Electron y no modifica el producto. `--node --serve` permite comprobar esa página manualmente en un navegador ya abierto durante 70 s. Ningún modo diagnóstico relaja el producto.

Conservar N25 como **NO VERIFICADO** hasta completar la prueba real Windows. Revisar visualmente las capturas: cuadro visible, controles legibles y ningún texto o botón tapado; anotar aplicación/versión y limpieza de procesos propios.
