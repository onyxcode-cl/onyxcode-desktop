/**
 * Seatbelt REAL (`sandbox-exec`, sin Electron ni modelos), F8-B208: dentro del perfil de Tareas el proceso del servidor puede
 * CONECTARSE a su propio puerto (`serverPort`) y a ningún otro puerto local que no esté en la lista.
 *
 * Por qué: en el motor 1.19 el cliente interno que reciben los plugins (`client.session.get`, `client.app.agents`) habla con el
 * servidor por HTTP a `127.0.0.1:<puerto propio>`. Antes el perfil solo permitía bind+inbound en ese puerto, el kernel denegaba
 * la salida (`deny(1) network-outbound remote:*:<puerto>` en el registro del sistema) y `lazunox-subagent-guard` fallaba
 * cerrado con «sesión desconocida» en todo `task` de Overdrive (prueba real con OpenCode Go, 2026-10-22). Solo macOS.
 */
import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:net'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSandboxProfile } from './sandbox-profile'
import { macOnly } from '../../test/platform'

// Dentro del sandbox: escucha en `self` y prueba a conectarse a `self` (propio) y a `other` (un puerto local ajeno que escucha fuera).
const NODE_PROBE = `
const http = require('node:http')
const [self, other] = process.argv.slice(1).map(Number)
const tryGet = (p) => fetch('http://127.0.0.1:' + p + '/x').then((r) => 'ok:' + r.status, (e) => 'fail:' + ((e.cause && e.cause.code) || e.message))
const srv = http.createServer((q, r) => r.end('ok')).listen(self, '127.0.0.1', async () => {
  console.log('self=' + (await tryGet(self)) + ' other=' + (await tryGet(other)))
  srv.close()
})
`

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const a = s.address()
      s.close(() => (a && typeof a === 'object' ? resolve(a.port) : reject(new Error('sin puerto'))))
    })
  })

describe.skipIf(!macOnly)('Seatbelt real: salida al puerto propio del servidor', () => {
  let dir: string
  let outside: Server
  let otherPort: number

  beforeAll(async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-selfport-')))
    // Un servicio local AJENO escuchando fuera del sandbox: el sandbox no debe poder hablarle.
    outside = createServer((s) => s.end('HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok'))
    await new Promise<void>((r) => outside.listen(0, '127.0.0.1', () => r()))
    otherPort = (outside.address() as { port: number }).port
  })
  afterAll(() => {
    outside?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  // Asíncrono a propósito: el servicio ajeno escucha en ESTE proceso y debe poder responder mientras tanto.
  const run = (profile: string | null, self: number): Promise<string> => {
    const cmd = [process.execPath, '-e', NODE_PROBE, String(self), String(otherPort)]
    const argv = profile ? ['/usr/bin/sandbox-exec', '-p', profile, ...cmd] : cmd
    return new Promise((resolve) => {
      execFile(argv[0]!, argv.slice(1), { encoding: 'utf8', timeout: 20000 }, (_err, stdout, stderr) =>
        resolve(`${stdout}${stderr}`.trim())
      )
    })
  }
  const profileFor = (serverPort?: number): string =>
    buildSandboxProfile({
      folder: join(dir, 'f'),
      privateDir: join(dir, 'p'),
      home: join(dir, 'home'),
      allowedOutboundPorts: [],
      serverPort
    })

  it('control: sin sandbox se alcanzan ambos (la prueba detecta el bloqueo)', async () => {
    expect(await run(null, await freePort())).toBe('self=ok:200 other=ok:200')
  })

  it('con serverPort: el propio puerto SÍ, otro puerto local que escucha NO', async () => {
    const self = await freePort()
    expect(await run(profileFor(self), self)).toBe('self=ok:200 other=fail:EPERM')
  })

  it('sin serverPort (el comportamiento anterior en la salida): ni el propio ni el ajeno', async () => {
    const self = await freePort()
    // bind/inbound tampoco se conceden: listen falla o la conexión falla; en ningún caso hay "ok".
    expect(await run(profileFor(undefined), self)).not.toContain('ok:200')
  })
})
