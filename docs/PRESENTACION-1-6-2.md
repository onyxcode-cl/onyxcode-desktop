# Presentación de Lazunox 1.6.2: guion y límites

Todo lo de aquí está probado (resultados en `docs/PLAN-MOTOR-PROPIO.md` y `docs/SEGURIDAD.md` §3 sexagies septies). Lo que NO está probado figura al final: no lo afirmes.

## Idea en una frase

Lazunox ya no depende de los servidores de OpenCode: el motor que hace funcionar a la IA es nuestro (partimos de OpenCode 1.19.0, licencia MIT), lo compilamos nosotros, lo verificamos y le agregamos funciones propias.

## Qué mostrar (en este orden, 5 minutos)

1. **Ajustes › Acerca de**: «Cliente de escritorio con motor propio, basado en OpenCode (licencia MIT)» y «Motor: Lazunox Motor 1.19.0 (incluido)».
2. **Chat normal**: pedir algo simple; responde con el motor propio.
3. **Ayudantes en segundo plano**: pedir «lanza un ayudante en segundo plano que calcule 41*43 y avísame cuando termine». Se ve el panel **«Trabajos en segundo plano»** con el ayudante y el botón *Cancelar*; la IA sigue conversando y, al terminar, avisa el resultado.
4. **Sin conexiones a OpenCode**: en el motor se quitaron la actualización automática, subir conversaciones para compartirlas, el reenvío de la web y la descarga de servidores de lenguaje. Hay una prueba automática que falla si vuelve a aparecer un servidor de OpenCode.
5. **Compilación repetible**: compilar dos veces da el mismo archivo, byte a byte, en macOS, Windows y Linux.

## Funciones que ya mejoran lo que trae OpenCode 2.0 (decirlas con precisión)

- **Ayudantes en segundo plano**: vienen apagados en OpenCode; en Lazunox están encendidos (una sola vez, también para quien ya usaba la app) y se pueden apagar en Ajustes.
- **Code Mode (apagado por defecto, se activa en Ajustes › Funciones experimentales)**: OpenCode no pone ningún límite a los scripts de la IA; Lazunox pone tope de tiempo (5 min), de llamadas (200) y de salida (1 MB) y, **al llegar a un tope, lo ya hecho no se deshace** y la IA recibe un resumen de lo obtenido.
- **Pausa y espera en Code Mode** (idea que tomamos de cómo lo hace Codex): si un script tarda más de 30 s no bloquea la conversación; sigue vivo y la IA lo espera, lee su resultado o lo termina (hasta 3 a la vez). Probado contra el motor real con 3 pruebas automáticas.

## Qué NO afirmar

- **No digas «igual que OpenCode 2.0» ni «tiene todas sus funciones»**: tomamos las que nos sirven (ayudantes en segundo plano, Code Mode mejorado). No tenemos el servicio compartido ni otras partes de 2.x, a propósito.
- **Shell en segundo plano**: la app ya tiene su propio shell en segundo plano (`bgshell`, aparte); el motor propio **aún no** lo trae de forma nativa. Es trabajo pendiente.
- **`permission.ask`** (gancho de permisos del motor): pendiente.
- **«Ya no dice OpenCode en ningún lado»**: falso. Los textos de la app sobre el motor dicen «Lazunox Motor», pero el archivo se sigue llamando `opencode`, las variables internas empiezan con `OPENCODE_` y los servicios OpenCode Go / modelos gratuitos son de OpenCode y se nombran así. El renombrado completo es otra etapa.
- **El catálogo de modelos** se actualiza desde `models.dev` (un GET público sin datos de la persona). No digas «cero conexiones»: di «ninguna a servicios de OpenCode».
- **Code Mode con un conector real dentro de la app** (esperar o terminar un script desde la interfaz): probado con el motor y pruebas automáticas, **no** a mano en la app. La interfaz todavía no lista esas ejecuciones en «Trabajos en segundo plano».
- Instaladores **sin firma de Apple/Microsoft** (Windows muestra aviso de SmartScreen; macOS está firmado con el certificado local del proyecto, no con Developer ID).

## Cifras que sí puedes dar

- Pruebas automáticas: ~10 000 (VPS), 0 fallas en la última corrida completa; 32 comprobaciones de seguridad contra el motor real; instalador de Windows con instalación, arranque, terminal y desinstalación en 0 fallos.
- Motor: ~145 MB en Windows, ~109 MB en macOS (descomprimido); descarga verificada por tamaño y huella SHA-256 antes de usarse.
