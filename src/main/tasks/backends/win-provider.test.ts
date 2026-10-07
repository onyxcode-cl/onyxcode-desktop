/**
 * Proveedor del backend de Windows y su PUERTA de arranque (`gate()`, que sustituye a la guardia de informes; decisión del dueño,
 * 2026-10-07). Cada eslabón falla CERRADO: consentimiento beta (releído del disco), no elevado, pin, huella del paquete incluido,
 * carga y `state.json`. Sin Windows: dirs temporales, `fetch` doble, nada de `wsl.exe` ni de `whoami.exe`.
 */
import { createHash } from 'node:crypto'
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TASKS_WIN_BETA_CONSENT_FILE, TASKS_WIN_BETA_CONSENT_VERSION } from '../tasks-win-beta-consent'
import { bundleFingerprintCacheSize, clearBundleFingerprintCache, createWinBackendProvider, type WinProviderDirs } from './win-provider'
import { wslRootfsUrl } from './wsl-pin'
import { PAYLOAD_PY_NAMES } from './wsl-real-deps'
import { expectedPayloadSha } from './wsl-setup'

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex')
const ROOTFS = Buffer.from('rootfs-bytes-0123456789')
const OPENCODE = Buffer.from('opencode-linux-bytes-abcdef')
const VERSION = '2026.10.1'
const ROOTFS_NAME = `lazunox-rootfs-${VERSION}-x64.tar.gz`
const OPENCODE_NAME = 'opencode-linux-x64.tar.gz'
const pinJson = {
  version: '1.18.33',
  assets: {
    'linux-x64': {
      url: 'https://github.com/anomalyco/opencode/releases/download/v1.18.33/opencode-linux-x64.tar.gz',
      sha256: sha(OPENCODE),
      size: OPENCODE.length
    }
  },
  'wsl-rootfs': {
    version: VERSION,
    minVersion: VERSION,
    builtAt: '2026-10-06',
    url: wslRootfsUrl(VERSION),
    sha256: sha(ROOTFS),
    size: ROOTFS.length,
    unpackedMax: 4000
  }
}
const py = PAYLOAD_PY_NAMES.map((n) => ({ path: n, data: Buffer.from(`# ${n}\n`) }))
const payloadSha = (): string => expectedPayloadSha(py, { sha256: sha(OPENCODE), size: OPENCODE.length })
const goodState = (): Record<string, string> => ({
  rootfsVersion: VERSION,
  rootfsSha: sha(ROOTFS),
  payloadSha: payloadSha(),
  importedAt: '2026-10-07T00:00:00.000Z'
})

let root: string
let userData: string
let dirs: WinProviderDirs
let state: unknown
let elevated: boolean | null
let policy: boolean

function writeAll(
  o: { pin?: boolean; images?: boolean; consent?: unknown; payload?: boolean; rootfs?: Buffer; opencode?: Buffer } = {}
): void {
  mkdirSync(dirs.payloadDir, { recursive: true })
  mkdirSync(dirs.imagesDir!, { recursive: true })
  mkdirSync(userData, { recursive: true })
  if (o.payload !== false) for (const n of PAYLOAD_PY_NAMES) writeFileSync(join(dirs.payloadDir, n), `# ${n}\n`)
  writeFileSync(join(dirs.payloadDir, 'wsl.conf'), '[automount]\nenabled=false\n')
  if (o.pin !== false) writeFileSync(dirs.pinJson, JSON.stringify(pinJson))
  if (o.images !== false) {
    writeFileSync(join(dirs.imagesDir!, ROOTFS_NAME), o.rootfs ?? ROOTFS)
    writeFileSync(join(dirs.imagesDir!, OPENCODE_NAME), o.opencode ?? OPENCODE)
  }
  const consent = o.consent === undefined ? { version: TASKS_WIN_BETA_CONSENT_VERSION, at: 1000 } : o.consent
  if (consent !== null)
    writeFileSync(join(userData, TASKS_WIN_BETA_CONSENT_FILE), typeof consent === 'string' ? consent : JSON.stringify(consent))
}

const make = (over: Partial<Parameters<typeof createWinBackendProvider>[0]> = {}): ReturnType<typeof createWinBackendProvider> =>
  createWinBackendProvider({
    dirs,
    userDataDir: userData,
    fetch: (async () => new Response('')) as never,
    hostEnv: { LOCALAPPDATA: 'C:\\Users\\Ben\\AppData\\Local' },
    isElevated: async () => elevated,
    readState: async () => state,
    policyDisabled: () => policy,
    build: true,
    ...over
  })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lzx-winprov-'))
  userData = join(root, 'userData')
  dirs = { pinJson: join(root, 'pin.json'), payloadDir: join(root, 'wsl'), imagesDir: join(root, 'wsl', 'images') }
  state = goodState()
  elevated = false
  policy = false
  clearBundleFingerprintCache()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('gate(): camino feliz', () => {
  it('con TODO en orden abre', async () => {
    writeAll()
    expect(await make().gate()).toEqual({ ok: true })
    expect(await make().gate('run')).toEqual({ ok: true })
  })
})

