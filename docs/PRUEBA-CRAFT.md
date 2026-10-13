# Prueba: herramientas «Craft» (organización `storytold`) para documentos

Rama de experimentos `exp/craft-office-pruebas`. **Nada de esto está integrado en Lazunox**: es una evaluación para decidir si vale la pena.

## Qué se probó

Versión 0.5.0 de las herramientas de **línea de comando** de tres proyectos de código abierto (MIT o Apache-2.0, escritos en Rust, «alpha» según sus propios README):

| Programa        | Qué es                                   | Archivo                                   | Tamaño |
| --------------- | ---------------------------------------- | ----------------------------------------- | ------ |
| `wordcraft-cli` | procesador de texto tipo Word (`.docx`)  | `wordcraft-cli-0.5.0-macos-universal.zip` | 77 MB  |
| `deckcraft-cli` | presentaciones tipo PowerPoint (`.pptx`) | `deckcraft-cli-0.5.0-macos-universal.zip` | 63 MB  |
| `gridcraft-cli` | hoja de cálculo tipo Excel (`.xlsx`)     | `gridcraft-cli-0.5.0-macos-universal.zip` | 8 MB   |

Origen: GitHub Releases de `storytold/wordcraft`, `storytold/deckcraft` y `storytold/gridcraft` (v0.5.0, 10–11 oct 2026).

**Verificación antes de ejecutar:** el hash SHA-256 de cada zip coincide con su `SHA256SUMS.txt`; los tres binarios están firmados con un Developer ID de Apple («Learning Machines LLC», equipo `DJ6XS33FX8`) y `codesign --verify --strict` pasa.

## Documentos de prueba

Hechos con las mismas librerías que usan nuestras skills (`python-docx`, `openpyxl`, `python-pptx`):

- Word: título, párrafo con negrita y cursiva, lista con viñetas y numerada, tabla con estilo, imagen, texto centrado con tildes y ñ, salto de página.
- Excel: encabezado con color, fórmulas `SUM`, `AVERAGE`, `MAX` y `IF`, formato numérico, ancho de columna y un gráfico de barras.
- PowerPoint: portada, diapositiva con viñetas, diapositiva con imagen y una forma con texto, y notas del orador.

## Resultados

| Prueba                                                                           | Resultado                                                                                                                                                  |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leer los tres formatos                                                           | Bien. Wordcraft detecta 2 páginas, 28 párrafos; deckcraft lee layouts y fuentes; gridcraft lista hoja, celdas y gráficos.                                  |
| Dibujar Word a imagen / PDF                                                      | **Fiel**: colores de título, viñetas, numeración, negrita/cursiva, tabla con filas alternadas, imagen y centrado. 0,17 s.                                  |
| Dibujar PowerPoint a imagen / PDF                                                | **Fiel**: texto con tildes, viñetas, imagen y forma con texto. 3 diapositivas en 0,06 s.                                                                   |
| Calcular las fórmulas de un `.xlsx` hecho con `openpyxl` (sin valores guardados) | **Correcto**: totales 358.000 / 379.000 / 386.000 / 409.000, promedio 383.000, máximo 409.000 y `IF` = «Bajo la meta».                                     |
| Reconocer el gráfico del Excel                                                   | Sí: columnas agrupadas, 3 series, título «Ventas por mes».                                                                                                 |
| Guardar de nuevo y reabrir con las librerías de Python                           | **Sin daños**: la tabla, la imagen, las notas del orador, las fórmulas, el gráfico, la negrita y el formato numérico siguen intactos.                      |
| Servidor MCP                                                                     | `wordcraft-cli mcp` responde a `initialize` y expone 16 herramientas (`new_document`, `open_document`, `save_document`, `type_text`, `execute`, `batch`…). |
| Velocidad y peso                                                                 | Décimas de segundo; 8–77 MB cada uno (LibreOffice ≈ 800 MB).                                                                                               |

## Lo que NO se probó (y por qué importa)

- **Sin comparar con LibreOffice**: no estaba instalado en el equipo de pruebas. «Fiel» aquí significa «se ve bien a ojo», no «igual que Word».
- **Solo 3 documentos pequeños y hechos por programa.** Nada creado por Word real, con gráficos complejos, SmartArt, macros, comentarios, cambios con control de cambios ni documentos largos.
- **Solo macOS.** Windows (donde wordcraft avisa de cuelgues en algunas tarjetas AMD con la versión con ventana) no se probó.
- **No se probó que una IA los use de punta a punta** (crear un documento desde cero con el MCP y revisarlo).
- Las cifras de «% de Word» y «clean-room» son afirmaciones de los autores, sin verificación independiente.

## Riesgos de depender de ellos

- Proyecto joven (alpha): puede cambiar o romperse entre versiones; sus README admiten que la paginación aún no iguala a Word y que los gráficos pueden perderse en algunos viajes de ida y vuelta.
- Hay que **fijar versión y hash** (como `resources/libreoffice/pin.json`) y revisar licencias (MIT/Apache y fuentes OFL; el nombre y logos de ArtCraft son marca y no se pueden usar).
- Es código de terceros que se ejecuta con acceso a archivos del usuario: iría confinado a la carpeta de la tarea (`--root` en pdfcraft) y dentro del sandbox de Tareas.

## Conclusión provisional

**Prometedor como complemento opcional, no como reemplazo de LibreOffice todavía.** Ventajas medidas: muy rápido, muy ligero, calcula fórmulas (algo que `openpyxl` no hace) y trae un servidor MCP hecho para agentes. Faltan pruebas con documentos reales y con LibreOffice como punto de comparación.

## Siguientes pasos propuestos

1. Descargar LibreOffice en un entorno aparte y comparar las mismas salidas lado a lado.
2. Probar con documentos más exigentes (idealmente creados con Word y PowerPoint reales).
3. Probar el MCP con una IA: crear un informe y una presentación desde cero.
4. Si pasa: ofrecerlos como servidores MCP **opcionales y apagados por defecto** en Ajustes › MCP, con versión y hash fijados.
