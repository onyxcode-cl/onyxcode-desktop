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
- `python3-pptx` no existe en Debian 13: se quitó de `scripts/wsl-rootfs/packages.txt` (la skill `pptx` usa su plantilla sin
  dependencias; imágenes y gráficos en `.pptx` no se ofrecen en Windows).
- `customize.sh` ya no intenta cambiar la fecha de `/proc`, `/sys` y `/dev` (solo lectura dentro del chroot; mmdebstrap fija
  sus fechas al escribir el tar).

Falta (texto original; ver la actualización de arriba): publicar el archivo, fijarlo en `pin.json` (`wsl-rootfs`), empaquetar `resources/wsl` con el pin y probar la distro real
con la batería A1–A20 en el PC. No se verificó que la distro arranque, solo que la imagen se construye y pasa el inspector.