describe('gate(): consentimiento beta (se relee del disco en cada llamada)', () => {
  it('sin archivo: cierra con `consent`', async () => {
    writeAll({ consent: null })
    expect(await make().gate()).toEqual({ ok: false, reason: 'consent' })
  })
  it('corrupto, de otra versión (vieja o futura) o con forma rara: cierra con `consent`', async () => {
    for (const c of [
      '{',
      '',
      'null',
      { version: 0, at: 5 },
      { version: TASKS_WIN_BETA_CONSENT_VERSION + 1, at: 5 },
      { version: 1 },
      { at: 5 }
    ]) {
      writeAll({ consent: c })
      expect(await make().gate(), JSON.stringify(c)).toEqual({ ok: false, reason: 'consent' })
    }
  })
  it('sin userData conocido: cierra con `consent`', async () => {
    writeAll()
    const p = make({ userDataDir: '' })
    expect(await p.gate()).toEqual({ ok: false, reason: 'consent' })
  })
  it('revocar con el proveedor ya construido cierra el SIGUIENTE arranque (no detiene tareas en curso)', async () => {
    writeAll()
    const p = make()
    expect(await p.gate()).toEqual({ ok: true })
    rmSync(join(userData, TASKS_WIN_BETA_CONSENT_FILE))
    expect(await p.gate()).toEqual({ ok: false, reason: 'consent' })
    writeFileSync(join(userData, TASKS_WIN_BETA_CONSENT_FILE), JSON.stringify({ version: TASKS_WIN_BETA_CONSENT_VERSION, at: 9 }))
    expect(await p.gate()).toEqual({ ok: true })
  })
  it('`settings.json` con `tasksWinBeta: true` NO sustituye al consentimiento', async () => {
    writeAll({ consent: null })
    writeFileSync(join(userData, 'settings.json'), JSON.stringify({ tasksWinBeta: true }))
    expect(await make().gate()).toEqual({ ok: false, reason: 'consent' })
  })
})

describe('gate(): elevación (Tareas se niega a arrancar como administrador)', () => {
  it('elevado, o sin poder saberlo (null o fallo): cierra con `elevated`', async () => {
    writeAll()
    elevated = true
    expect(await make().gate()).toEqual({ ok: false, reason: 'elevated' })
    elevated = null
    expect(await make().gate()).toEqual({ ok: false, reason: 'elevated' })
    const boom = make({
      isElevated: async () => {
        throw new Error('x')
      }
    })
    expect(await boom.gate()).toEqual({ ok: false, reason: 'elevated' })
    expect(await make({ isElevated: (async () => 'no') as never }).gate()).toEqual({ ok: false, reason: 'elevated' })
  })
  it('también para preparar la distro (`setup`)', async () => {
    writeAll()
    elevated = true
    expect(await make().gate('setup')).toEqual({ ok: false, reason: 'elevated' })
  })
  it('se reevalúa en cada llamada', async () => {
    writeAll()
    const p = make()
    expect((await p.gate()).ok).toBe(true)
    elevated = true
    expect((await p.gate()).ok).toBe(false)
  })
})

describe('gate(): pin', () => {
  it('sin pin, o pin sin `wsl-rootfs`/`linux-x64`: cierra con `pin`', async () => {
    writeAll({ pin: false })
    expect(await make().gate()).toEqual({ ok: false, reason: 'pin' })
    writeFileSync(dirs.pinJson, JSON.stringify({ version: '1.18.33' }))
    expect(await make().gate()).toEqual({ ok: false, reason: 'pin' })
    writeFileSync(dirs.pinJson, '{no es json')
    expect(await make().gate()).toEqual({ ok: false, reason: 'pin' })
  })
})

