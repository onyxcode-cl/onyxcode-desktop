# Video, paso 2 (F8-B334)

`video_cuadros` y `video_render` son herramientas del MCP `video` que corre en main. El transporte anuncia `cuadros` y `render`; el motor antepone el nombre del servidor. La instrucción pide mirar todos los cuadros y corregir antes del MP4. No hay skill ni reproductor en este paso.

En Code, `carpeta` se comprueba contra los proyectos abiertos en cada llamada; render tiene los permisos de crear documentos, cuadros los de previsualizar. Overdrive usa el proxy MCP existente, con token real fuera de la tarea y traducción de rutas al devolver resultados Windows. No se cambian montajes ni WSL. Chat comparte el servidor del sidecar, pero determina la sesión activa desde main y guarda cada composición bajo una carpeta privada de esa conversación: como Chat no tiene escritura de archivos, `cuadros` admite `html` exclusivamente allí. El resultado devuelve `composicion` para el render posterior; no concede escritura de archivos generales.

## Entrada y motor

Usar una carpeta pequeña con `index.html` y sus recursos locales. Se copia la carpeta que contiene ese HTML: máximo 256 entradas, ocho niveles, 32 MiB por archivo y 128 MiB total. Se rechazan enlaces simbólicos/duros, archivos especiales, rutas absolutas, `..` y tipos ajenos a composiciones. La copia queda en un temporal privado bajo userData; el origen se abre para lectura con comprobación de identidad y sin seguir enlaces. La biblioteca local `../node_modules/gsap/dist/gsap.min.js` (también `node_modules/gsap/dist/gsap.min.js`) la sirve la instalación fijada, sin copiar node_modules del proyecto.

El adaptador usa el runtime y las funciones de posicionamiento de HyperFrames 0.9.64 instalados en el paso 1, Puppeteer de ese mismo lock y el Chrome fijado. No carga CLI, configuración, plugins ni scripts Node del proyecto. Captura la composición con su tamaño declarado (que debe coincidir con el formato), y envía cuadros a ffmpeg por una tubería. MP4 H.264/yuv420p, 30 fps, hasta 120 s, CRF 18; ffprobe comprueba códec, dimensiones, fps y duración. Los tres PNG de control del MP4 se extraen del archivo ya codificado. Los PNG para revisión miden un cuarto por dimensión. Solo MP4/PNG se copian de vuelta, sin sobrescribir, mediante `documents/output-path.ts`.

Esta primera integración captura imágenes mediante el navegador y codifica solo video: no mezcla pistas de audio de la composición. No se presenta como equivalente completo al CLI de HyperFrames (sin bundling de subcomposiciones ni descarga/localización automática de recursos). Si se necesita audio, requiere una ampliación explícita del adaptador y sus pruebas.

## Red, procesos y consentimiento

El navegador recibe un proxy a un puerto cerrado, sin excepción implícita de loopback, con excepción exacta para el puerto de su servidor de archivos. Resolución DNS bloqueada excepto 127.0.0.1, QUIC y UDP WebRTC sin proxy desactivados. Además se intercepta cada solicitud antes de navegar: solo GET/HEAD al origen y prefijo aleatorio de ese render. El servidor solo sirve archivos copiados y GSAP, no tiene API, proxy ni redirecciones. CSP propia: scripts y estilos locales/inline, recursos locales/datos, connect solo a ese origen; sin frames, workers, objetos, formularios ni base. Las composiciones no pueden usar service workers. El archivo y el resto de puertos quedan fuera. Windows conserva el sandbox de Chrome; el bloqueo real allí debe verificarse con la prueba indicada abajo.

En Mac todos los procesos del render se lanzan con un perfil Seatbelt separado, deny default: lectura del temporal, piezas y bibliotecas/fuentes del sistema; escritura solo al temporal (y `/dev/null`), red únicamente loopback. La restricción al puerto exacto la impone adicionalmente el navegador. Si Seatbelt falla, la herramienta devuelve error, sin relanzar fuera del perfil. Este entorno de desarrollo rechaza `sandbox_apply`, por lo que ese perfil **todavía necesita prueba real en una terminal normal**.

