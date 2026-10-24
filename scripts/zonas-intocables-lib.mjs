// Zonas intocables (AGENTS.md §7): los archivos que son controles de seguridad. La regla ya no depende de que alguien lea los cambios:
// la prueba `src/test/zonas-intocables.test.ts` compara la huella de cada archivo con `docs/zonas-intocables.json` y FALLA en la CI si
// cambió sin dejar un motivo. Cambiarlos sigue siendo posible, pero a propósito y a la vista: `npm run zonas:actualizar -- "motivo"`.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Archivos exactos y carpetas (solo el primer nivel, sin pruebas) que forman las zonas. */
export const ARCHIVOS = [
  'src/main/tasks/sandbox-profile.ts',
  'src/main/tasks/sandbox.ts',
  'src/main/tasks/proxy.ts',
  'src/main/tasks/provider-egress.ts',
  'src/main/tasks/proxy-policy.ts',
  'src/main/tasks/opencode-config.ts',
  'src/main/tasks/folder-policy.ts',
  'src/main/tasks/folder-policy-win.ts',
  'src/main/tasks/ui-path.ts',
  'src/main/tasks/win-context.ts',
  'src/shared/wsl-paths.ts',
  'src/main/security/app-protocol.ts',
  'src/renderer/index.html',
  'src/main/remote/remote-win-flag.ts',
  'src/preload/quick.ts',
  'src/preload/overlay.ts',
  'src/preload/pill.ts',
  'src/preload/assist.ts',
  'src/preload/browser-host.ts',
  'resources/computer-use/helper.swift'
]
/** Carpeta → filtro del nombre de archivo. */
export const CARPETAS = [
  ['src/main/tasks/backends', (n) => /^wsl.*\.ts$/.test(n) && !/\.test\.ts$/.test(n)],
  ['resources/wsl', (n) => /\.(py|conf|json)$/.test(n) && !/^test_/.test(n)]
]

const huella = (file) =>
  createHash('sha256')
    .update(readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n'))
    .digest('hex')

export function archivosDeZonas() {
  const out = [...ARCHIVOS]
  for (const [dir, filtro] of CARPETAS) {
    const abs = join(ROOT, dir)
    if (!existsSync(abs)) continue
    for (const n of readdirSync(abs).sort())
      if (statSync(join(abs, n)).isFile() && filtro(n)) out.push(relative(ROOT, join(abs, n)).split('\\').join('/')) // claves con «/» también en Windows
  }
  return [...new Set(out)].sort()
}

export function huellasActuales() {
  const r = {}
  for (const f of archivosDeZonas()) if (existsSync(join(ROOT, f))) r[f] = huella(f)
  return r
}

export const MANIFIESTO = join(ROOT, 'docs', 'zonas-intocables.json')
export const leerManifiesto = () => JSON.parse(readFileSync(MANIFIESTO, 'utf8'))

/** Diferencias entre las huellas actuales y el manifiesto: cambiados, nuevos (sin registrar) y desaparecidos. */
export function diferencias(manifiesto = leerManifiesto(), actuales = huellasActuales()) {
  const guardadas = manifiesto.huellas ?? {}
  return {
    cambiados: Object.keys(actuales).filter((f) => f in guardadas && guardadas[f] !== actuales[f]),
    nuevos: Object.keys(actuales).filter((f) => !(f in guardadas)),
    desaparecidos: Object.keys(guardadas).filter((f) => !(f in actuales))
  }
}
