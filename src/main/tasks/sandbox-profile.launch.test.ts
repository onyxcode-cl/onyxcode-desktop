/**
 * Seatbelt REAL (`sandbox-exec`, sin Electron ni modelos): desde dentro del perfil de Tareas NO se puede lanzar una app FUERA del
 * encierro por LaunchServices (`NSWorkspace.open`, `openApplication`, `LSOpenCFURLRef`), ni con `python3` + `ctypes` (sin compilar),
 * ni con `swift -e`, ni con un binario compilado dentro. Lo cierran `com.apple.coreservices.quarantine-resolver` y
 * `com.apple.runningboard` en `DENIED_MACH` (1.8.16): con solo el primero, RunningBoard dejaba el proceso de la app creado y
 * suspendido fuera del encierro, y un `kill -CONT` desde dentro lo despertaba.
 *
 * La «marca» es un archivo que la app de prueba escribe en `userData/fuera`: el perfil niega escribir ahí, así que si aparece, la
 * app corrió sin encierro. Control: con el perfil de 1.8.15 (sin esas dos líneas) la marca SÍ aparece (en CI solo se registra:
 * puede no haber sesión gráfica). Y lo normal de una tarea sigue funcionando dentro: python3, Node, git en `.lazunox/trabajo`,
 * swift, AppKit dibujando (lo que usan los programas de documentos), textutil y el Python incluido si está.
 * Todo en una carpeta temporal con HOME de prueba; las apps de prueba se quitan de LaunchServices al terminar. Solo macOS.
 *
 * Tampoco se puede registrar un agente de launchd con `SMAppService` (revisión 1 de 1.8.16): una `.app` creada dentro, firmada ad
 * hoc, con `Contents/Library/LaunchAgents/<id>.plist`, llamaba a `registerAndReturnError:` (Python incluido + `ctypes`, o Swift) y
 * el agente corría fuera del encierro y en cada inicio de sesión. Lo cierra `com.apple.xpc.smd` en `DENIED_MACH`. Esta prueba SOLO
 * comprueba que con el perfil actual el registro FALLA: el control sin esa línea registra un agente real en la sesión del usuario y
 * se hizo una vez a mano, no aquí. Aun así, al terminar (también si falla) se desregistra el servicio si quedó, se quita de launchd y
 * de LaunchServices y se borra la app; el identificador es único y reconocible (`cl.lazunox.prueba.smd-<pid>-<azar>`).
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSandboxProfile, DENIED_MACH, sandboxDirs, sandboxEnv } from './sandbox-profile'
import { macOnly } from '../../test/platform'

const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
const HAS_SBX = macOnly && existsSync('/usr/bin/sandbox-exec')
// `/usr/bin/python3`, `swift` y `swiftc` son de las herramientas de línea de órdenes de Xcode; sin ellas, `/usr/bin/python3` abre un
// diálogo de instalación: no se prueba.
const HAS_CLT = HAS_SBX && spawnSync('/usr/bin/xcode-select', ['-p'], { encoding: 'utf8' }).status === 0
const PY_BUNDLED = join(
  process.cwd(),
  'resources',
  'python-bin',
  `mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}`,
  'python',
  'bin',
  'python3'
)
const NEW_MACH = ['com.apple.coreservices.quarantine-resolver', 'com.apple.runningboard', 'com.apple.xpc.smd']
const UID = process.getuid?.() ?? 0

/** `SMAppService` con `ctypes` (sin compilar). argv: <id> [status|un]. Sin modo: registra. */
const SM_PY = `import ctypes, sys
objc = ctypes.cdll.LoadLibrary('/usr/lib/libobjc.A.dylib')
ctypes.cdll.LoadLibrary('/System/Library/Frameworks/ServiceManagement.framework/ServiceManagement')
objc.objc_getClass.restype = ctypes.c_void_p; objc.objc_getClass.argtypes = [ctypes.c_char_p]
objc.sel_registerName.restype = ctypes.c_void_p; objc.sel_registerName.argtypes = [ctypes.c_char_p]
def msg(o, s, *a, at=(), rt=ctypes.c_void_p):
    return ctypes.CFUNCTYPE(rt, ctypes.c_void_p, ctypes.c_void_p, *at)(('objc_msgSend', objc))(o, objc.sel_registerName(s.encode()), *a)
C = lambda n: objc.objc_getClass(n.encode())
name = msg(C('NSString'), 'stringWithUTF8String:', (sys.argv[1] + '.plist').encode(), at=(ctypes.c_char_p,))
svc = msg(C('SMAppService'), 'agentServiceWithPlistName:', name, at=(ctypes.c_void_p,))
op = sys.argv[2] if len(sys.argv) > 2 else ''
if op == 'status': print('status', msg(svc, 'status', rt=ctypes.c_long))
elif op == 'un': print('unregister', msg(svc, 'unregisterAndReturnError:', None, at=(ctypes.c_void_p,), rt=ctypes.c_bool))
else:
    ok = msg(svc, 'registerAndReturnError:', None, at=(ctypes.c_void_p,), rt=ctypes.c_bool)
    print('register', ok, 'status', msg(svc, 'status', rt=ctypes.c_long))
`