Una operación por atadura, dos en la instancia única de la app; las llamadas adicionales reciben ocupado para reintentar. Render: máximo cinco minutos; llamada completa incluyendo consentimiento/instalación: dieciséis. Se cancela por desconexión HTTP, revocación del token, parada del servidor o cambio/parada de la sesión que main comprueba periódicamente. Cada render usa su propio grupo de procesos en POSIX; Chrome no crea otro grupo. Al terminar o cancelar se mata ese grupo; Windows usa taskkill con el PID propio y `/T /F`. stdin sirve de vigía si main desaparece.

Si faltan piezas, se pregunta con el diálogo nativo de botones ya usado por Lazunox: «Ahora no» como opción segura e «Instalar (X MB)», con tamaño que incluye Node faltante y aviso GPL. Después de aceptar, una ventana sin preload ni privilegios muestra fase y porcentaje; cerrarla cancela. Ajustes conserva su tarjeta. El motor no decide instalar. Las unitarias usan procesos y descargas dobles.

## Repetir la prueba real en Mac

Desde el repositorio, con Node local compatible:

```sh
node scripts/video/render-smoke.mjs --install --project RUTA_VIDEO_PRUEBA --report informe-render-mac.json
```

Crea un userData nuevo en el temporal del sistema; no abre la app instalada ni usa el userData personal. Instala allí las piezas, llama ambas herramientas mediante HTTP MCP autenticado, comprueba una composición hostil, tiempos, duración y salida. `--node` es la alternativa si Electron aborta antes de JavaScript. La prueba también permite reutilizar **solo** un userData temporal anterior de las pruebas con `--installed-user-data RUTA_TEMPORAL`.

En un aislamiento que no permite Seatbelt, `--node --diagnostic-without-seatbelt` comprueba el adaptador, el bloqueo de solicitudes del navegador y el MP4 por MCP. Ese modo existe **solo en el script de prueba**, no en el servicio del producto; su informe dice `diagnosticOnly: true`, `seatbelt: false` y no valida el aislamiento Mac.

La composición hostil intenta tres fetch con `mode: no-cors`: HTTPS externo, otro puerto local realmente abierto y un archivo canario fuera de la composición. Solo pinta verde si **los tres rechazan**; el script decodifica el PNG con el ffmpeg fijado y exige el píxel `00ff00`, y además exige cero peticiones al servidor canario (previamente se comprueba que era accesible). Así una respuesta opaca o un 404 no se confunden con bloqueo. Se guardan informes sin tokens. El worker devuelve errores si la composición no inicializa o no respeta dimensiones/duración.

## Prueba pendiente en Windows (Claude)

En una terminal no elevada del PC, con este árbol y una copia de `video-prueba`:

```powershell
node scripts/video/render-smoke.mjs --install --project "RUTA_VIDEO_PRUEBA" --report "informe-render-win.json"
node scripts/video/render-smoke.mjs --node --install --project "RUTA_VIDEO_PRUEBA" --report "informe-render-win-node.json"
npx vitest run src/main/video src/shared/video-permissions.test.ts src/main/tasks/inline-config.test.ts
```

Exigir: 3 PNG 270×480 y MP4 1080×1920, 15 s, H.264, 30 fps; tres controles del MP4; `networkProbePixel: 00ff00`, `localCanaryHits: 0`, temporales vacíos y ningún descendiente de los PID del render vivo. Revisar los tres PNG: introducción, productos y cierre; reproducir el MP4 completo. Probar además cancelar durante cuadros/render/instalación, «Ahora no», «Instalar», progreso y cerrar el aviso; repetir desde Chat, Code y Overdrive WSL, verificando que los archivos regresan a su carpeta. No usar el diagnóstico sin Seatbelt en Windows. Una prueba fallida de red no se aprueba: conservar el informe y corregir antes de dar N24 por verificada.

Estado actual: pruebas con dobles y render real de diagnóstico bajo Node en Mac; Electron, Seatbelt efectivo y Windows real pendientes. Los tiempos y resultados exactos están en el informe externo V32-VIDEO-PASO2-RENDER-INFORME.md.
