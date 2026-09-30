# Actualizar el OpenCode incluido

OnyxCode empaqueta una copia EXACTA de OpenCode (`Contents/Resources/opencode/opencode`). La versión sale de `resources/opencode-bin/pin.json`.

## Política

- La versión fijada se sube a mano, más o menos una vez al mes o cuando haga falta. NO se persigue cada release: OpenCode publica una cada ~32 h y no documenta garantías de estabilidad de su API.
- El OpenAPI de OpenCode publica `info.version` fijo en `1.0.0`: no sirve para versionar. Por eso el contrato se mide por rutas y por la forma de los esquemas.
- Toda subida pasa por `npm run check:opencode` y por la suite completa.
- Sin autoupdate (`OPENCODE_DISABLE_AUTOUPDATE=1`).

## Qué comprueba `npm run check:opencode`

Arranca el binario con `HOME` y `XDG_*` temporales (nunca los reales) en un puerto libre, lee `/doc` y lo mata siempre al terminar.

1. Todas las rutas que la app usa existen (método + ruta). Las rutas usadas se derivan solas del código de `src/**`: llamadas del cliente del SDK (`client.<ns>.<método>`) y `fetch` directos al sidecar.
2. Compara el conjunto de rutas con la instantánea `resources/opencode-bin/api-routes.json` e informa de rutas nuevas y eliminadas.
3. Compara la forma (parámetros, cuerpo y respuestas, con `$ref` resueltos) de las rutas usadas con el resumen guardado en la misma instantánea.

Códigos de salida: `0` sin problemas (rutas nuevas son solo informativas), `1` falta una ruta usada, `2` cambió el esquema de una ruta usada (revisión humana), `3` error de infraestructura (no arranca, sin red).

Opciones: `--bin <ruta>` (por defecto el binario fijado descargado), `--latest` (descarga la última release oficial a un directorio temporal, verifica su SHA-256 contra el `digest` de GitHub y prueba ESE binario; no toca `pin.json` ni el binario fijado) y `--update-snapshot` (reescribe la instantánea; solo a mano al subir el pin).

El test unitario `src/test/opencode-contract.test.ts` no arranca el binario ni usa la red: verifica que las rutas usadas existen en el SDK fijado y que la instantánea coincide con él.

## Procedimiento

1. `npm run check:opencode -- --latest` y revisar la salida: rutas nuevas, eliminadas y esquemas cambiados. Con código `1` o `2`, adaptar primero el código de la app.
2. Subir `resources/opencode-bin/pin.json`: `version`, `url`, `sha256` (el `digest` de la release en GitHub, sin el prefijo `sha256:`) y `size` del asset `opencode-darwin-arm64.zip`.
3. Subir `@opencode-ai/sdk` en `package.json` a la misma versión y ejecutar `npm install`.
4. `node scripts/fetch-opencode.mjs` para descargar el binario nuevo (verifica tamaño y SHA-256).
5. `npm run check:opencode -- --update-snapshot` para regenerar `api-routes.json` con el binario fijado. Revisar el diff de la instantánea en git.
6. `npm run verify`.
7. `npm run package` y probar el `.dmg` a mano.
8. Actualizar la versión en `THIRD_PARTY_NOTICES.md` si la menciona.

## Reglas

- No ejecutar el binario contra el `HOME` ni los `XDG_*` reales: el script ya usa temporales.
- Si el test unitario falla tras subir el SDK, la instantánea y el SDK están desalineados: repetir el paso 5.