describe('gate(): huella del paquete incluido', () => {
  it('imagen o opencode ausentes: cierra con `bundle`', async () => {
    writeAll({ images: false })
    expect(await make().gate()).toEqual({ ok: false, reason: 'bundle' })
    writeAll()
    rmSync(join(dirs.imagesDir!, OPENCODE_NAME))
    expect(await make().gate()).toEqual({ ok: false, reason: 'bundle' })
  })
  it('tamaño distinto: cierra con `bundle` (sin llegar a calcular el hash)', async () => {
    writeAll({ rootfs: Buffer.concat([ROOTFS, Buffer.from('x')]) })
    expect(await make().gate()).toEqual({ ok: false, reason: 'bundle' })
    expect(bundleFingerprintCacheSize()).toBe(0)
  })
  it('mismo tamaño pero un byte distinto (sha distinto): cierra con `bundle`', async () => {
    const flipped = Buffer.from(ROOTFS)
    flipped[3] = flipped[3]! ^ 1
    writeAll({ rootfs: flipped })
    expect(await make().gate()).toEqual({ ok: false, reason: 'bundle' })
    const op = Buffer.from(OPENCODE)
    op[0] = op[0]! ^ 1
    writeAll({ opencode: op })
    expect(await make().gate()).toEqual({ ok: false, reason: 'bundle' })
  })
  it('un enlace simbólico o físico en lugar del archivo: cierra con `bundle`', async () => {
    writeAll()
    const real = join(root, 'real.tar.gz')
    writeFileSync(real, ROOTFS)
    rmSync(join(dirs.imagesDir!, ROOTFS_NAME))
    try {
      symlinkSync(real, join(dirs.imagesDir!, ROOTFS_NAME))
    } catch {
      return // sin permiso para enlaces simbólicos en este equipo
    }
    expect(await make().gate()).toEqual({ ok: false, reason: 'bundle' })
  })
  it('una carpeta con el nombre del archivo: cierra con `bundle`', async () => {
    writeAll()
    rmSync(join(dirs.imagesDir!, OPENCODE_NAME))
    mkdirSync(join(dirs.imagesDir!, OPENCODE_NAME))
    expect(await make().gate()).toEqual({ ok: false, reason: 'bundle' })
  })
  it('el hash se cachea por ruta + tamaño + mtime: no se recalcula, y un cambio de mtime lo invalida', async () => {
    writeAll()
    const p = make()
    expect((await p.gate()).ok).toBe(true)
    expect(bundleFingerprintCacheSize()).toBe(2)
    // Cambia el contenido conservando tamaño y mtime: la caché NO lo ve (es integridad contra corrupción, no contra un atacante local).
    const f = join(dirs.imagesDir!, ROOTFS_NAME)
    const st = { atime: new Date(5_000_000), mtime: new Date(5_000_000) }
    utimesSync(f, st.atime, st.mtime)
    expect((await p.gate()).ok).toBe(true) // se cacheó con ese mtime
    const flipped = Buffer.from(ROOTFS)
    flipped[3] = flipped[3]! ^ 1
    writeFileSync(f, flipped)
    utimesSync(f, st.atime, st.mtime)
    expect((await p.gate()).ok).toBe(true)
    // Con otro mtime se vuelve a calcular y cierra.
    utimesSync(f, new Date(6_000_000), new Date(6_000_000))
    expect(await p.gate()).toEqual({ ok: false, reason: 'bundle' })
  })
  it('un hash malo no se cachea como bueno', async () => {
    const flipped = Buffer.from(ROOTFS)
    flipped[3] = flipped[3]! ^ 1
    writeAll({ rootfs: flipped })
    const p = make()
    expect((await p.gate()).ok).toBe(false)
    writeAll() // se corrige el archivo
    expect((await p.gate()).ok).toBe(true)
  })
  it('no hay enlaces físicos que cuelen otro archivo', async () => {
    writeAll()
    const other = join(root, 'otro.bin')
    writeFileSync(other, Buffer.alloc(ROOTFS.length, 1))
    rmSync(join(dirs.imagesDir!, ROOTFS_NAME))
    try {
      linkSync(other, join(dirs.imagesDir!, ROOTFS_NAME))
    } catch {
      return
    }
    expect(await make().gate()).toEqual({ ok: false, reason: 'bundle' })
  })
})

describe('gate(): carga de Linux', () => {
  it('falta un .py de la carga: cierra con `payload`', async () => {
    writeAll({ payload: false })
    expect(await make().gate()).toEqual({ ok: false, reason: 'payload' })
  })
  it('un .py distinto del que registró state.json (`payloadSha`): cierra con `state` al arrancar', async () => {
    writeAll()
    writeFileSync(join(dirs.payloadDir, 'launcher.py'), '# launcher.py\nimport os\n')
    expect(await make().gate()).toEqual({ ok: false, reason: 'state' })
  })
})

