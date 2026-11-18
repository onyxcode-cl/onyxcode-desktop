---
name: video
description: Úsala cuando pidan un video, reel, promo, animación corta o clip para redes. Compone HTML animado, revisa tres cuadros y crea un MP4 con las herramientas de video de la app, igual en Chat, Code y Overdrive.
---

# Video

Usa `video_cuadros` y `video_render`; no ejecutes motores ni instales paquetes por tu cuenta. Si las herramientas no existen, dilo: no prometas un MP4. Escribe la composición y sus recursos en una subcarpeta DENTRO de `./.lazunox/trabajo/` de la carpeta autorizada. En Chat, que no tiene herramientas para escribir archivos, envía el HTML completo en `html` de `video_cuadros`; la app lo guarda y devuelve `composicion`. No inventes rutas.

## Formato y ciclo obligatorio

Elige `vertical` (1080×1920) para reels/historias, `cuadrado` (1080×1080) para una publicación cuadrada y `horizontal` (1920×1080) para pantalla horizontal. Sigue el destino nombrado; sin destino, vertical. Duración por defecto: 15 s; máximo 120 s, a 30 fps.

1. Escribe la composición HTML + GSAP con tamaño y duración coherentes.
2. Pide **3 cuadros** con `video_cuadros`: `{"composicion":".lazunox/trabajo/promo/index.html","formato":"vertical","segundos":[2.5,7.5,12.5]}`. Para otra duración D, elige los tiempos D/6, D/2 y 5D/6. `composicion` es un archivo HTML relativo a la carpeta, no una carpeta. En Code añade `carpeta` con la ruta absoluta del proyecto abierto a ambas herramientas. En Overdrive omite `carpeta`: la app ya la conoce. En Chat omite `carpeta` y, en la primera llamada, sustituye `composicion` por `html` con el HTML completo (hasta 512 KB); para corregir, envía otro `html`.
3. **Mira de verdad las tres imágenes** recibidas y corrige todos los defectos juntos. Prioridad: (a) texto cortado o fuera del lienzo; (b) texto/objetos encimados; (c) contraste o letra ilegible; (d) márgenes apretados; (e) encuadre, alineación y tiempos sin contenido; (f) marcadores, cifras inventadas o errores de texto. Máximo **3 rondas de cuadros** en total. Si algo sigue mal o no puedes ver imágenes, dilo; no afirmes revisión visual ni resultado completo.
4. Solo después de mirar y corregir, llama a `video_render`: `{"composicion":".lazunox/trabajo/promo/index.html","formato":"vertical","duracion":15,"fps":30,"nombre":"promo"}`. En Chat usa exactamente la ruta `composicion` de la respuesta de cuadros. La duración debe coincidir con el HTML y ser múltiplo de 1/30 s.
5. Mira también **los tres cuadros de control del MP4** que devuelve el render. Declara cualquier defecto pendiente sin comenzar un ciclo ilimitado. La respuesta trae `composicion`, `duracion`, `cuadros` y, al renderizar, `ruta` y `bytes`, más las imágenes. Entrega en una línea: enlace a la ruta MP4 · duración en segundos · peso calculado desde `bytes`.

## Composición mínima (motor fijado 0.9.64)

Un único HTML, un contenedor con `data-composition-id="main"`, `data-start="0"`, `data-duration`, `data-width`, `data-height` y `data-fps="30"`. Registra una timeline GSAP pausada en `window.__timelines.main`; los tiempos son **segundos**, no cuadros. La timeline debe durar todo el clip. El motor carga su runtime y sirve el GSAP fijado en `../node_modules/gsap/dist/gsap.min.js`: no lo descargues ni lo incluyas de internet. No uses temporizadores, animaciones CSS ni tiempo de reloj para controlar escenas; el motor adelanta la timeline de forma determinista.