/** Lo mismo en Swift (compilado dentro con `swiftc`). */
const SM_SWIFT = `import ServiceManagement
let s = SMAppService.agent(plistName: CommandLine.arguments[1] + ".plist")
switch CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "" {
case "status": print("status", s.status.rawValue)
case "un": do { try s.unregister(); print("unregister true") } catch { print("unregister err", error) }
default: do { try s.register(); print("register OK status", s.status.rawValue) } catch { print("register err", error) }
}
`

/** NSWorkspace / LaunchServices solo con `ctypes` (sin PyObjC ni compilar). */
const WS_PY = `import ctypes, ctypes.util, sys
objc = ctypes.cdll.LoadLibrary(ctypes.util.find_library('objc'))
ctypes.cdll.LoadLibrary('/System/Library/Frameworks/AppKit.framework/AppKit')
cs = ctypes.cdll.LoadLibrary('/System/Library/Frameworks/CoreServices.framework/CoreServices')
V = ctypes.c_void_p
objc.objc_getClass.restype = V; objc.objc_getClass.argtypes = [ctypes.c_char_p]
objc.sel_registerName.restype = V; objc.sel_registerName.argtypes = [ctypes.c_char_p]
addr = ctypes.cast(objc.objc_msgSend, V).value
def send(o, sel, *a, res=V, types=()):
    return ctypes.CFUNCTYPE(res, V, V, *types)(addr)(o, objc.sel_registerName(sel.encode()), *a)
cls = lambda n: objc.objc_getClass(n.encode())
s = send(cls('NSString'), 'stringWithUTF8String:', sys.argv[2].encode(), types=(ctypes.c_char_p,))
url = send(cls('NSURL'), 'fileURLWithPath:', s, types=(V,))
if sys.argv[1] == 'open':
    print('openURL', send(send(cls('NSWorkspace'), 'sharedWorkspace'), 'openURL:', url, res=ctypes.c_bool, types=(V,)))
else:
    cs.LSOpenCFURLRef.restype = ctypes.c_int32; cs.LSOpenCFURLRef.argtypes = [V, V]
    print('LSOpenCFURLRef', cs.LSOpenCFURLRef(url, None))
`

/** Tras un intento fallido, despierta (SIGCONT) los procesos propios con PID cercano: una app creada y suspendida correría. */
const CONT_PY = `import os, signal, subprocess, sys, time
me = os.getpid()
subprocess.run([sys.executable] + sys.argv[1:])
time.sleep(1)
for pid in range(max(2, me - 200), me + 3000):
    try: os.kill(pid, signal.SIGCONT)
    except OSError: pass
`

