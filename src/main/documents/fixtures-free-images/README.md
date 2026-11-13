# Datos de prueba de fotos libres

- `commons-search-real.json`: respuesta real completa de la búsqueda única ya realizada el 13 de noviembre de 2026, antes de retomar V26. Se conserva sin alterar. La URL y fecha están en `commons-search-real-source.json`. Esa consulta antigua no pidió SHA1; la prueba real cubre metadatos de licencia, no se la presenta como prueba de descarga/verificación de originales del nuevo servicio.
- `synthetic-transparent.webp`: imagen sintética de 300 × 200 píxeles, con transparencia, creada localmente para probar la conversión de Pillow. No procede de una búsqueda ni representa una fotografía seleccionada.

- `search-battery/` y `search-battery-{queries,results}.json`: batería de la tercera ronda con 35 respuestas reales guardadas y evaluación por metadatos. Su README documenta los números antes/después, las consultas y los límites; el replay usa píxeles sintéticos y no hace red.

- `h1-attribution-real.json` y `h6-attribution-real.json`: campos de atribución copiados sin modificar de los JSON de procedencia de la tercera prueba Mac del 13 de noviembre de 2026 (cafetería Nebraska y mercado Chassieu). Son las cadenas reales que provocaron los rechazos; no contienen metadatos HTML originales de la API, que no quedaron en esas capturas. Se omiten IDs de sesión, rutas, evaluación del modelo y demás datos ajenos a la regresión. La prueba del servicio envuelve estos textos en una respuesta Commons sintética, sin red.

Salvo las capturas reales documentadas arriba, los originales, hashes, respuestas de red y candidatas de las pruebas son sintéticos. Las pruebas no hacen búsquedas contra Commons. La evaluación de acierto visual con modelos y el funcionamiento de los conectores se comprueban por separado en la app.
