# Banco de identidad documental (V26, etapa 0)

Diez pedidos fijos de `cases.mjs`: museo marino, comité financiero, cafetería, seguridad laboral, arquitectura, investigación científica, campaña cultural, carta formal, manual técnico e informe con marca. Cada pedido tiene audiencia, tono, datos verificables y una adaptación PPTX/DOCX/PDF. Tres repeticiones por formato producen **90 documentos por variante**.

Este guion tiene dos caminos separados:

- `synthetic`: pruebas locales de extracción y semejanza, sin modelo, motores Office ni navegador. Escribe 20 ZIP OOXML mínimos y 10 fixtures de XML de Poppler. **No son muestras visuales ni archivos completos para abrir en Office.**
- `run --real --allow-model`: un motor Lazunox real devuelve una especificación compacta sin herramientas; los armadores reales de la app la convierten. Esta modalidad aísla guía, especificación y motor documental; **no sustituye una prueba completa de las herramientas de Tareas ni del visor**. No ejecutamos este camino con modelo durante V26. La prueba de integración usa un ejecutable de respuesta fija y DeckCraft/WordCraft reales; no hace red ni consume tokens.

## Prueba sin modelo

Con el Node del entorno de desarrollo, desde la raíz del repo:

```sh
node --test scripts/design-bench/design-bench.test.mjs
node scripts/design-bench/run.mjs list
node scripts/design-bench/run.mjs synthetic --variant same --out /tmp/design-control
node scripts/design-bench/run.mjs synthetic --variant diverse --out /tmp/design-candidate
node scripts/design-bench/run.mjs compare --before /tmp/design-control/similarity.json --after /tmp/design-candidate/similarity.json
```

Usa carpetas nuevas: no se sobrescriben resultados. En Windows sustituye `/tmp/...` por carpetas temporales propias. Los tests borran sus temporales. Para activar la integración sin modelo, define `DECKCRAFT_CLI` y `WORDCRAFT_CLI` con las rutas absolutas de esos binarios antes de ejecutar `node --test`; de lo contrario esa única prueba se omite.

La autoprueba controlada `same` debe producir 45/45 pares casi duplicados por formato. `diverse` usa cinco diseños repetidos en diez temas y produce 5/45 por formato. Esto comprueba sensibilidad a los cambios y neutralidad ante el texto; **no es una mejora medida del producto**.

## Corrida real, a ejecutar fuera de esta sesión

Requisitos: motor del fork con `run --format json --permisos ninguno --max-steps --presupuesto-tokens`, modelo/proveedor configurado, DeckCraft, WordCraft, Python y Chromium para PDF, Poppler (`pdftohtml`) para medir PDF. El directorio de recursos debe contener `brand-logo.png` y `brand-photo.jpg`, imágenes aportadas cuyo uso se autoriza para el banco. Sus hashes quedan guardados, y los mismos bytes deben usarse en control y candidato. Los otros nueve pedidos no exigen imágenes para aislar esta etapa.

```sh
node scripts/design-bench/run.mjs run \
  --real --allow-model \
  --motor /ruta/al/motor \
  --model proveedor/modelo \
  --auth-file /ruta/privada/auth.json \
  --deckcraft /ruta/a/deckcraft-cli \
  --wordcraft /ruta/a/wordcraft-cli \
  --python /ruta/a/python3 \
  --chromium /ruta/a/chromium \
  --assets /ruta/a/recursos-del-banco \
  --repeats 3 --timeout 300 --budget 100000 \
  --out /ruta/a/resultados-candidato
```

Las rutas son argumentos, no comandos de shell generados por el modelo. Puede indicarse `--pdftohtml /ruta/al/binario` si Poppler no está en PATH. Los argumentos de binarios son rutas absolutas o se resuelven respecto del directorio actual. `--auth-file` es opcional si el proveedor no necesita autenticación; se copia solo al perfil temporal privado y se elimina al terminar. No se copia a la evidencia. Para un proveedor propio se admite `--provider-config /ruta/privada/config.json`, exclusivamente `{ "provider": { ... } }`; no admite plugins, permisos ni herramientas adicionales. Su contenido no se persiste en la evidencia. No se heredan credenciales del entorno del usuario.

Cada llamada del motor tiene un perfil temporal, herramientas denegadas y límites de tiempo y tokens. **El CLI no es un sandbox de sistema operativo.** Ejecuta el banco en el entorno de pruebas autorizado para el motor; no uses datos personales. Ninguna autenticación real es necesaria para la integración de respuesta fija. Las pruebas automáticas no ejecutan `test_html_a_png`, la app ni un navegador.

Para una prueba pequeña real, usa `--cases D01 --formats pptx,docx --repeats 1`; no requiere recursos D10 ni Chromium/Poppler. Esta opción consume llamadas al modelo si `--motor` es real.

### Comparación de componentes

- `--source-root /ruta/al/arbol` selecciona el código del armador y del esquema; se empaqueta temporalmente con esbuild, sin modificar `out/`, recursos compilados ni el árbol seleccionado.
- `--guides-root /ruta/al/arbol` selecciona las guías; por defecto usa el mismo árbol que el motor documental.
- `--guide /ruta/guia.md` puede repetirse para sustituir las guías por textos de un experimento. El texto final y su hash quedan en la evidencia de cada corrida.

