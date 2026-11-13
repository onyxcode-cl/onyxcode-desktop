# Datos de prueba de fotos libres

- `commons-search-real.json`: respuesta real completa de la búsqueda única ya realizada el 13 de noviembre de 2026, antes de retomar V26. Se conserva sin alterar. La URL y fecha están en `commons-search-real-source.json`. Esa consulta antigua no pidió SHA1; la prueba real cubre metadatos de licencia, no se la presenta como prueba de descarga/verificación de originales del nuevo servicio.
- `synthetic-transparent.webp`: imagen sintética de 300 × 200 píxeles, con transparencia, creada localmente para probar la conversión de Pillow. No procede de una búsqueda ni representa una fotografía seleccionada.

Los originales, hashes, respuestas de red y candidatas restantes de las pruebas son sintéticos. Las pruebas no hacen búsquedas contra Commons. La evaluación de acierto visual con modelos y el funcionamiento de los conectores se comprueban por separado en la app.