describe('gate(): state.json del usuario', () => {
  it('ausente, ilegible o de otra forma: cierra con `state`', async () => {
    writeAll()
    for (const s of [undefined, null, '', 'x', 5, [], {}, { rootfsSha: sha(ROOTFS) }, { ...goodState(), rootfsSha: 7 }]) {
      state = s
      expect(await make().gate(), JSON.stringify(s)).toEqual({ ok: false, reason: 'state' })
    }
    const boom = make({
      readState: async () => {
        throw new Error('x')
      }
    })
    expect(await boom.gate()).toEqual({ ok: false, reason: 'state' })
  })
  it('`rootfsSha` de otra imagen (mismo `rootfsVersion`: lo que wsl-status no compara): cierra con `state`', async () => {
    writeAll()
    state = { ...goodState(), rootfsSha: sha('otra imagen') }
    expect(await make().gate()).toEqual({ ok: false, reason: 'state' })
  })
  it('`payloadSha` distinto: cierra con `state`', async () => {
    writeAll()
    state = { ...goodState(), payloadSha: sha('otra carga') }
    expect(await make().gate()).toEqual({ ok: false, reason: 'state' })
  })
  it('para preparar la distro (`setup`) NO se exige state.json (aún no existe en la primera instalación)', async () => {
    writeAll()
    state = undefined
    expect(await make().gate('setup')).toEqual({ ok: true })
    expect(await make().gate('run')).toEqual({ ok: false, reason: 'state' })
  })
  it('`setup` sí exige consentimiento, no elevado, pin, paquete y carga', async () => {
    writeAll({ consent: null })
    expect((await make().gate('setup')).reason).toBe('consent')
    rmSync(root, { recursive: true, force: true })
    writeAll({ images: false })
    expect((await make().gate('setup')).reason).toBe('bundle')
    rmSync(root, { recursive: true, force: true })
    writeAll({ pin: false })
    expect((await make().gate('setup')).reason).toBe('pin')
    rmSync(root, { recursive: true, force: true })
    writeAll({ payload: false })
    expect((await make().gate('setup')).reason).toBe('payload')
  })
})

describe('gate(): política de la organización', () => {
  it('`disableWslTasks` cierra el arranque con `policy` (para preparar, la distro informa `policy` por su estado)', async () => {
    writeAll()
    policy = true
    expect(await make().gate()).toEqual({ ok: false, reason: 'policy' })
    expect(await make().gate('setup')).toEqual({ ok: true })
  })
})

describe('gate(): orden de las comprobaciones y robustez', () => {
  it('con varias faltas informa la PRIMERA en este orden: consent, elevated, pin, bundle, payload, state, policy', async () => {
    writeAll({ consent: null, pin: false, images: false, payload: false })
    elevated = true
    policy = true
    state = undefined
    expect((await make().gate()).reason).toBe('consent')
    writeAll({ pin: false, images: false, payload: false })
    expect((await make().gate()).reason).toBe('elevated')
    elevated = false
    expect((await make().gate()).reason).toBe('pin')
    writeAll({ images: false, payload: false })
    expect((await make().gate()).reason).toBe('bundle')
    writeAll({ payload: false })
    expect((await make().gate()).reason).toBe('payload')
    writeAll()
    expect((await make().gate()).reason).toBe('state')
    state = goodState()
    expect((await make().gate()).reason).toBe('policy')
  })
  it('nunca lanza: ante cualquier error es `{ok:false}`', async () => {
    const p = make({ userDataDir: undefined, dirs: { pinJson: '\0', payloadDir: '\0', imagesDir: '\0' } })
    const r = await p.gate()
    expect(r.ok).toBe(false)
  })
  it('no queda `report` ni `windowsReportOk` en el proveedor', () => {
    const p = make() as unknown as Record<string, unknown>
    expect(p.report).toBeUndefined()
  })
})

describe('createWinBackendProvider', () => {
  it('`build` es la constante real (apagada) salvo inyección de prueba', () => {
    const p = createWinBackendProvider({ dirs, fetch: (async () => new Response('')) as never, hostEnv: {} })
    expect(p.build).toBe(false)
    expect(make({ build: true }).build).toBe(true)
  })
  it('create(): sin pin, sin carga o sin LOCALAPPDATA devuelve null', () => {
    expect(make().create()).toBeNull()
    writeAll({ pin: false })
    expect(make().create()).toBeNull()
    writeAll()
    expect(make({ hostEnv: {} }).create()).toBeNull()
  })
  it('create() con todo devuelve el backend de la distro (sin lanzar wsl.exe)', () => {
    writeAll()
    const b = make().create()
    expect(b?.id).toBe('wsl')
    expect(typeof b?.setup).toBe('function')
  })
})
