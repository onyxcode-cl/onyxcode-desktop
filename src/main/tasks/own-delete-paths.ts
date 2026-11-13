/** Traducción cerrada: las rutas WSL solo pueden pertenecer al montaje de la carpeta principal. */
import { fromSandboxPath, toSandboxPath } from '@shared/wsl-paths'
import { posix } from 'node:path'

export function mapOwnDeletePaths(
  folder: string,
  platform: NodeJS.Platform,
  cwd: string,
  paths: string[]
): { cwd: string; paths: string[] } | null {
  if (!cwd.startsWith('/') || [cwd, ...paths].some((p) => p.split('/').includes('..'))) return null
  const map = (p: string): string | null => {
    if (platform !== 'win32') return p
    const root = toSandboxPath(folder)
    if (!root.ok) return null
    const r = fromSandboxPath(p, [{ win: folder, linux: root.path }])
    return r.ok ? r.path : null
  }
  const hostCwd = map(cwd)
  const mapped = paths.map((p) => map(posix.resolve(cwd, p)))
  return hostCwd && mapped.every((p) => p !== null) ? { cwd: hostCwd, paths: mapped as string[] } : null
}
