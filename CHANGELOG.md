# Cambios de OnyxCode

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Las versiones siguen [SemVer](https://semver.org/lang/es/).
Cada sección se usa tal cual como notas de la release en GitHub (`scripts/release-notes.mjs`), así que se escribe en lenguaje llano para
quien usa la app. El detalle técnico de cada cambio está en `CHANGELOG-FASE6.md`, `CHANGELOG-FASE7.md` y `CHANGELOG-FASE8.md`.

## [Sin publicar]

### Añadido

- Preparación para publicar: instalador firmado y notarizado por Apple, actualizaciones automáticas verificadas y flujo de publicación con aprobación manual.

### Eliminado

- Ya no hace falta iniciar sesión: OnyxCode deja de tener cuentas. Desaparecen la pantalla de acceso (Google o correo
  con código) y Ajustes › Cuenta. La app ya no se conecta a ningún servidor de cuentas. Al abrir esta versión se borra
  del equipo la sesión que hubiera quedado guardada; tus claves de IA, tus conversaciones y los celulares vinculados no
  se tocan.

## [0.3.0] - Sin publicar

Versión interna actual. No se ha distribuido todavía; sus notas se completarán antes de la primera publicación.
