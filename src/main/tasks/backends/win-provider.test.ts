/**
 * Proveedor del backend de Windows: cierra ante cualquier falta (pin, carga, informes) y solo abre con ambos informes del PC
 * en verde que describen EXACTAMENTE la carga y el pin de esta app. Sin Windows: dirs temporales, `fetch` doble, nada de `wsl.exe`.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { H, okReport } from '../__fixtures__/tasks-win-report.fixture'
import { ISOLATION_FILES } from '../tasks-win-report'
import { createWinBackendProvider, windowsReportOk, type WinProviderDirs } from './win-provider'
import { wslRootfsUrl } from './wsl-pin'
import { PAYLOAD_PY_NAMES } from './wsl-real-deps'
import { expectedPayloadSha } from './wsl-setup'

let root: string
let dirs: WinProviderDirs
const OC = {
  version: '1.18.33',
  url: 'https://github.com/anomalyco/opencode/releases/download/v1.18.33/opencode-linux-x64.tar.gz',
  sha256: H(5),
  size: 1000
}
const pinJson = {
  version: OC.version,
  assets: { 'linux-x64': { url: OC.url, sha256: OC.sha256, size: OC.size } },
  'wsl-rootfs': {
    version: '2026.10.1',
    minVersion: '2026.10.1',
    builtAt: '2026-10-01',
    url: wslRootfsUrl('2026.10.1'),
    sha256: H(900),
    size: 1000,
    unpackedMax: 4000
  }
}
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

function writeAll(opts: { pin?: boolean; reports?: boolean; tamper?: (r: ReturnType<typeof okReport>) => void } = {}): void {
  const { pin = true, reports = true } = opts
  mkdirSync(dirs.payloadDir, { recursive: true })
  mkdirSync(dirs.evidenceDir, { recursive: true })
  for (const n of PAYLOAD_PY_NAMES) writeFileSync(join(dirs.payloadDir, n), `# ${n}\n`)
  writeFileSync(join(dirs.payloadDir, 'wsl.conf'), '[automount]\nenabled=false\n')
  if (pin) writeFileSync(dirs.pinJson, JSON.stringify(pinJson))
  if (!reports) return
  const py = PAYLOAD_PY_NAMES.map((n) => ({ path: n, data: Buffer.from(`# ${n}\n`) }))
  for (const s of ['elevated', 'normal'] as const) {
    const r = okReport(s)
    r.generatedAt = '2026-01-01T00:00:00Z'
    r.build.rootfsSha = H(900)
    r.build.opencodeVersion = OC.version
    r.build.payloadSha = expectedPayloadSha(py, OC)
    for (const n of PAYLOAD_PY_NAMES) r.build.hashes[`resources/wsl/${n}`] = sha(`# ${n}\n`)
    r.build.hashes['resources/wsl/wsl.conf'] = sha('[automount]\nenabled=false\n')
    opts.tamper?.(r)
    writeFileSync(join(dirs.evidenceDir, `tasks-win-report.${s}.json`), JSON.stringify(r))
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lzx-winprov-'))
  dirs = { pinJson: join(root, 'pin.json'), payloadDir: join(root, 'wsl'), evidenceDir: join(root, 'evidence') }
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('windowsReportOk', () => {
  it('sin nada en disco: cerrado', async () => {
    expect(await windowsReportOk(dirs)).toBe(false)
  })
  it('sin pin o sin informes: cerrado', async () => {
    writeAll({ pin: false })
    expect(await windowsReportOk(dirs)).toBe(false)
    rmSync(root, { recursive: true, force: true })
    mkdirSync(root, { recursive: true })
    writeAll({ reports: false })
    expect(await windowsReportOk(dirs)).toBe(false)
  })
  it('con ambos informes en verde y coherentes: abierto (el hash de src/ lo certifica la guardia de CI)', async () => {
    // Los archivos de src/ no se recalculan aquí: se acepta lo que ambas sesiones afirman; el resto del esquema sí se exige.
    writeAll()
    expect(await windowsReportOk(dirs)).toBe(true)
  })
  it('un byte distinto en launcher.py respecto al informe: cerrado', async () => {
    writeAll()
    writeFileSync(join(dirs.payloadDir, 'launcher.py'), '# launcher.py\nimport os\n')
    expect(await windowsReportOk(dirs)).toBe(false)
  })
  it('payloadSha, rootfsSha o versión de OpenCode distintos del pin: cerrado', async () => {
    writeAll({ tamper: (r) => (r.build.payloadSha = H(1)) })
    expect(await windowsReportOk(dirs)).toBe(false)
    writeAll({ tamper: (r) => (r.build.rootfsSha = H(2)) })
    expect(await windowsReportOk(dirs)).toBe(false)
    writeAll({ tamper: (r) => (r.build.opencodeVersion = '9.9.9') })
    expect(await windowsReportOk(dirs)).toBe(false)
  })
  it('informe rojo, sucio, con un B en fail o con las dos sesiones en desacuerdo sobre src/: cerrado', async () => {
    writeAll({ tamper: (r) => (r.status = 'red') })
    expect(await windowsReportOk(dirs)).toBe(false)
    writeAll({ tamper: (r) => (r.status = 'dirty') })
    expect(await windowsReportOk(dirs)).toBe(false)
    writeAll({ tamper: (r) => (r.results[3]!.status = 'fail') })
    expect(await windowsReportOk(dirs)).toBe(false)
    writeAll()
    const f = join(dirs.evidenceDir, 'tasks-win-report.normal.json')
    const r = okReport('normal')
    r.generatedAt = '2026-01-01T00:00:00Z'
    r.build.hashes[ISOLATION_FILES[0]!] = H(777)
    writeFileSync(f, JSON.stringify(r))
    expect(await windowsReportOk(dirs)).toBe(false)
  })
  it('JSON corrupto o esquema inválido: cerrado', async () => {
    writeAll()
    writeFileSync(join(dirs.evidenceDir, 'tasks-win-report.elevated.json'), '{no es json')
    expect(await windowsReportOk(dirs)).toBe(false)
  })
})

describe('createWinBackendProvider', () => {
  const base = (over: Partial<Parameters<typeof createWinBackendProvider>[0]> = {}): ReturnType<typeof createWinBackendProvider> =>
    createWinBackendProvider({
      dirs,
      fetch: (async () => new Response('')) as never,
      hostEnv: { LOCALAPPDATA: 'C:\\Users\\Ben\\AppData\\Local' },
      ...over
    })

  it('`build` es la constante real (apagada) salvo inyección de prueba', () => {
    expect(base().build).toBe(false)
    expect(base({ build: true }).build).toBe(true)
  })
  it('create(): sin pin, sin carga o sin LOCALAPPDATA devuelve null', () => {
    expect(base().create()).toBeNull()
    writeAll({ pin: false })
    expect(base().create()).toBeNull()
    writeAll()
    expect(base({ hostEnv: {} }).create()).toBeNull()
  })
  it('create() con todo devuelve el backend de la distro (sin lanzar wsl.exe)', () => {
    writeAll()
    const b = base().create()
    expect(b?.id).toBe('wsl')
    expect(typeof b?.setup).toBe('function')
  })
  it('report() nunca lanza: ante cualquier error es false', async () => {
    expect(await base().report()).toBe(false)
    writeAll()
    expect(await base().report()).toBe(true)
  })
})
