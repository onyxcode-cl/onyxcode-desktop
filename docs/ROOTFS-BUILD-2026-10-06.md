# Imagen base de Tareas en Windows: construcción del 2026-10-06

Estado: **construida y verificada en el PC de pruebas, sin publicar.** Todavía no está en `resources/opencode-bin/pin.json`.

Actualización 2026-10-07 (decisión del dueño, `docs/WINDOWS-TAREAS.md`): esta imagen irá **incluida en el instalador** de Windows
(`resources\wsl\images`, beta opcional) y no se publica. En `pin.json` la clave `wsl-rootfs` conserva la forma de URL del repo de la
imagen WSL (organización D9 pendiente) que exige `parseWslPin` (no se relaja), aunque el archivo no esté publicado: esa URL daría 404 y el camino
de descarga falla cerrado; el instalador usa el archivo incluido, verificado por tamaño y sha256. Solo se avanza de versión de
imagen, no se reinstala una anterior. Desde entonces se verificó en el PC real una sesión 2/2 (`wsl-it.ps1`) y la batería parcial de
38 pruebas; la batería A1–A20 completa y las dos sesiones siguen sin hacerse.

| Dato | Valor |
|---|---|
| Archivo | `lazunox-rootfs-2026.10.1-x64.tar.gz` |
| Tamaño | 77 545 052 bytes (74 MB); 225 052 160 bytes descomprimida, 8045 entradas |
| sha256 | `5cf9da9d8941d43461dca47e19193b0e3b1bcbb8b25d978623b665974f79ddc6` |
| Imagen base | `debian:trixie@sha256:913f6706df59a68922d1dd08f78c2476560a8d367897200a6005b00e5f67c2d5` |
| Reproducible | Sí: dos construcciones seguidas (`--check`) dan el mismo sha256, y una tercera, hecha antes, también |
| Inspector | `scripts/wsl-rootfs/inspect.mjs` pasó (exit 0) |
| Dónde | PC de pruebas, Docker Desktop `linux/amd64` nativo, `scripts/win/rootfs-build.ps1` (108 s por construcción) |

Cambios que hicieron falta para construirla:
- `python3-pptx` no existe en Debian 13: se quitó de `scripts/wsl-rootfs/packages.txt` (ver la actualización del 2026-10-10: ahora se instala con pip fijado).
- `customize.sh` ya no intenta cambiar la fecha de `/proc`, `/sys` y `/dev` (solo lectura dentro del chroot; mmdebstrap fija
  sus fechas al escribir el tar).

Falta (texto original; ver la actualización de arriba): publicar el archivo, fijarlo en `pin.json` (`wsl-rootfs`), empaquetar `resources/wsl` con el pin y probar la distro real
con la batería A1–A20 en el PC. No se verificó que la distro arranque, solo que la imagen se construye y pasa el inspector.

## Actualización 2026-10-10: imagen 2026.10.10 (librerías de las skills de oficina)

Probando en un PC real, el PowerPoint y el PDF fallaban: la imagen 2026.10.1 solo traía `python3-openpyxl/docx/pypdf/lxml`, sin
python-pptx, reportlab, pillow, pdfplumber ni pypdfium2, y dentro del sandbox no hay red ni pip. La imagen **2026.10.10** las lleva:

- Paquetes de Debian (`packages.txt`): `python3-xlsxwriter`, `python3-typing-extensions`, `python3-charset-normalizer`,
  `python3-cryptography` (dependencias de las de abajo, cumplen sus versiones mínimas).
- Con pip, en el build (`scripts/wsl-rootfs/pip-requirements.txt`, paso 6b de `customize.sh`): python-pptx 1.0.2, pdfplumber 0.11.10,
  pdfminer.six 20260107, pypdfium2 5.14.0, pillow 12.3.0, reportlab 5.0.1 (las mismas versiones que `resources/python-bin/requirements.txt`).
  Versiones exactas con `--hash`, `--require-hashes --only-binary=:all: --no-deps`, wheels cp313 manylinux x86_64, instaladas en
  `/usr/local/lib/python3.13/dist-packages` (el `python3` de Debian ya lo trae en `sys.path`, delante del de apt): las skills lo encuentran
  con `python3` (en Windows no se exporta `LAZUNOX_PYTHON`) sin cambiar el lanzador ni el entorno del sandbox. La imagen no lleva pip.
  `build-wsl-rootfs.sh` instala `python3-pip` en el contenedor del build y pasa `Acquire::Check-Valid-Until=false` a mmdebstrap (el
  `InRelease` de la instantánea de seguridad caduca a los ~7 días y rompía la reconstrucción).
- Tabla: `lazunox-rootfs-2026.10.10-x64.tar.gz`, 98 919 533 bytes (94,3 MB), 274 501 120 bytes descomprimida (9073 entradas), sha256
  `8f855de87d073755ff8024eb4fe8f639538dbde7067bc74586e96028263cf39e`; reproducible (`--check`: dos construcciones, mismo sha256),
  inspector en verde; 479 s las dos construcciones en el PC de pruebas. `pin.json`: `unpackedMax` sube a 402 653 184 (384 MiB).
- Verificado importando dentro de una distro de prueba (`Lazunox-PyTest`, ya borrada) como uid 1000 con `python3 -I`.
