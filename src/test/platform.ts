/**
 * Banderas de plataforma para las pruebas. Úsalas con `describe.skipIf(!macOnly)` / `it.skipIf(!posixOnly)`
 * SOLO para módulos fuera de la v1 de Windows (Tareas/Seatbelt, Control del PC, actualizador) o para
 * fixtures que son scripts `#!/bin/sh`/permisos POSIX; cada salto lleva un comentario con el motivo.
 */
export const isWin = process.platform === 'win32'
/** macOS: Tareas (Seatbelt), restore-points de Tareas, actualizador (swap.sh). */
export const macOnly = process.platform === 'darwin'
/** Linux/macOS: scripts sh, permisos 0600/0700, grupos de procesos, symlinks sin privilegios. */
export const posixOnly = process.platform !== 'win32'
export const winOnly = isWin