const OA_SWIFT = `import AppKit
let s = DispatchSemaphore(value: 0)
NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: CommandLine.arguments[1]), configuration: NSWorkspace.OpenConfiguration()) { app, _ in
  print("openApplication", app != nil); s.signal() }
_ = s.wait(timeout: .now() + 20)
`

const DRAW_SWIFT = `import AppKit
let img = NSImage(size: NSSize(width: 120, height: 60))
img.lockFocus()
("Hola" as NSString).draw(at: NSPoint(x: 5, y: 20), withAttributes: [.font: NSFont.systemFont(ofSize: 20)])
img.unlockFocus()
try! NSBitmapImageRep(data: img.tiffRepresentation!)!.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "dibujo.png"))
print("ok-appkit")
`

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!HAS_SBX)('Seatbelt real: ninguna app se lanza fuera del encierro de Tareas', () => {
  let dir: string
  let folder: string
  let work: string
  let fuera: string
  let home: string
  let profile: string
  let oldProfile: string
  let env: Record<string, string>
  const apps: string[] = []

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-lanzar-')))
    folder = join(dir, 'tarea')
    work = join(folder, '.lazunox', 'trabajo')
    home = join(dir, 'home')
    const userData = join(dir, 'ud')
    const privateDir = join(userData, 'tasks-sandbox', 'abc')
    fuera = join(userData, 'fuera')
    const dirs = sandboxDirs(privateDir)
    for (const d of [work, home, fuera, join(userData, 'opencode-config'), dirs.config, dirs.data, dirs.cache, dirs.state, dirs.tmp])
      mkdirSync(d, { recursive: true })
    // Opciones de una tarea normal (las de backends/seatbelt.ts) con HOME de prueba.
    profile = buildSandboxProfile({
      folder,
      privateDir,
      userData,
      readOnly: [join(userData, 'opencode-config')],
      allowedOutboundPorts: [61901, 61902],
      serverPort: 61900,
      allowDelete: false,
      home
    })
    oldProfile = profile
      .split('\n')
      .filter((l) => !NEW_MACH.some((n) => l === `  (global-name "${n}")`))
      .join('\n')
    env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home, LANG: 'en_US.UTF-8', ...sandboxEnv(dirs) }
    writeFileSync(join(dir, 'ws.py'), WS_PY)
    writeFileSync(join(dir, 'cont.py'), CONT_PY)
    writeFileSync(join(work, 'oa.swift'), OA_SWIFT)
    writeFileSync(join(work, 'dibujo.swift'), DRAW_SWIFT)
    writeFileSync(join(dir, 'sm.py'), SM_PY)
    writeFileSync(join(work, 'sm.swift'), SM_SWIFT)
  })

  afterAll(() => {
    killStray()
    for (const a of agents) cleanupAgent(a)
    for (const a of apps) spawnSync(LSREGISTER, ['-u', a])
    rmSync(dir, { recursive: true, force: true })
  })

  const run = (prof: string, cmd: string[], cwd = folder, timeout = 120000) => {
    const r = spawnSync('/usr/bin/sandbox-exec', ['-p', prof, ...cmd], { cwd, env, encoding: 'utf8', timeout })
    return { out: `${r.stdout}${r.stderr}`.trim(), status: r.status }
  }

  /** App mínima en la carpeta de trabajo (como la crearía la tarea): al arrancar escribe `fuera/<nombre>`. */
  const mkApp = (name: string): string => {
    const app = join(work, `${name}.app`)
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
    const exe = join(app, 'Contents', 'MacOS', 'run')
    writeFileSync(exe, `#!/bin/sh\necho "ppid=$PPID" > "${join(fuera, name)}"\n`)
    chmodSync(exe, 0o755)
    writeFileSync(
      join(app, 'Contents', 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>run</string>` +
        `<key>CFBundleIdentifier</key><string>cl.lazunox.prueba.${name}</string><key>CFBundlePackageType</key><string>APPL</string>` +
        `<key>LSBackgroundOnly</key><true/></dict></plist>`
    )
    apps.push(app)
    // Registrada en LaunchServices desde fuera (como lo hacen Spotlight o el Finder con cualquier .app que encuentran): así
    // RunningBoard llega a crear el proceso, que es el caso que cierra `com.apple.runningboard`.
    spawnSync(LSREGISTER, ['-f', app])
    return app
  }

  /** Procesos de las apps de prueba (vivos o suspendidos): se matan por PID y se devuelven. */
  function killStray(): string[] {
    const r = spawnSync('/usr/bin/pgrep', ['-f', `${work}/.*\\.app/Contents/MacOS/run`], { encoding: 'utf8' })
    const pids = (r.stdout ?? '').split('\n').filter(Boolean)
    for (const p of pids) {
      try {
        process.kill(Number(p), 'SIGKILL')
      } catch {
        /* ya terminó */
      }
    }
    return pids
  }

  /** ¿Escribió la app su marca fuera? Espera hasta `ms`. */
  const escaped = async (name: string, ms = 4000): Promise<boolean> => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      if (readdirSync(fuera).includes(name)) return true
      await sleep(250)
    }
    return false
  }

  it('control: desde dentro no se escribe en la carpeta de la marca', () => {
    const r = run(profile, ['/bin/sh', '-c', `echo x > "${join(fuera, 'directo')}"`])
    expect(r.status).not.toBe(0)
    expect(readdirSync(fuera)).not.toContain('directo')
  })

  it('el perfil niega quarantine-resolver, runningboard y xpc.smd (una línea cada uno, en el bloque mach-lookup)', () => {
    for (const n of NEW_MACH) expect(DENIED_MACH).toContain(n)
    const start = profile.indexOf('(deny mach-lookup\n')
    const block = profile.slice(start, profile.indexOf('\n)\n', start))
    for (const n of NEW_MACH) expect(block).toContain(`(global-name "${n}")`)
    expect(oldProfile.split('\n').length).toBe(profile.split('\n').length - NEW_MACH.length)
  })

  it.skipIf(!HAS_CLT)(
    'control: con el perfil de 1.8.15 la app SÍ corría fuera (python3 + ctypes)',
    async () => {
      const app = mkApp('control')
      const r = run(oldProfile, ['/usr/bin/python3', join(dir, 'ws.py'), 'open', app])
      const esc = await escaped('control', 8000)
      killStray()
      // En CI puede no haber sesión gráfica ni LaunchServices: solo se registra.
      if (process.env.CI) console.log(`control 1.8.15: ${r.out} marca=${esc}`)
      else expect(esc, r.out).toBe(true)
    },
    60000
  )

  const attacks: Array<[string, (app: string) => string[], string?]> = [
    ['python3 ctypes NSWorkspace.openURL', (a) => ['/usr/bin/python3', join(dir, 'ws.py'), 'open', a]],
    ['python3 ctypes LSOpenCFURLRef', (a) => ['/usr/bin/python3', join(dir, 'ws.py'), 'ls', a]],
    [
      'python3 ctypes LSOpenCFURLRef + SIGCONT a los procesos cercanos',
      (a) => ['/usr/bin/python3', join(dir, 'cont.py'), join(dir, 'ws.py'), 'ls', a]
    ],
    [
      'swift -e NSWorkspace.open',
      (a) => ['/usr/bin/swift', '-e', `import AppKit; print(NSWorkspace.shared.open(URL(fileURLWithPath: "${a}")))`]
    ],
    [
      'binario compilado dentro (swiftc) con openApplication',
      (a) => ['/bin/sh', '-c', `/usr/bin/swiftc -o oa oa.swift && ./oa "${a}"`],
      'work'
    ]
  ]
  it.skipIf(!HAS_CLT).each(attacks)(
    '%s: la app NO corre fuera ni queda creada',
    async (_label, cmd, cwd) => {
      const name = `a${Math.random().toString(36).slice(2, 8)}`
      const app = mkApp(name)
      const r = run(profile, cmd(app), cwd === 'work' ? work : folder)
      const esc = await escaped(name)
      const stray = killStray()
      expect(esc, `marca fuera; salida: ${r.out}`).toBe(false)
      expect(stray, `procesos de la app creados fuera del encierro; salida: ${r.out}`).toEqual([])
    },
    180000
  )

  // ── SMAppService: registrar un agente de launchd desde una .app creada dentro ──
  interface Agent {
    label: string
    app: string
    exe: string
    /** Orden (fuera del encierro) para consultar o quitar el registro: [...cmd, label, modo]. */
    cmd: string[]
    env?: Record<string, string>
  }
  const agents: Agent[] = []
  const launchctl = (...args: string[]): string => {
    const r = spawnSync('/bin/launchctl', args, { encoding: 'utf8' })
    return `${r.stdout ?? ''}${r.stderr ?? ''}`
  }
  const inLaunchd = (label: string): boolean =>
    launchctl('list')
      .split('\n')
      .some((l) => l.split('\t')[2] === label)
  const inDisabled = (label: string): boolean => launchctl('print-disabled', `gui/${UID}`).includes(`"${label}"`)

  /** App con `Contents/Library/LaunchAgents/<label>.plist`: el agente escribe `fuera/<label>` al cargarse. */
  const mkAgentApp = (label: string, exeName: string): string => {
    const app = join(work, `${label}.app`)
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
    mkdirSync(join(app, 'Contents', 'Library', 'LaunchAgents'), { recursive: true })
    writeFileSync(
      join(app, 'Contents', 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>${exeName}</string>` +
        `<key>CFBundleIdentifier</key><string>${label}.app</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`
    )
    writeFileSync(
      join(app, 'Contents', 'Library', 'LaunchAgents', `${label}.plist`),
      `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>${label}</string>` +
        `<key>ProgramArguments</key><array><string>/usr/bin/touch</string><string>${join(fuera, label)}</string></array>` +
        `<key>RunAtLoad</key><true/></dict></plist>`
    )
    return app
  }

  /** Deshace TODO lo que el intento pudo dejar en el sistema: registro, trabajo de launchd, LaunchServices y la app. */
  function cleanupAgent(a: Agent): void {
    if (existsSync(a.exe)) {
      const st = spawnSync(a.cmd[0], [...a.cmd.slice(1), a.label, 'status'], { env: a.env, encoding: 'utf8', timeout: 30000 })
      // status: 0 sin registrar, 1 activo, 2 pendiente de aprobación, 3 no encontrado.
      if (/status [12]\b/.test(st.stdout ?? '') || inLaunchd(a.label))
        spawnSync(a.cmd[0], [...a.cmd.slice(1), a.label, 'un'], { env: a.env, encoding: 'utf8', timeout: 30000 })
    }
    if (inLaunchd(a.label)) {
      launchctl('bootout', `gui/${UID}/${a.label}`)
      launchctl('remove', a.label)
    }
    spawnSync(LSREGISTER, ['-u', a.app])
    rmSync(a.app, { recursive: true, force: true })
  }

  const PY_HOME = existsSync(PY_BUNDLED) ? dirname(dirname(realpathSync(PY_BUNDLED))) : ''
  const smAttacks: Array<[string, boolean, (label: string) => Agent & { inside: string }]> = [
    [
      'Python incluido + ctypes (sin compilador)',
      !!PY_HOME,
      (label) => {
        const app = mkAgentApp(label, 'sm')
        const exe = join(app, 'Contents', 'MacOS', 'sm')
        copyFileSync(realpathSync(PY_BUNDLED), exe)
        chmodSync(exe, 0o755)
        const env = { PATH: '/usr/bin:/bin', PYTHONHOME: PY_HOME }
        const py = `PYTHONHOME="${PY_HOME}" "${exe}" "${join(dir, 'sm.py')}"`
        return { label, app, exe, env, cmd: [exe, join(dir, 'sm.py')], inside: `/usr/bin/codesign -s - --force "${app}" && ${py} ${label}` }
      }
    ],
    [
      'binario Swift compilado dentro (swiftc)',
      HAS_CLT,
      (label) => {
        const app = mkAgentApp(label, 'sm')
        const exe = join(app, 'Contents', 'MacOS', 'sm')
        return {
          label,
          app,
          exe,
          cmd: [exe],
          inside: `/usr/bin/swiftc -o "${exe}" sm.swift && /usr/bin/codesign -s - --force "${app}" && "${exe}" ${label}`
        }
      }
    ]
  ]
  for (const [title, available, make] of smAttacks) {
    it.skipIf(!available)(
      `SMAppService (${title}): el registro FALLA, el agente no corre fuera y launchd no lo conserva`,
      async () => {
        const label = `cl.lazunox.prueba.smd-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
        const a = make(label)
        agents.push(a)
        try {
          const r = run(profile, ['/bin/sh', '-c', a.inside], work)
          // Llegó a llamar al registro (la app se armó y firmó dentro) y el registro falló.
          expect(r.out, r.out).toMatch(/register (False|err)/)
          expect(r.out, r.out).not.toMatch(/register (True|OK)/)
          expect(await escaped(label, 6000), `marca fuera; salida: ${r.out}`).toBe(false)
          expect(inLaunchd(label), `trabajo en launchctl list; salida: ${r.out}`).toBe(false)
        } finally {
          cleanupAgent(a)
        }
        expect(inLaunchd(label)).toBe(false)
        expect(inDisabled(label), 'marca residual en print-disabled').toBe(false)
        expect(existsSync(a.app)).toBe(false)
      },
      240000
    )
  }

  describe('lo normal de una tarea sigue funcionando dentro del perfil', () => {
    it('Node (el mismo de las pruebas) lee y escribe en la carpeta', () => {
      const r = run(profile, [
        process.execPath,
        '-e',
        'const fs=require("fs");fs.writeFileSync("n.txt","hola");console.log("ok",fs.readFileSync("n.txt","utf8"))'
      ])
      expect(r.out).toContain('ok hola')
    })

    it('git en .lazunox/trabajo: init, add, commit y log', () => {
      const sh = 'git init -q r && cd r && echo x > f && git add f && git commit -qm uno && git log --oneline'
      const r = run(profile, ['/bin/sh', '-c', sh], work)
      expect(r.status, r.out).toBe(0)
      expect(r.out).toContain('uno')
    })

    it('textutil convierte un documento en la carpeta', () => {
      const r = run(
        profile,
        ['/bin/sh', '-c', 'echo hola > t.txt && /usr/bin/textutil -convert html t.txt -output t.html && echo ok'],
        work
      )
      expect(r.out, r.out).toContain('ok')
      expect(existsSync(join(work, 't.html'))).toBe(true)
    })

    it.skipIf(!HAS_CLT)('python3 del sistema', () => {
      const r = run(profile, ['/usr/bin/python3', '-c', 'import json, sqlite3, ssl; print("ok", 6*7)'])
      expect(r.out).toContain('ok 42')
    })

    it.skipIf(!HAS_CLT)(
      'swift con AppKit dibuja y guarda un PNG (como los programas que pintan páginas)',
      () => {
        const r = run(profile, ['/usr/bin/swift', 'dibujo.swift'], work)
        expect(r.out, r.out).toContain('ok-appkit')
        expect(existsSync(join(work, 'dibujo.png'))).toBe(true)
      },
      180000
    )

    it.skipIf(!existsSync(PY_BUNDLED))('el Python incluido arranca con sus bibliotecas de documentos', () => {
      const r = run(profile, [PY_BUNDLED, '-c', 'import docx, openpyxl, pptx, pypdf, lxml, PIL; print("ok-libs")'])
      expect(r.out).toContain('ok-libs')
    })
  })
})
