# Set dorado de documentos (`scripts/golden-docs.mjs`)

Medición **repetible** de la calidad de los documentos que arma Lazunox (PowerPoint, Word, Excel, PDF), sin IA en el bucle y sin LibreOffice.

```bash
node scripts/golden-docs.mjs --setup                      # una vez: ArtCraft (sha256 de resources/craft/pin.json) + Python de análisis → ~/.cache/lazunox-golden
node scripts/golden-docs.mjs --label mi-rama              # corre los 21 casos (~25 s) y escribe el informe
node scripts/golden-docs.mjs --baseline <golden.json>     # compara con una corrida anterior (antes/después)
node scripts/golden-docs.mjs --only d02,x03 --fail-on-hard
```

Salida (por defecto `~/Documents/respaldo/OnyxCode/capturas-1-8-9/calidad-docs/golden/<fecha>-<rama>/`): `golden.md` (informe), `golden.json` (datos),
`files/` (los documentos generados), `png/` (imágenes por página o lámina) y `sheets/` (hoja de contacto por caso, para una mirada humana o un juez de IA).
Además copia `golden-latest.{md,json}` un nivel más arriba.

## Qué hace
1. **Genera** cada caso de `cases.json` por el camino de la app: los mismos `renderChatDeck/Docx/Grid` (empaquetados con esbuild desde el código ACTUAL de la rama,
   igual que los `build_chat_*.cjs` de las skills) con ArtCraft; el PDF sale de Chromium de Electron con las opciones de `renderHtmlToPdf`.
2. **Renderiza** con los programas de ArtCraft (DeckCraft/WordCraft → PNG; GridCraft → PDF) y PyMuPDF.
3. **Filtros duros** (pasa/no pasa): se genera, abre (ZIP/XML válidos + `info` de ArtCraft, o PDF legible), 0 errores de fórmula, 0 restos de plantilla.
4. **Conteos** (menos es mejor): `contenido_faltante`, `paginas_fuera_de_rango`, `letra_chica`, `texto_fuera_de_lamina|pagina`, `cajas_montadas`, `texto_desbordado_est`
   (estimación, ~±30 %), `laminas_vacias`, `ultima_pagina_casi_vacia`, `negrita_contagiada`, `indice_en_ingles`, `total_huerfano`, `encabezado_tabla_no_repetido`,
   `valor_declarado_distinto`, `graficos_faltantes`, `hojas_distintas`, `rechazo_total_por_un_dato`.

## Los 21 casos
10 «reales» (3 PPTX, 3 DOCX, 2 XLSX, 2 PDF; los de la medición del 2026-11-05) y 11 «malvados»: texto muy largo, 30 láminas, caracteres no latinos (japonés, chino, árabe, ruso, emoji),
tabla de 60 filas, 500 filas con fórmulas en 2 hojas, contrato de 12 cláusulas, párrafos que terminan en negrita, celda de 90 caracteres (el esquema rechaza TODA la presentación),
certificado a página completa. **No cambies los casos entre noches**: si agregas uno, sube `version` en `cases.json` y mide de nuevo la línea base.

## Determinismo y «ruido»
El contenido de cada caso es fijo (no lo escribe un modelo), así que dos corridas con el mismo código y ArtCraft dan **exactamente** los mismos conteos (verificado). Cualquier diferencia entre noches
viene de la app (guías/código/`review.ts`) o de la versión de ArtCraft (`pin.json`). Lo que NO mide es la variación del modelo al escribir los encargos (eso requiere repetir con el modelo real).

## Lo que NO cubre (adrede)
- Contraste de color, jerarquía tipográfica, estética: usa `sheets/` con una mirada humana o un juez de IA de OTRA familia (pendiente: calibrarlo con 30–50 páginas etiquetadas a mano).
- Que «guía mejor → el modelo escribe mejor»: el set mide el MOTOR y las revisiones (`review.ts`) sobre contenido fijo; para medir guías hay que generar con un modelo y pasar sus JSON por este mismo script (agregar casos nuevos o `--cases <carpeta>` es el siguiente paso).
- Office real (PowerPoint/Word/Excel), Windows, ni la ruta MCP `documentos_crear` (solo el mismo motor por debajo).
- Los «malos conocidos»: los casos `d02`, `d05` (negrita), `p01` (cierre), `d01/d03/d06` (índice), `f01` (página vacía) y `p07` hoy disparan sus detectores; cuando se corrijan los defectos deben bajar a 0 (eso es lo esperado, no una falla del detector).
