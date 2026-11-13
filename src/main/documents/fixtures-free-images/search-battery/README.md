# Batería de búsqueda, tercera ronda (13 de noviembre de 2026)

35 respuestas reales completas de Commons, con URL y fecha, sin cabeceras HTTP ni datos del equipo. No se descargaron fotografías ni se lanzó la app. Las pruebas no tienen acceso a red: el `fetch` inyectado exige una respuesta registrada.

- 14 llamadas `before`: dos consultas por caso, seis resultados por consulta, configuración de `d1b5a936058ad08489641ed4cdd0fbf6990060e0`.
- 14 llamadas `after`: las mismas consultas, doce resultados por consulta, `filetype:bitmap` y `gsrsort=relevance`; el servicio conserva `index` y aplica filtros/orden locales.
- 7 llamadas exploratorias `fallback`: dos de cafetería, dos de colibrí, dos de fósiles, una de pingüino. La ejecución final utiliza solo tres de estas respuestas (café, colibrí y fósiles); las otras cuatro se conservan como evidencia, pero no suman candidatas al resultado.

El replay final ejecuta 14 peticiones de metadatos antes y 17 después. Openverse no se activó en estos siete casos porque los pools de Commons alcanzaron el umbral; esta batería no mide su cobertura ni demuestra su disponibilidad. Hubo además una petición HEAD de conectividad a Commons antes de la captura, sin contenido de búsqueda.

`../search-battery-results.json` conserva el commit anterior, los requisitos, las consultas efectivamente ejecutadas, el orden y la evaluación individual de cada candidata. «Útil por metadatos» es una evaluación conservadora por título, descripción y categorías, no una selección visual: exige evidencia del sujeto, actividad y lugar pedidos. Se excluyen cadenas para cafetería de barrio, polillas y colibríes sin evidencia conjunta de vuelo y flores, fauna de la reserva sin pingüino, galerías genéricas, estereoscopía, edificios de mercados sin evidencia de puestos/frutas y estaciones ferroviarias. El pingüino mantiene `place: Chile`; un zoológico extranjero no cuenta.

| Caso | Mostradas antes → después | Útiles por metadatos antes → después |
| --- | --- | --- |
| Cafetería de barrio, interior | 2 → 6 | 2 → 5 |
| Colibrí en vuelo junto a flores | 5 → 6 | 2 → 3 |
| Pingüino de Humboldt en Chile | 6 → 6 | 1 → 6 |
| Fósil de dinosaurio en museo | 2 → 6 | 1 → 5 |
| Mercado de frutas | 6 → 6 | 1 → 2 |
| Sala de clases | 5 → 6 | 5 → 6 |
| Puerto de Valparaíso | 3 → 6 | 2 → 5 |
| **Total** | **29 → 42** | **14 → 32** |

Quedan candidatas irrelevantes: el mercado todavía muestra cuatro edificios/patios, el café una cadena, el puerto una estación, y algunos colibríes no acreditan ambos requisitos. Una hoja con seis fotos no significa seis fotos útiles. La búsqueda no sustituye a `imagenes_ver` ni a la evaluación del modelo/persona.

El procesador de prueba usa JPEG sintéticos mínimos con las dimensiones de cada ficha. Solo en copias en memoria se reemplaza SHA1 por el hash correspondiente a esos píxeles, manteniendo la identidad y los duplicados; los JSON capturados permanecen intactos. Así se ejercitan el flujo y el caso real `thumbnail_unscaled` sin descargar imágenes ni fingir verificación de sus bytes, ausencia de marcas de agua, legibilidad o composición. Las fotografías finales, la descarga real y el resultado visual siguen requiriendo prueba manual.

Captura manual acotada (opcional; **las pruebas no ejecutan este script**):

```sh
node scripts/free-images-search-battery.mjs before
node scripts/free-images-search-battery.mjs after
node scripts/free-images-search-battery.mjs fallback cafe,fossil,hummingbird
node scripts/free-images-search-battery.mjs fallback penguin 1
```

El script omite archivos ya existentes, limita cada petición a 20 segundos y se detiene ante errores. No reintenta en bucle. Para una medición nueva usa un directorio de captura separado y conserva esta evidencia.

Verificación local: `npx vitest run src/main/documents/free-images-search-battery.test.ts` (**8/8**); ESLint del archivo (**sin errores**). Misma lógica de main y replay en Mac/Windows, sin ramas por plataforma; no se probó Windows real.
