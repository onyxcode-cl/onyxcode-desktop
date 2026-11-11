/**
 * Seatbelt REAL (`sandbox-exec`, sin Electron ni modelos), 1.8.16: el perfil de Tareas NO existe como archivo, así que un proceso
 * encerrado no puede cambiarlo antes del siguiente lanzamiento.
 *
 * Hasta 1.8.15 cada lanzamiento escribía `<temporal del sistema>/lazunox-tasks/profile-<hex>.sb` y `sandbox-exec -f` lo leía; esa
 * carpeta es escribible desde dentro del encierro y un «vigilante» dentro de una tarea reemplazaba cada perfil nuevo por
 * `(allow default)`: 20 de 20 lanzamientos quedaban sin encierro. Ahora `seatbeltBackend.launch` pasa el texto con `-p`.
 *
 * Aquí: el vigilante corre DENTRO del perfil de una tarea; control: SÍ puede reemplazar un perfil puesto en la carpeta antigua
 * (la premisa del ataque sigue en pie); 20 lanzamientos REALES con `seatbeltBackend.launch` mientras vigila: 0 sin encierro, y
 * ningún archivo de perfil aparece. El lanzamiento normal sigue funcionando. Y la limpieza de los perfiles viejos solo borra
 * `profile-<12 hex>.sb`, en una carpeta real (no sigue enlaces). Solo macOS.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { macOnly } from '../../../test/platform'

// Sin Electron: el lanzador «disclaim» se sustituye por el lanzamiento directo y la caché de modelos no se toca.
vi.mock('../../process/disclaim', () => ({ withDisclaim: (command: string, args: string[]) => ({ command, args, disclaimed: false }) }))
vi.mock('../models-cache', () => ({ seedConfigModels: () => null }))

import { buildSandboxProfile, sandboxDirs } from '../sandbox-profile'
import { cleanLegacyProfiles, LEGACY_PROFILE_DIR, seatbeltBackend } from './seatbelt'

const HAS_SBX = macOnly && existsSync('/usr/bin/sandbox-exec')

/** Vigilante: `watch.py <marca> <carpetas…>` reemplaza por `(allow default)` cada `.sb` con la marca que aparezca en las carpetas. */
const WATCH_PY = `import os, sys, time
marca = sys.argv[1]; dirs = sys.argv[2:]
open('listo', 'w').write('1')  # en su propia carpeta: ya vigila
while True:
    for d in dirs:
        try: names = os.listdir(d)
        except OSError: continue
        for f in names:
            if not f.endswith('.sb'): continue
            p = os.path.join(d, f)
            try:
                if marca not in open(p).read(): continue
                open(p + '.x', 'w').write('(version 1)\\n(allow default)\\n'); os.rename(p + '.x', p)
            except Exception: pass
    time.sleep(0.001)
`

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!HAS_SBX)('Seatbelt real: el perfil de Tareas no se puede cambiar desde dentro', () => {
  let dir: string
  let folder: string
  let userData: string
  let fuera: string
  let watcher: ChildProcess | null = null
  const iso = (): { privateDir: string; userData: string } => ({ privateDir: join(userData, 'tasks-sandbox', 'abc'), userData })

  beforeAll(async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-perfil-')))
    folder = join(dir, 'tarea')
    userData = join(dir, 'ud')
    fuera = join(userData, 'fuera') // el perfil niega escribir en userData: si aparece una marca aquí, corrió sin encierro
    const dirs = sandboxDirs(iso().privateDir)
    for (const d of [
      folder,
      fuera,
      join(dir, 'home'),
      join(userData, 'opencode-config'),
      dirs.config,
      dirs.data,
      dirs.cache,
      dirs.state,
      dirs.tmp
    ])
      mkdirSync(d, { recursive: true })
    writeFileSync(join(dir, 'watch.py'), WATCH_PY)
    // El vigilante corre dentro del perfil de OTRA tarea (misma app, mismo usuario), vigilando la carpeta antigua y el temporal.
    const wFolder = join(dir, 'otra')
    const wPriv = join(userData, 'tasks-sandbox', 'otra')
    mkdirSync(wFolder, { recursive: true })
    mkdirSync(join(wPriv, 'tmp'), { recursive: true })
    const wProfile = buildSandboxProfile({ folder: wFolder, privateDir: wPriv, userData, home: join(dir, 'home') })
    watcher = spawn(
      '/usr/bin/sandbox-exec',
      ['-p', wProfile, '/usr/bin/python3', join(dir, 'watch.py'), dir, dir, LEGACY_PROFILE_DIR, realpathSync(tmpdir())],
      {
        cwd: wFolder,
        env: { PATH: '/usr/bin:/bin', HOME: join(dir, 'home'), TMPDIR: join(wPriv, 'tmp') },
        stdio: 'ignore'
      }
    )
    // Esperar a que el vigilante esté de verdad vigilando (python3 puede tardar en arrancar con la máquina cargada).
    const ready = join(wFolder, 'listo')
    for (let i = 0; i < 600 && !existsSync(ready); i++) await sleep(100)
    if (!existsSync(ready)) throw new Error('el vigilante no arrancó')
  }, 90000)

  afterAll(() => {
    watcher?.kill('SIGKILL')
    rmSync(dir, { recursive: true, force: true })
    cleanLegacyProfiles()
  })

  const launch = async (serveArgs: string[]): Promise<ChildProcess> => {
    const l = await seatbeltBackend.launch({
      folder,
      bin: '/bin/sh',
      serveArgs,
      serverPort: 61900,
      isolation: iso(),
      configDir: join(userData, 'opencode-config'),
      allowDelete: false,
      outboundPorts: [],
      baseEnv: { PATH: '/usr/bin:/bin', HOME: join(dir, 'home') },
      proxyEnv: {}
    })
    await new Promise((r) => (l.child.exitCode !== null ? r(null) : l.child.once('exit', r)))
    await l.dispose()
    return l.child
  }

  it.skipIf(!existsSync('/usr/bin/python3') || spawnSync('/usr/bin/xcode-select', ['-p']).status !== 0)(
    'control: el vigilante encerrado SÍ reemplaza un perfil puesto en el temporal del sistema (la premisa del ataque)',
    async () => {
      // En la carpeta de esta prueba (dentro del temporal del sistema, igual que la antigua `lazunox-tasks`) y no en la antigua:
      // otras pruebas que lanzan el backend en paralelo limpian la antigua.
      const decoy = join(dir, 'profile-0123456789ab.sb')
      writeFileSync(decoy, `(version 1)\n;; ${dir}\n(deny default)\n`)
      let replaced = false
      for (let i = 0; i < 200 && !replaced; i++) {
        await sleep(100)
        replaced = readFileSync(decoy, 'utf8').includes('(allow default)')
      }
      rmSync(decoy, { force: true })
      expect(replaced).toBe(true)
    },
    30000
  )

  it('20 lanzamientos reales con el vigilante activo: ninguno queda sin encierro y no se escribe ningún perfil', async () => {
    let escaped = 0
    const modes = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const mark = join(fuera, `RACE_${i}`)
      const child = await launch(['-c', `echo x > "${mark}" 2>/dev/null; true`])
      modes.add(child.spawnargs.slice(0, 2).join(' '))
      if (existsSync(mark)) escaped++
    }
    expect(escaped, 'lanzamientos que corrieron sin encierro').toBe(0)
    expect([...modes]).toEqual(['/usr/bin/sandbox-exec -p'])
    const left = existsSync(LEGACY_PROFILE_DIR) ? readdirSync(LEGACY_PROFILE_DIR).filter((n) => n.endsWith('.sb')) : []
    expect(left).toEqual([])
  }, 120000)

  it('el lanzamiento normal funciona: escribe en la carpeta de la tarea y no fuera', async () => {
    await launch(['-c', `echo ok > ok.txt; echo x > "${join(fuera, 'normal')}" 2>/dev/null; true`])
    expect(readFileSync(join(folder, 'ok.txt'), 'utf8').trim()).toBe('ok')
    expect(existsSync(join(fuera, 'normal'))).toBe(false)
  }, 30000)
})