Ejecuta control, guía nueva/motor antiguo, motor nuevo/guía antigua y ambos nuevos en carpetas distintas, manteniendo modelo, datos, recursos y parámetros. El `sourceCommit` identifica HEAD; `rendererBundleSha256` identifica **el código efectivo, incluidos cambios sin commit**. El JSON también registra hash y versión del binario del motor, Node, plataforma, hashes de guías y recursos. El modelo guardado es el identificador solicitado: no demuestra qué backend ejecutó el proveedor.

No hay reparación automática ni llamadas adicionales de revisión. Se guarda la respuesta inicial en `initial.json`/`initial.html` y la entregada al armador en `final.json`/`final.html`; aquí son idénticas. Se registran errores de validación/exportación como fallos, sin omitirlos al comparar. Un motor que no entregue un único bloque válido falla. Así no se oculta una reparación ni se cuenta como un nuevo documento.

`events.jsonl`, `stderr.txt`, `prompt.txt`, `run.json`, documento final y `fingerprint.json` se guardan por corrida. Tokens de entrada, salida, caché leída/escrita, pasos, tiempo de modelo, tiempo de render y costo informado salen de los eventos. Costo/visión desconocidos se registran como `null`; no se inventan tarifas. `runs.json`, `manifest.json`, `bench.json` y `similarity.json` resumen la tanda. `usage-summary.json` publica mediana y percentil 90 por formato (método de rango más próximo), incluyendo las llamadas fallidas y distinguiendo valores desconocidos. Se registran pasos del modelo y llamadas de herramientas; sin trazas del proveedor, no se afirma que cada paso equivalga a una única petición HTTP. Una tanda con fallos devuelve código distinto de cero pero conserva los resultados; no los usa para proclamar mejora.

## Medir archivos ya generados

Crea un manifiesto con rutas relativas a ese manifiesto (también se admiten absolutas):

```json
{
  "synthetic": false,
  "documents": [
    { "id": "D01-pptx-r01", "topic": "museo-marino", "format": "pptx", "path": "marino.pptx" },
    { "id": "D02-pptx-r01", "topic": "comite-financiero", "format": "pptx", "path": "comite.pptx" }
  ]
}
```

```sh
node scripts/design-bench/run.mjs measure --manifest /ruta/manifest.json --out /ruta/similarity.json
node scripts/design-bench/run.mjs compare --before /ruta/control/similarity.json --after /ruta/candidato/similarity.json
```

`measure` devuelve error si algún archivo falla, y guarda el motivo. `compare` exige misma versión de métrica, mismo umbral, cohortes idénticas (`id`, tema, formato, repeticiones), ningún fallo y el mismo carácter real/sintético. Un documento fallido no puede desaparecer del denominador. Conserva los IDs entre control y candidato.

## Qué mide y qué falta calibrar

Cada documento produce paleta, fuentes, geometría y secuencia de composiciones; **no guarda sus palabras ni las usa en la distancia**. Solo se comparan pares de **temas distintos dentro del mismo formato**. Las repeticiones de una misma marca/tema no se penalizan.

| Formato | Datos medidos en el archivo                                                                                                                                         | Límite explícito                                                                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PPTX    | Colores explícitos y referencias al tema principal, fuentes usadas, posiciones y tamaños relativos de objetos y grupos, orden real de láminas por relaciones OOXML. | No resuelve patrones con geometría heredada, temas múltiples, sombras, recortes ni fuentes realmente sustituidas por Office. Los motores actuales emiten posiciones explícitas.                                             |
| DOCX    | Colores, fuentes, herencia de estilos, tamaños, espacios, sangrías, anchos de tabla y secuencia de bloques.                                                         | La geometría es un **indicador de flujo**, no la paginación renderizada. No inventa coordenadas de Word ni detecta texto cortado.                                                                                           |
| PDF     | XML de Poppler del PDF final: posiciones de texto, familia/color de fuente y secuencia de páginas.                                                                  | El extractor usa `-i` para no escribir imágenes: no mide su geometría, fondos ni figuras vectoriales. El ancho de texto depende de las palabras aunque estas no entren en la huella. Se necesita revisión visual adicional. |

Pesos fijos v1: paleta 20 %, fuentes 15 %, geometría 45 % y secuencia 20 %. Paleta/fuentes usan Jaccard ponderado por frecuencia normalizada; geometría empareja objetos del mismo tipo por proximidad de rectángulos normalizados (en ambos sentidos); secuencia usa subsecuencia común de firmas geométricas, cuantizadas a 1/40 de página. Se publican todos los componentes, no solo el promedio. No se confunden porcentajes de similitud con probabilidades.

El umbral inicial `0.88` es **provisional, no calibrado por personas**. Puede cambiarse con `--threshold`; congélalo con ejemplos humanos antes de evaluar el candidato. `compare` publica fracción de pares casi duplicados y reducción relativa; no declara cumplido el objetivo de preferencia. La comparación humana a ciegas, la comprobación de datos, contraste/desborde, apertura Office Mac/Windows y las 18 combinaciones de modos/formatos/plataformas del informe siguen pendientes. Estos resultados no certifican calidad ni paridad visual entre sistemas.

La lógica del guion es compartida por plataforma, usa `spawnSync`/`execFile` sin shell y rutas de Node; Windows necesita los CLI y fuentes equivalentes. La prueba con ejecutables reales se hizo en macOS, no en Windows ni WSL.