Ejemplo completo de 15 s vertical (cambia contenido, paleta y movimientos para el pedido):

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1080,height=1920">
<script src="../node_modules/gsap/dist/gsap.min.js"></script>
<style>
*{box-sizing:border-box}html,body{margin:0;width:1080px;height:1920px;overflow:hidden}
#main{position:relative;width:1080px;height:1920px;background:#18251d;color:#fff3da;font-family:Arial,sans-serif;padding:240px 96px}
h1{font-size:104px;line-height:1.1;margin:0 0 56px}p{font-size:56px;line-height:1.3;margin:0}
#cierre{position:absolute;left:96px;right:96px;bottom:300px;font-size:64px}
</style>
</head>
<body>
<div id="main" data-composition-id="main" data-start="0" data-duration="15" data-width="1080" data-height="1920" data-fps="30">
<h1>Pan recién hecho</h1><p>Cada mañana, cerca de ti.</p><div id="cierre">Ven a conocernos</div>
</div>
<script>
const tl=gsap.timeline({paused:true});
tl.from('h1',{opacity:0,y:50,duration:0.8},0);
tl.from('p',{opacity:0,y:30,duration:0.8},1);
tl.from('#cierre',{opacity:0,y:30,duration:0.8},10);
tl.to({}, {duration:15},0);
window.__timelines=window.__timelines||{};
window.__timelines.main=tl;
</script>
</body>
</html>
```

Ejemplo propio contrastado con la composición de prueba y el paquete fijado; no reproduce texto de la skill oficial.

## Diseño y recursos

Texto legible en celular: cuerpo desde 48 px y títulos desde 80 px en lienzos de 1080 px; frases cortas y tiempo suficiente para leer. Deja al menos 90 px a los lados y 200 px arriba/abajo en vertical para los controles de redes. Usa contraste fuerte y como máximo 2 familias tipográficas. Nada cortado ni encimado. Comprueba fotos, recorte y proporciones en los cuadros.

**Sin internet en la composición:** imágenes, fuentes y scripts propios deben estar dentro de su subcarpeta, con rutas relativas (sin enlaces simbólicos); fuentes del sistema también sirven. GSAP lo pone el motor. No cargues URLs, CDN, iframes ni recursos externos.

**Fotos:** si hacen falta y existen `documentos_imagenes_buscar`, `documentos_imagenes_ver` y `documentos_imagenes_usar`, sigue el flujo de `pdf`: prepara requisitos y 2–3 consultas; compara la hoja; amplía 1–2 candidatas con `ver`; describe qué se ve, requisitos cumplidos y dudas; luego `usar` con el id devuelto y `evaluation:{mode:"visual",observed,meets:[],doubts}` (en Code también `carpeta`). Usa solo la ruta aprobada, copiando esa foto dentro de la subcarpeta de composición con las herramientas de archivos autorizadas. Máximo una segunda búsqueda. No copies muestras ni inventes URLs, licencias o procedencia. Sin visión, pide selección manual o un modelo compatible ya configurado; sin herramientas, red o candidata válida, crea sin fotos y explica la ausencia. No sustituyas una fotografía real por un dibujo sin avisar. En Chat, si no puedes incorporar el recurso a la composición, dilo y continúa sin él.

**Audio:** usa únicamente audio que entregue la persona. El render actual crea MP4 **sin audio** y todavía no mezcla pistas: si piden incluir una, explica ese límite y conserva el original; no prometas incorporarla. Sin audio aportado, entrega en silencio. No añadas música, subtítulos, créditos ni pies de foto automáticos. No inventes videos generados por modelos (Veo, Sora ni similares).

## Si faltan piezas

La herramienta solicita el consentimiento de descarga mediante la app. Si la persona elige «Ahora no», responde `No se instalaron las piezas de video: elegiste «Ahora no». Puedes pedirlo de nuevo cuando quieras instalarlas.` Si no termina la instalación: `Faltan piezas de video; no se pudo completar la instalación.` Si falta el runtime: `Falta el Node de la app para renderizar video.` También puede decir `El video no está disponible en este equipo.` Explica el motivo con palabras simples y ofrece reintentar desde la app cuando corresponda; no uses terminal, instaladores globales ni rutas alternativas para instalar. Una cancelación o tiempo agotado no produjo un video terminado.
