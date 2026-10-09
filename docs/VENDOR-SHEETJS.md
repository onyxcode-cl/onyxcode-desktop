# `xlsx` (SheetJS Community Edition) vendorizado

El visor de Excel (Fase 3 del plan maestro del visor de documentos) usa SheetJS CE para leer `.xlsx`.
**No se instala desde el registro de npm**: la versión publicada ahí sigue teniendo los dos CVE
conocidos (CVE-2023-30533, CVE-2024-22363). La versión que los corrige, **v0.20.3**, solo se publica en
el CDN propio del proyecto, `cdn.sheetjs.com`.

## Qué se hizo

- Se descargó el tgz oficial: `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
- Se guardó tal cual, sin modificar, en `vendor/sheetjs/xlsx-0.20.3.tgz` (versionado en git).
- `package.json` declara `"xlsx": "file:vendor/sheetjs/xlsx-0.20.3.tgz"` — nunca una versión del
  registro de npm.
- `src/test/vendor-sheetjs.test.ts` falla si alguien cambia esa dependencia a una versión del registro,
  si `package-lock.json` deja de resolverla contra el archivo local, o si el archivo vendorizado se
  corrompe o se reemplaza por otro (lo detecta comparando el sha256).

## sha256 del tgz vendorizado

```
8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8  vendor/sheetjs/xlsx-0.20.3.tgz
```

Calculado una sola vez, al descargarlo (`shasum -a 256 vendor/sheetjs/xlsx-0.20.3.tgz`), el 2026-10-07.
SheetJS no publica un checksum oficial para este tgz, así que este hash es el que fija ESTE repositorio
como el valor de referencia, no una verificación contra un valor publicado por terceros.

## Para actualizar a una versión más nueva

1. Descargar el tgz nuevo desde `https://cdn.sheetjs.com/xlsx-<versión>/xlsx-<versión>.tgz`.
2. Reemplazar `vendor/sheetjs/xlsx-<versión>.tgz`, actualizar `package.json` y este archivo (nombre del
   tgz y sha256 nuevos).
3. `npm install`, confirmar que `src/test/vendor-sheetjs.test.ts` pasa con el hash nuevo.
