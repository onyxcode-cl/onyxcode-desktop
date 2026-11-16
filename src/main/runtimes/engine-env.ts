/** Node.js y uv de la app como respaldo del PATH de los motores; los conectores conservan sus rutas absolutas. */
import { posix, win32 } from 'node:path'
import { augmentedPath } from '../process/child-env'
import type { AppRuntimeBins } from './runtime-install'
import { runtimesService } from './service'

/** `bins` solo contiene runtimes instalados y verificados. Conserva el PATH existente, incluida su clave en Windows. */
export function runtimePathEnv(
  bins: AppRuntimeBins,
  env: Record<string, string>,
  platform: NodeJS.Platform = process.platform
): Record<string, string> {
  const paths = platform === 'win32' ? win32 : posix
  const dirs = [bins.node, bins.uv].filter((p): p is string => !!p).map((p) => paths.dirname(p))
  if (!dirs.length) return {}
  const key = Object.keys(env).find((k) => (platform === 'win32' ? k.toUpperCase() === 'PATH' : k === 'PATH')) ?? 'PATH'
  return {
    [key]: augmentedPath(env[key] ?? '', dirs, platform),
    // npm test y otros comandos locales no deben consultar el registro solo para anunciar actualizaciones.
    ...(bins.node ? { npm_config_update_notifier: 'false' } : {})
  }
}

/** Sin runtimes o si se están instalando: el motor arranca igual. Se vuelve a consultar en cada arranque. */
export function appRuntimePathEnv(env: Record<string, string>): Record<string, string> {
  try {
    return runtimePathEnv(runtimesService().bins(), env)
  } catch {
    return {}
  }
}

/** Solo las versiones instaladas: Node necesita leer también lib/node_modules/npm, además de bin/. */
export function appRuntimeReadOnlyDirs(): string[] {
  try {
    const { node, uv } = runtimesService().check()
    return [node, uv].flatMap((s) => (s.state === 'installed' ? [s.dir] : []))
  } catch {
    return []
  }
}
