# Aviso de atribución

Esta skill (`video` de Lazunox) es una **obra derivada** de la skill oficial `hyperframes` y de su documentación. Esas piezas vienen dentro del paquete `hyperframes` **versión 0.9.64** (HyperFrames, de HeyGen), publicado con la licencia **Apache License 2.0**.

- Proyecto original: HyperFrames, de HeyGen. Repositorio: https://github.com/heygen-com/hyperframes
- Licencia original: Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0). Al distribuir esta skill hay que acompañarla con una copia del texto de esa licencia.
- Los derechos de autor del material original son de sus autores (HeyGen y los colaboradores de HyperFrames). Este aviso no les atribuye las modificaciones, ni implica que HeyGen respalde a Lazunox.

## Archivos modificados

Todos los archivos de esta carpeta fueron **traducidos al español y modificados** por el equipo de Lazunox en noviembre de 2026. Los cambios generales son estos:

- **Quitado:**
  - la CLI de HyperFrames y el beacon de telemetría;
  - Studio y la app de escritorio, Framey y el registro en línea;
  - los servicios y la cuenta de HeyGen, `media-use`, la instalación de plugins y la nube;
  - las voces generadas, la música de catálogo y todo lo que necesita internet.
- **Reemplazado:**
  - las verificaciones y capturas de la CLI, por las herramientas `video_cuadros` y `video_render` de la app y sus avisos automáticos;
  - las fuentes «incluidas»: se conservan las 18 familias que la app sirve sin red, más fuentes comunes a Mac y Windows o archivos locales;
  - las fotos y el audio de servicios externos, por fotos aprobadas con las herramientas de imágenes de la app y por el audio que entrega la persona.
- **Agregado:**
  - reglas propias de Lazunox: trabajar sin pausas, sin créditos automáticos, sin red en la composición y con el mismo resultado en Mac y Windows;
  - los mínimos de tamaño y márgenes;
  - ejemplos nuevos probados con el motor de la app.

| Archivo de esta skill | Deriva de (skill oficial `hyperframes` 0.9.64) |
| --- | --- |
| `SKILL.md` | `SKILL.md` (contrato, ciclo de trabajo, tabla de lectura). También resume `references/motion.md` y `references/format.md`, y conserva partes de la skill `video` anterior de Lazunox. El ejemplo es propio. |
| `references/movimiento.md` | `references/motion.md`, con reglas del contrato de `SKILL.md` y datos de `docs/motion-blur.md` |
| `references/estilo.md` | `references/look.md` |
| `references/especificacion.md` | `references/spec.md` |
| `references/historia.md` | `references/story.md`, `references/storyboard.md` y `references/storyboard-format.md` |
| `references/cine.md` | `references/film.md`, con un dato de `references/captions.md` |
| `references/overlays.md` | `references/overlays.md` |
| `references/formato.md` | `references/format.md` y `references/runtimes.md`, con datos de `docs/compositions.md`, `docs/data-attributes.md`, `docs/gsap.md`, `docs/examples.md`, `docs/audio.md` y `docs/troubleshooting.md`. Los ejemplos son propios. |
| `references/revision.md` | `references/review.md` |
| `references/sonido.md` | `references/sound.md`, con atributos de `docs/audio.md` y `references/format.md` |
| `references/types/promo.md` | `references/types/launch.md` |
| `references/types/vertical.md` | `references/types/vertical.md` |
| `references/types/explicativo.md` | `references/types/explainer.md` |
| `references/types/datos.md` | `references/types/data.md` |

GSAP (versión 3.15.0), que usan los ejemplos, no se incluye en esta carpeta. La app lo sirve aparte, con su propia licencia.