describe('cleanLegacyProfiles: borra solo los perfiles viejos y nunca sigue un enlace', () => {
  let root: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'lazunox-limpieza-'))
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('borra profile-<12 hex>.sb, deja lo demás y la carpeta si no queda vacía', () => {
    const d = join(root, 'a')
    mkdirSync(d)
    for (const n of ['profile-0123456789ab.sb', 'profile-ffffffffffff.sb', 'otro.txt', 'profile-xyz.sb']) writeFileSync(join(d, n), 'x')
    expect(cleanLegacyProfiles(d)).toBe(2)
    expect(readdirSync(d).sort()).toEqual(['otro.txt', 'profile-xyz.sb'])
  })

  it('carpeta que queda vacía: se borra; carpeta inexistente: no pasa nada', () => {
    const d = join(root, 'b')
    mkdirSync(d)
    writeFileSync(join(d, 'profile-0123456789ab.sb'), 'x')
    expect(cleanLegacyProfiles(d)).toBe(1)
    expect(existsSync(d)).toBe(false)
    expect(cleanLegacyProfiles(join(root, 'no-existe'))).toBe(0)
  })

  it.skipIf(!macOnly)('si la carpeta es un enlace simbólico (alguien de dentro la cambió), no toca el destino', () => {
    const target = join(root, 'destino')
    mkdirSync(target)
    writeFileSync(join(target, 'profile-0123456789ab.sb'), 'x')
    const link = join(root, 'enlace')
    symlinkSync(target, link)
    expect(cleanLegacyProfiles(link)).toBe(0)
    expect(existsSync(join(target, 'profile-0123456789ab.sb'))).toBe(true)
  })
})
