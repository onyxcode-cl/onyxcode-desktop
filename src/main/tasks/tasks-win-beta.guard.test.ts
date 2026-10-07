/**
 * GUARDIA de la puerta de beta de Tareas en Windows (corre en `npm test`, en macOS, sin PC). SUSTITUYE a la guardia de informes
 * (decisión expresa del dueño, 2026-10-07: `tasks-win-report.ts` queda archivado, sin uso en producción).
 *
 * Con la bandera `TASKS_WIN_BUILD` en `true` (aquí se INYECTA: el literal de `feature-flags.ts` no se toca en esta guardia) Tareas
 * solo arranca con TODO esto: consentimiento beta vigente escrito por `main` (archivo propio, versionado), huella (tamaño y
 * sha256) del paquete incluido contra `pin.json`, carga y `state.json` coherentes, Lazunox NO elevado, política `disableWslTasks`
 * sin bloquear y distro `ready`. Todo cierra: nada «a medias». La lógica fina vive en `win-provider.test.ts`; aquí se fija el
 * conjunto contra el repositorio real (el literal, las lecturas de la bandera y el origen de la puerta).
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TASKS_WIN_BUILD } from '@shared/feature-flags'
import { selectBackend, WinBackendUnavailable, type WinBackendProvider } from './backends'
import { createWinBackendProvider } from './backends/win-provider'
import { wslRootfsUrl } from './backends/wsl-pin'
import { PAYLOAD_PY_NAMES } from './backends/wsl-real-deps'
import { expectedPayloadSha } from './backends/wsl-setup'
import {
  createTasksWinBetaStore,
  readTasksWinBetaConsent,
  TASKS_WIN_BETA_CONSENT_FILE,
  TASKS_WIN_BETA_CONSENT_VERSION
} from './tasks-win-beta-consent'
import { resolveTasksWin } from './tasks-win-flag'

const ROOT = join(__dirname, '../../..')
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')

const ROOTFS = Buffer.from('rootfs-guard-bytes')
const OPENCODE = Buffer.from('opencode-guard-bytes')
const V = '2026.10.1'
const pin = {
  version: '1.18.33',
  assets: {
    'linux-x64': {
      url: 'https://github.com/anomalyco/opencode/releases/download/v1.18.33/opencode-linux-x64.tar.gz',
      sha256: sha(OPENCODE),
      size: OPENCODE.length
    }
  },
  'wsl-rootfs': {
    version: V,
    minVersion: V,
    builtAt: '2026-10-06',
    url: wslRootfsUrl(V),
    sha256: sha(ROOTFS),
    size: ROOTFS.length,
    unpackedMax: 4000
  }
}

let tmp: string
let userData: string
let wsl: string
let elevated = false
let policy = false
let stateOverride: unknown | undefined

/** Un proveedor REAL (con la bandera inyectada en `true`) sobre un árbol temporal completo y coherente. */
function arrange(): WinBackendProvider {
  mkdirSync(join(wsl, 'images'), { recursive: true })
  mkdirSync(userData, { recursive: true })
  for (const n of PAYLOAD_PY_NAMES) writeFileSync(join(wsl, n), `# ${n}\n`)
  writeFileSync(join(wsl, 'pin.json'), JSON.stringify(pin))
  writeFileSync(join(wsl, 'images', `lazunox-rootfs-${V}-x64.tar.gz`), ROOTFS)
  writeFileSync(join(wsl, 'images', 'opencode-linux-x64.tar.gz'), OPENCODE)
  return createWinBackendProvider({
    build: true,
    dirs: { pinJson: join(wsl, 'pin.json'), payloadDir: wsl },
    userDataDir: userData,
    fetch: (async () => new Response('')) as never,
    hostEnv: { LOCALAPPDATA: 'C:\\Users\\Ben\\AppData\\Local' },
    isElevated: async () => elevated,
    policyDisabled: () => policy,
    readState: async () =>
      stateOverride !== undefined
        ? stateOverride
        : {
            rootfsVersion: V,
            rootfsSha: sha(ROOTFS),
            payloadSha: expectedPayloadSha(
              PAYLOAD_PY_NAMES.map((n) => ({ path: n, data: Buffer.from(`# ${n}\n`) })),
              { sha256: sha(OPENCODE), size: OPENCODE.length }
            ),
            importedAt: '2026-10-07T00:00:00.000Z'
          }
  })
}
const consent = (raw: unknown = { version: TASKS_WIN_BETA_CONSENT_VERSION, at: 1000 }): void =>
  writeFileSync(join(userData, TASKS_WIN_BETA_CONSENT_FILE), typeof raw === 'string' ? raw : JSON.stringify(raw))
