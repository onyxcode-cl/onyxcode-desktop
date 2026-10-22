/**
 * Ruta REAL del servidor MCP de `bgshell` (`resources/shell-bg/shell-bg-mcp.cjs`, generado por `npm run build:shell-bg`).
 * Empaquetado: `app.asar.unpacked/resources/shell-bg/...` (asarUnpack: Node no ejecuta un script de dentro del .asar), igual que
 * `translate-pdf/service.ts` con sus scripts. Desarrollo/pruebas: la raíz del repo (el «app path» puede ser `out/main`).
 * La parte pura (`shellBgScriptCandidates`, `resolveShellBgPath`) se prueba sin Electron.
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { unpacked } from '../util/asar'

export const SHELL_BG_SCRIPT = join('resources', 'shell-bg', 'shell-bg-mcp.cjs')

/** Posibles ubicaciones, en orden de preferencia (siempre ya con el `.asar` cambiado por `.asar.unpacked`). */
export function shellBgScriptCandidates(o: { appPath: string; dirname: string; cwd: string }): string[] {
  const bases = [o.appPath, join(o.dirname, '..', '..'), o.cwd]
  return [...new Set(bases.map((b) => unpacked(join(b, SHELL_BG_SCRIPT))))]
}

/** Primera candidata que existe, o `null` (el `.cjs` no se generó: `bgshell` no se ofrece). */
export function resolveShellBgPath(candidates: readonly string[], exists: (p: string) => boolean = existsSync): string | null {
  return candidates.find((c) => exists(c)) ?? null
}

/** Ruta absoluta del `.cjs` de `bgshell` (desarrollo y empaquetado), o `null` si no existe. */
export function bundledShellBgPath(): string | null {
  return resolveShellBgPath(shellBgScriptCandidates({ appPath: app.getAppPath(), dirname: __dirname, cwd: process.cwd() }))
}
