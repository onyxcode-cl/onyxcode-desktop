# Fork propio del motor (OpenCode 1.19.0): paso 2, compilar desde el código fuente

Fecha: 2026-10-23. Continúa `docs/ANALISIS-OPENCODE-1-BASE.md` (plan de 5 pasos). **Paso 2 = compilar el tag `v1.19.0` sin cambios, de forma repetible, y medirlo.**
Decisión de producto (Ben): usar OpenCode hasta la 1.19 y, desde ahí, que el motor sea propio. Los pasos 3 a 5 (fork con cambios, recorte de red, mantenimiento)
no están hechos.

## Receta (VPS, contenedor aislado)

```bash
# en el VPS; el directorio /opt/lzx-fork guarda el clon, los registros y los binarios
docker run -d --name lzx-fork --cpus=4 --memory=12g -v /opt/lzx-fork:/w -v <build-linux-vps.sh>:/build.sh:ro oven/bun:1.3.14 bash /build.sh
docker run -d --name lzx-fork2 --cpus=4 --memory=12g -v /opt/lzx-fork:/w -v <build-darwin-vps.sh>:/b.sh:ro oven/bun:1.3.14 bash /b.sh
```

- Código: `github.com/anomalyco/opencode`, commit `733b2c627e5aec39cb33cc22373bdce33053ef2c` (tag `v1.19.0`), `git fetch --depth 1`.
- Catálogo de modelos fijado: `MODELS_DEV_API_JSON=/w/models.json` (descargado una vez de models.dev); `OPENCODE_VERSION=1.19.0`, `OPENCODE_CHANNEL=latest`.
- Instalación: `bun install --frozen-lockfile`. Compilación: `bun run script/build.ts --single --skip-embed-web-ui`.
  Para macOS desde Linux (como hace su CI) el script `build-darwin-vps.sh` cambia SOLO en el clon el filtro del destino a `darwin/arm64`.
- **Hallazgo:** la instalación compila código nativo (`tree-sitter-powershell`, vía node-gyp): el entorno necesita **`python3` y `build-essential`**
  (sin ellos `bun install` falla con «Could not find any Python installation»). El análisis previo no lo había visto.

## Resultados (medidos)

| Medida | linux-x64 | darwin-arm64 |
| --- | --- | --- |
| Instalación de dependencias (1.ª vez) | 3 min 30 s, 1,3 GB | (reutiliza la instalación) |
| Compilación #1 / #2 | 1 min 22 s / 16 s | 19 s / 11 s |
| Memoria máxima | 1,5 a 1,8 GB | 1,5 GB |
| Tamaño | 149.981.312 B | 109.151.330 B (sin firmar) |
| Dos compilaciones iguales | **idénticas byte a byte** (`8bbba834…`) | **idénticas byte a byte** (`2b466ecd…`) |
| `--version` | 1.19.0 | 1.19.0 (tras firmarlo ad-hoc con `codesign --force --sign -`) |

- **Frente al oficial:** NO es idéntico (esperado: firmas, Bun y minificado dependen del entorno). El oficial linux-x64 pesa 185.747.584 B y el nuestro 149.981.312 B; parte
  de la diferencia es la interfaz web que el oficial incrusta y nosotros omitimos (`--skip-embed-web-ui`). El darwin oficial firmado pesa 144.372.192 B.
- **Test de contrato de Lazunox** (`node scripts/check-opencode.mjs --bin <binario>`): con NUESTRO binario darwin-arm64, 188 rutas, las 46 que la app usa presentes, **sin cambios** → OK.
- **engine-probe** (`node scripts/engine-probe/run.mjs <binario>`): 27 comprobaciones de seguridad contra el motor real (conectores, guardián de subagentes, plugin de sesión) con nuestro binario → **Todo OK (27)**.
- Arranque (`--version`): 0,41 a 0,68 s el nuestro y 0,32 a 0,50 s el oficial, con el Mac a carga 13 (dentro del ruido). La corrida del engine-probe tardó 22 min por esa carga (1 min 47 s con el Mac tranquilo y el binario oficial).

## Lo que NO se ha hecho ni verificado

- Windows (`win32-x64`): no compilado ni probado.
- El binario compilado NO se usa todavía en la app; `pin.json` sigue apuntando al oficial.
- Tráfico de red/telemetría del binario propio, y quitar `upgrade`, share, proxy a `app.opencode.ai`, búsqueda web de ellos (paso 3).
- Dónde alojar el fork (repositorio) y cómo publicar el binario con el mismo contrato que `pin.json`.
- Mantenimiento: portar a mano los arreglos de seguridad y de proveedores que upstream publique en 2.x (la 1.x ya solo recibe parches).
