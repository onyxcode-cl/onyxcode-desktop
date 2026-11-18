# Piezas opcionales de video (F8-B333, paso 1)

La tarjeta está en Ajustes → Overdrive, junto a Node.js y uv. Instalar requiere aceptar el aviso de tamaño. Estado, Cancelar y Quitar no ejecutan render. `videoService().asegurarPiezasVideo()` solo consulta el disco y devuelve `ready` con rutas absolutas, `missing` con bytes o `unsupported`. El paso 2 conectará el render y sus herramientas para la IA.

## Versiones y tamaños

`resources/video/pin.json` fija Chrome Headless Shell 158.0.8127.36, ffmpeg/ffprobe 9.0.2 y HyperFrames 0.9.64 con GSAP 3.15.0. Los dos archivos npm se copiaron sin cambios de la prueba aprobada. No hay scripts de instalación: el ejecutable opcional de esbuild permite compilar con `npm ci --ignore-scripts`; se comprueba antes de publicar HyperFrames.

| Descarga comprimida (bytes, sin cabeceras ni TLS) | Mac arm64 |            Windows x64 |
| ------------------------------------------------- | --------: | ---------------------: |
| Chrome                                            | 105057133 |              127876264 |
| ffmpeg                                            |  28395699 |              114768076 |
| ffprobe separado                                  |  28317701 | 0 (incluido en ffmpeg) |
| npm, tarballs alcanzables para la plataforma      |  31054543 |               31572496 |
| Total sin Node                                    | 192825076 |              274216836 |
| Node si falta                                     |  53049576 |               37733703 |
| Total desde cero                                  | 245874652 |              311950539 |

El cálculo npm suma los cuerpos de tarballs fijados en el lock, sin caché. Incluye dependencias opcionales aplicables; si falla una opcional, npm puede omitirla, pero la comprobación local de esbuild y sharp evita anunciar una instalación inutilizable. La caché de instalación queda en el temporal y se borra. La caché de compilación de un render no es parte de estas cifras.

## Repetir la prueba en Mac o Windows

Requiere las dependencias de desarrollo ya preparadas, Node para arrancar el script y la carpeta de la composición de prueba. No usar npm global ni modificar el enlace `node_modules` del árbol. Todo el contenido descargado por el servicio, incluido un Node nuevo, queda en un userData temporal creado por el script. El script no carga el main de Lazunox, no abre ventanas y no lee sus datos personales.

```sh
node scripts/video/verify-pin.mjs --download
node scripts/video/smoke.mjs --install --project RUTA_A_VIDEO_PRUEBA --report informe-video.json
```

En PowerShell se usa el mismo comando; `RUTA_A_VIDEO_PRUEBA` debe contener `hyperframes/15-vertical/index.html`. Poner comillas si la ruta lleva espacios. El script ejecuta npm mediante `node.exe` y `npm-cli.js`, sin shell ni `npm.cmd`. Usa los `.exe` de Windows y no requiere WSL.

El resultado debe ser un MP4 H.264 de 1080×1920, 15 segundos y 450 cuadros. También se decodifica completo con el ffmpeg instalado. Se imprimen las rutas temporales y un JSON con los tamaños y el resultado de ffprobe; se conservan para revisión. Antes de cerrar la prueba comprobar que no queden procesos hijos. Borrar después solo el temporal que imprimió el script, si ya no se necesita.

Si Electron aborta antes de iniciar JavaScript dentro del aislamiento del agente, se puede comprobar **el mismo instalador** y render con:

```sh
node scripts/video/smoke.mjs --node --install --project RUTA_A_VIDEO_PRUEBA --report informe-video-node.json
```

Esta alternativa utiliza fetch de Node en lugar de `net` de Electron. No demuestra funcionamiento de `net`, la tarjeta ni Gatekeeper al lanzar desde Electron. La prueba con Electron debe repetirse desde una terminal normal; no quitar cuarentena ni cambiar firmas para hacerla pasar.

## Estado de verificación

Mac: ZIP y SHA reales de las dos plataformas, tarballs npm y lock verificados con red. Instalación de Node y piezas con el instalador real y render de 15 s completados con `--node`. Chrome y ffmpeg se ejecutaron sin modificar firma ni atributos de cuarentena. Electron de desarrollo aborta con SIGABRT incluso con `--version` en el aislamiento; su ejecución y el E2E visual quedan pendientes en una terminal normal.

Windows: `install.win.test.ts` usa ZIP falsos y plataforma inyectada. Además se extrajeron las dependencias npm Windows en Mac con `--os=win32 --cpu=x64 --ignore-scripts`, sin ejecutarlas, para medir su contenido. Esto no equivale a probar Windows, NTFS, antivirus, SmartScreen ni permisos de ejecución. Claude debe correr el comando Electron anterior en el PC y conservar su JSON.
