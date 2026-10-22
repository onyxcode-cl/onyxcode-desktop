/**
 * Seatbelt REAL (`sandbox-exec`, sin Electron ni modelos), F8-B208: el canal del guardián de subagentes no abre la API
 * del motor al sandbox.
 *
 * Montaje: un motor simulado con autenticación Basic (fuera del sandbox, en el puerto `serverPort` del perfil, como el
 * `opencode serve` real), el `McpProxy` real con el canal (`createGuardInfoHandler`) y una «víctima» sandboxeada que
 * lleva en su entorno la contraseña del motor y el token del canal (como el `opencode serve` de una tarea). Desde OTRO
 * proceso con el mismo perfil (el caso de un `bash` del agente):
 *  (a) la contraseña y el token SÍ se leen por `sysctl(KERN_PROCARGS2)` (límite conocido, no cerrable con Seatbelt);
 *  (b) aun así el puerto del MOTOR es inalcanzable (EPERM / sin conexión): no hay crear, aprobar ni configurar;
 *  (c) el canal responde SOLO metadatos de la sesión y la lista de agentes; POST/PATCH, otras rutas o sin token, no;
 *  (d) el motor solo recibió peticiones GET de main.
 * Solo macOS.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSandboxProfile } from './sandbox-profile'
import { McpProxy } from './mcp-proxy'
import { createGuardInfoHandler, GUARD_PATH_PREFIX } from './guard-info'
import { macOnly } from '../../test/platform'

const PW = 'PRUEBA-pw-del-motor-1234'
const ROOT = 'ses_rootAAAAAAAAAAAAAAAA'

// Lee el entorno de otro proceso por KERN_PROCARGS2 y extrae una variable.
const PY_ENV = `
import ctypes, sys, re
l = ctypes.CDLL(None)
m = (ctypes.c_int*3)(1, 49, int(sys.argv[1])); n = ctypes.c_size_t(1<<20); b = ctypes.create_string_buffer(n.value)
l.sysctl(m, 3, b, ctypes.byref(n), None, 0)
x = re.search(sys.argv[2].encode() + rb"=([^\\x00]*)", b.raw[:n.value]); print(x.group(1).decode() if x else "")
`

const ATTACK = `#!/bin/bash
VICTIM=$1; ENGINE=$2; CH=$3; PY=$4
PW=$(/usr/bin/python3 "$PY" $VICTIM OPENCODE_SERVER_PASSWORD)
TOKEN=$(/usr/bin/python3 "$PY" $VICTIM LAZUNOX_GUARD_TOKEN)
echo "pw_leida=$([ -n "$PW" ] && echo si || echo no)"
echo "token_leido=$([ -n "$TOKEN" ] && echo si || echo no)"
c() { /usr/bin/curl -s -m 4 -o /tmp/lzx-guard-body.$$ -w '%{http_code}' "$@"; echo " exit=$?"; }
echo "motor_get=$(c -u tasks:$PW http://127.0.0.1:$ENGINE/session)"
echo "motor_crear=$(c -u tasks:$PW -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:$ENGINE/session)"
echo "motor_aprobar=$(c -u tasks:$PW -X POST -d '{"reply":"always"}' http://127.0.0.1:$ENGINE/permission/per_x/reply)"
echo "motor_config=$(c -u tasks:$PW -X PATCH -d '{}' http://127.0.0.1:$ENGINE/config)"
echo "canal_sesion=$(c -H "authorization: Bearer $TOKEN" "$CH/session?id=${ROOT}")"
echo "canal_sesion_cuerpo=$(cat /tmp/lzx-guard-body.$$)"
echo "canal_agentes=$(c -H "authorization: Bearer $TOKEN" "$CH/agents")"
echo "canal_post=$(c -H "authorization: Bearer $TOKEN" -X POST -d '{}' "$CH/session")"
echo "canal_patch=$(c -H "authorization: Bearer $TOKEN" -X PATCH -d '{}' "$CH/config")"
echo "canal_aprobar=$(c -H "authorization: Bearer $TOKEN" "$CH/permission")"
echo "canal_sin_token=$(c "$CH/session?id=${ROOT}")"
rm -f /tmp/lzx-guard-body.$$
`.replace(/\$\{ROOT\}/g, ROOT)

describe.skipIf(!macOnly)('Seatbelt real: el canal del guardián no abre la API del motor', () => {
  let dir: string
  let engine: Server
  let enginePort: number
  const seen: Array<{ method: string; url: string; auth: boolean }> = []
  let proxy: McpProxy
  let channel: { url: string; token: string }
  let victim: ChildProcess
  let profile: string
  let out = ''

  beforeAll(async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-guardch-')))
    const basic = `Basic ${Buffer.from(`tasks:${PW}`).toString('base64')}`
    engine = createServer((req: IncomingMessage, res) => {
      const auth = req.headers.authorization === basic
      seen.push({ method: req.method ?? '', url: req.url ?? '', auth })
      if (!auth) return void res.writeHead(401).end()
      const path = new URL(req.url ?? '/', 'http://x').pathname
      const send = (v: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v))
      if (req.method === 'GET' && path === `/session/${ROOT}`) return send({ id: ROOT, agent: 'tasks', title: 'TITULO', permission: [] })
      if (req.method === 'GET' && path === `/session/${ROOT}/message`)
        return send([{ info: { role: 'user', agent: 'tasks' }, parts: [{ text: 'SECRETO' }] }])
      if (req.method === 'GET' && path === '/agent') return send([{ name: 'tasks', prompt: 'PROMPT', permission: [] }])
      return send({ hecho: true }) // cualquier otra cosa «funcionaría» si llegara
    })
    await new Promise<void>((r) => engine.listen(0, '127.0.0.1', () => r()))
    enginePort = (engine.address() as { port: number }).port
    proxy = new McpProxy()
    await proxy.start()
    channel = proxy.setLocalHandler(
      GUARD_PATH_PREFIX,
      createGuardInfoHandler({ server: () => ({ baseUrl: `http://127.0.0.1:${enginePort}`, authorization: basic, directory: dir }) })
    )
    profile = buildSandboxProfile({
      folder: join(dir, 'f'),
      privateDir: join(dir, 'p'),
      home: join(dir, 'home'),
      allowedOutboundPorts: [proxy.port],
      serverPort: enginePort
    })
    const pf = join(dir, 'p.sb')
    writeFileSync(pf, profile)
    victim = spawn('/usr/bin/sandbox-exec', ['-f', pf, process.execPath, '-e', 'setTimeout(()=>{},120000)'], {
      stdio: 'ignore',
      env: { PATH: '/usr/bin:/bin', OPENCODE_SERVER_PASSWORD: PW, LAZUNOX_GUARD_TOKEN: channel.token, LAZUNOX_GUARD_URL: channel.url }
    })
    await new Promise((r) => setTimeout(r, 400))
    const py = join(dir, 'env.py')
    const sh = join(dir, 'attack.sh')
    writeFileSync(py, PY_ENV)
    writeFileSync(sh, ATTACK)
    out = await new Promise<string>((resolve) => {
      execFile(
        '/usr/bin/sandbox-exec',
        ['-f', pf, '/bin/bash', sh, String(victim.pid), String(enginePort), channel.url, py],
        { encoding: 'utf8', timeout: 60000 },
        (_e, stdout, stderr) => resolve(`${stdout}${stderr}`)
      )
    })
  }, 90000)
  afterAll(async () => {
    if (victim?.pid) victim.kill('SIGKILL')
    await proxy?.stop()
    engine?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const val = (k: string): string => (new RegExp(`^${k}=(.*)$`, 'm').exec(out)?.[1] ?? '').trim()

  it('(a) la contraseña del motor y el token del canal SON legibles por KERN_PROCARGS2 (límite conocido)', () => {
    expect(val('pw_leida')).toBe('si')
    expect(val('token_leido')).toBe('si')
  })

  it('(b) con la contraseña, el puerto del MOTOR sigue inalcanzable: ni leer, ni crear, ni aprobar, ni configurar', () => {
    for (const k of ['motor_get', 'motor_crear', 'motor_aprobar', 'motor_config']) {
      expect(val(k), k).toMatch(/^000 exit=(7|28)$/)
    }
  })

  it('(c) el canal da solo metadatos; escribir, otras rutas o sin token: no', () => {
    expect(val('canal_sesion')).toBe('200 exit=0')
    expect(JSON.parse(val('canal_sesion_cuerpo'))).toEqual({ id: ROOT, agent: 'tasks', permission: [] })
    expect(val('canal_agentes')).toBe('200 exit=0')
    expect(val('canal_post')).toBe('405 exit=0')
    expect(val('canal_patch')).toBe('405 exit=0')
    expect(val('canal_aprobar')).toBe('404 exit=0')
    expect(val('canal_sin_token')).toBe('401 exit=0')
  })

  it('(d) el motor solo recibió GET autenticados de main (sesión, mensajes, agentes)', () => {
    expect(seen.length).toBeGreaterThan(0)
    for (const s of seen) {
      expect(s.method).toBe('GET')
      expect(s.auth).toBe(true)
      expect(s.url).toMatch(/^\/(session\/ses_[A-Za-z0-9]+(\/message)?|agent)\?directory=/)
    }
  })
})