/** Lo que hace `main` con la bandera en `true`: `tasksWin` desde el consentimiento del archivo, y la puerta al arrancar. */
const tasksWin = (): boolean =>
  resolveTasksWin({ platform: 'win32', build: true, optIn: readTasksWinBetaConsent(userData), env: {}, isPackaged: true, policy: null })
async function start(win: WinBackendProvider, tw = tasksWin()): Promise<string> {
  try {
    await selectBackend('win32', { tasksWin: tw, win })
    return 'arrancó'
  } catch (e) {
    return e instanceof WinBackendUnavailable ? e.block : `otro:${String(e)}`
  }
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'lzx-betaguard-'))
  userData = join(tmp, 'userData')
  wsl = join(tmp, 'wsl')
  elevated = false
  policy = false
  stateOverride = undefined
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('guardia de la puerta de beta de Tareas en Windows', () => {
  it('la bandera real sigue siendo un booleano; las pruebas con `true` la inyectan', () => {
    expect(typeof TASKS_WIN_BUILD).toBe('boolean')
  })

  it('con la bandera en true y SIN consentimiento beta NO arranca (ni hay `tasksWin`)', async () => {
    const win = arrange()
    expect(tasksWin()).toBe(false)
    expect(await start(win)).toBe('flag')
    // Aunque algo forzara `tasksWin`, la puerta cierra por consentimiento.
    expect(await start(win, true)).toBe('consent')
  })

  it('con TODO en orden (consentimiento vigente, paquete, estado, no elevado) abre; con `ready` lo exige `startTasksServer`', async () => {
    const win = arrange()
    consent()
    expect(tasksWin()).toBe(true)
    expect(await start(win)).toBe('arrancó')
  })

  it('consentimiento de otra versión, corrupto, o `settings.tasksWinBeta=true` solo NO enciende nada', async () => {
    const win = arrange()
    for (const raw of [
      { version: TASKS_WIN_BETA_CONSENT_VERSION + 1, at: 5 },
      { version: TASKS_WIN_BETA_CONSENT_VERSION - 1, at: 5 },
      '{corrupto',
      '',
      { version: TASKS_WIN_BETA_CONSENT_VERSION }
    ]) {
      consent(raw)
      expect(tasksWin(), JSON.stringify(raw)).toBe(false)
      expect(await start(win, true), JSON.stringify(raw)).toBe('consent')
    }
    rmSync(join(userData, TASKS_WIN_BETA_CONSENT_FILE))
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ tasksWinBeta: true }))
    expect(tasksWin()).toBe(false)
    expect(await start(win, true)).toBe('consent')
  })

  it('el consentimiento solo lo escribe `main` por su almacén (0600 en POSIX); revocar cierra el SIGUIENTE arranque', async () => {
    const win = arrange()
    const store = createTasksWinBetaStore(userData)
    store.write({ version: TASKS_WIN_BETA_CONSENT_VERSION, at: 1000 })
    expect(await start(win)).toBe('arrancó')
    store.write(null) // revocar: no detiene tareas en curso, pero el próximo servidor se niega
    expect(await start(win, true)).toBe('consent')
  })

  it('huella del paquete distinta (un byte) o tamaño distinto NO arranca', async () => {
    const win = arrange()
    consent()
    const f = join(wsl, 'images', `lazunox-rootfs-${V}-x64.tar.gz`)
    const flipped = Buffer.from(ROOTFS)
    flipped[0] = flipped[0]! ^ 1
    writeFileSync(f, flipped)
    expect(await start(win)).toBe('bundle')
    writeFileSync(f, Buffer.concat([ROOTFS, Buffer.from('x')]))
    expect(await start(win)).toBe('bundle')
    writeFileSync(f, ROOTFS)
    writeFileSync(join(wsl, 'images', 'opencode-linux-x64.tar.gz'), Buffer.from('opencode-guard-bytez'))
    expect(await start(win)).toBe('bundle')
  })

  it('sin pin (o sin imágenes) NO arranca', async () => {
    const win = arrange()
    consent()
    rmSync(join(wsl, 'pin.json'))
    expect(await start(win)).toBe('gate')
    writeFileSync(join(wsl, 'pin.json'), JSON.stringify(pin))
    rmSync(join(wsl, 'images'), { recursive: true })
    expect(await start(win)).toBe('bundle')
  })

  it('con Lazunox ELEVADO (administrador) o sin poder saberlo NO arranca', async () => {
    const win = arrange()
    consent()
    elevated = true
    expect(await start(win)).toBe('elevated')
  })

  it('`state.json` de otra imagen (mismo número de versión) o ausente NO arranca', async () => {
    const win = arrange()
    consent()
    stateOverride = { rootfsVersion: V, rootfsSha: sha('otra'), payloadSha: sha('x'), importedAt: 'x' }
    expect(await start(win)).toBe('gate')
    stateOverride = null
    expect(await start(win)).toBe('gate')
  })

  it('la política `disableWslTasks` NO arranca (ni enciende `tasksWin`)', async () => {
    const win = arrange()
    consent()
    policy = true
    expect(await start(win, true)).toBe('gate')
    expect(
      resolveTasksWin({ platform: 'win32', build: true, optIn: true, env: {}, isPackaged: true, policy: { disableWslTasks: true } })
    ).toBe(false)
  })

  it('no hay informes en la puerta de producción: `win-provider.ts` e `index.ts` no usan la guardia de informes', () => {
    const src = (rel: string): string =>
      readFileSync(join(ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
    for (const rel of ['src/main/tasks/backends/win-provider.ts', 'src/main/tasks/backends/index.ts']) {
      expect(src(rel), rel).not.toMatch(/tasks-win-report|windowsReportOk|gateProblems|\.report\(\)|'report'/)
    }
  })

  it('TASKS_WIN_BUILD es un LITERAL booleano (no se deriva de entorno ni de otra variable)', () => {
    const src = readFileSync(join(ROOT, 'src/shared/feature-flags.ts'), 'utf8')
    expect(src).toMatch(/^export const TASKS_WIN_BUILD = (?:true|false)$/m)
    expect(src.match(/TASKS_WIN_BUILD\s*=/g)).toHaveLength(1)
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/process\.env|import\.meta|require\(|\bapp\./)
  })

  it('TASKS_WIN_BUILD no se reasigna ni se reexporta con otro valor en ningún sitio del código', () => {
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n)
        if (statSync(p).isDirectory()) {
          if (n !== 'node_modules') walk(p)
        } else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) && p !== join(ROOT, 'src/shared/feature-flags.ts')) {
          const s = readFileSync(p, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '')
          if (/TASKS_WIN_BUILD\s*(?:=[^=]|as\s)|(?:let|var)\s+TASKS_WIN_BUILD|TASKS_WIN_BUILD\s*:\s*boolean/.test(s))
            offenders.push(relative(ROOT, p))
        }
      }
    }
    walk(join(ROOT, 'src'))
    expect(offenders).toEqual([])
  })

  it('LAZUNOX_TASKS_WIN solo se lee en tasks-win-flag.ts y exige isPackaged === false', () => {
    const readers: string[] = []
    const walk = (dir: string): void => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n)
        if (statSync(p).isDirectory()) {
          if (n !== 'node_modules') walk(p)
        } else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) {
          const s = readFileSync(p, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '')
          if (s.includes('LAZUNOX_TASKS_WIN')) readers.push(relative(ROOT, p).split(sep).join('/'))
        }
      }
    }
    walk(join(ROOT, 'src'))
    expect(readers).toEqual(['src/main/tasks/tasks-win-flag.ts'])
    const flag = readFileSync(join(ROOT, 'src/main/tasks/tasks-win-flag.ts'), 'utf8')
    expect(flag).toMatch(/env\.LAZUNOX_TASKS_WIN === '1' && isPackaged === false/)
  })
})
