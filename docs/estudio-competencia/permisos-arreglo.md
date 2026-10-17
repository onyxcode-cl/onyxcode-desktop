# Arreglo de los modos de permisos de Code (F8-B178)

Motor OpenCode 1.19.0, modelos gratuitos (MiMo-V2.6-Flash Free en la app; GLM-5.3-Flash Free en el motor). Todo con `XDG_*` y `--user-data-dir` temporales, llavero falso y carpeta de juguete bajo `/tmp`. Capturas y tablas crudas: `/Users/ben/Documents/lazunox-capturas/permisos-arreglo/` (`tabla-motor.txt`, `tabla-app.jsonl`, PNG por escenario).

## 1. Observado (motor real, HTTP + SSE `permission.asked`)

- `session.update` **suma**: sesión creada con 11 reglas (manual) + bloque de Automático (47) = 58. Confirma la acumulación.
- Con el bloque nuevo, una sesión creada en «Preguntar siempre» y cambiada a cada modo da **la misma** tabla que una sesión nueva en ese modo (`tabla-motor.txt`, 9 tareas × 9 combinaciones; plan quedó incompleto: el modelo a veces no llamó la herramienta).
- En una orden compuesta el motor evalúa cada parte **sin su redirección**: con una regla `allow` para `ls`, `ls && ls > b.txt` y `ls | ls > c.txt` **escribieron archivos sin preguntar**. Por eso los comandos de lectura no se permiten con reglas del motor (sección 3). El mensaje de la petición trae el comando completo en `metadata.command`.
- Preguntas observadas: `bash ls` en todos los modos salvo «Todo sin preguntar»; `echo hola > prueba.txt` y `ls | wc -l > conteo.txt` en todos salvo «Todo sin preguntar»; `read /etc/hosts` → `external_directory`; `read .env` → pregunta; `websearch` pregunta en manual, «Editar sin preguntar» y «Automático»; `task general` (subagente) pregunta en «Preguntar siempre» y en el resto no; editar `nuevo.txt` solo pregunta en «Preguntar siempre».
- Antes del arreglo la búsqueda web no preguntaba aun con `websearch ask` (estudio previo); con el bloque nuevo sí pregunta en el motor y en la app. Causa no aclarada (puede que el estudio previo midiera una sesión con reglas viejas).

## 2. Observado en la app real (rama compilada, `electron .`, CDP)

Sesión nueva en el modo vs sesión creada en «Preguntar siempre» y cambiada con el chip:

| Tarea | Auto, nueva | Auto, cambiada | Editar, nueva | Editar, cambiada | Preguntar, nueva |
|---|---|---|---|---|---|
| `ls` | sin tarjeta (aprobada por la app) | sin tarjeta | tarjeta | tarjeta | tarjeta |
| `echo hola > prueba.txt` | tarjeta | tarjeta | tarjeta | — | tarjeta |
| `ls \| wc -l > conteo.txt` | tarjeta | tarjeta | — | — | — |
| `git status` | sin tarjeta | sin tarjeta | — | — | — |
| leer `/etc/hosts` | tarjeta (fuera del proyecto) | tarjeta | — | — | — |
| crear archivo | sin tarjeta | sin tarjeta | sin tarjeta | — | tarjeta (el modelo eligió una ruta fuera del proyecto) |
| búsqueda web | tarjeta | tarjeta | — | — | — |

Antes del arreglo la columna «Auto, cambiada» preguntaba `ls`, `echo` y la tubería (estudio previo, 0.5.37). **Sin medir en la app**: «Solo explorar» y «Todo sin preguntar» (el modelo gratuito es lento, ~5 min por tarea al final; se cortó la corrida), el aviso «El cambio vale desde el próximo mensaje» con tarea corriendo, y la nota del menú. Esas partes solo tienen prueba unitaria (plan y bypass sí se midieron en el motor).
La confirmación de que la app aprobó `ls`/`git status` es indirecta: no hubo tarjeta y la herramienta se ejecutó; el gancho de `fetch` que intenté no vio la respuesta (el SDK usa su propio `fetch`).

## 3. Decisiones

- Bloque autosuficiente por modo + reenvío solo si la sesión no termina ya con él (pruebas: `src/shared/permission-rules.test.ts`, `store.permisos.test.ts`).
- «Automático»: el motor pregunta por todo `bash`; la app aprueba solo el comando completo si es un único comando simple de lectura (`ls`, `dir`, `pwd`, `git status|diff|log|show|rev-parse`, `git branch` para listar, `Get-ChildItem`, `Get-Location`) o, en Automático, `npm run`/`npm test`, sin redirecciones, tuberías, encadenado ni sustituciones. Esto estrecha lo que antes pasaba (`git status && …`).
- Subagentes: «Preguntar siempre» pregunta al lanzarlos (`task * ask`), verificado. Conectores externos (MCP): **inferido**, no probado con un conector real.
- «Solo explorar» envía su bloque (niega editar salvo `.opencode/plans/*.md`, bash pregunta salvo lectura); el agente Plan manda sobre el modo.
- Comparar usa los mismos bloques y no rebaja «Todo sin preguntar»; allí el motor permite las cinco órdenes de siempre porque no hay interfaz que apruebe.

## 4. No verificado

Conectores externos reales; Windows real; ventana cerrada con comando pendiente; «Solo explorar», «Todo sin preguntar» y el aviso del chip en la app real; la causa del `websearch` sin tarjeta en el estudio previo.
