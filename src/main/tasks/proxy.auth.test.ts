import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { EgressProxy } from './proxy'

/** Autenticación del proxy de salida: el token es el USUARIO de `Basic`; la contraseña no importa (Bun no se conecta con `token@`). */
describe('EgressProxy: Proxy-Authorization', () => {
  let proxy: EgressProxy | null = null
  afterEach(async () => {
    await proxy?.stop()
    proxy = null
  })

  async function connectStatus(auth: string | null): Promise<string> {
    proxy = new EgressProxy({ token: 'tok-secreto', allowlist: () => ['permitido.test'] })
    const port = await proxy.start()
    return await new Promise<string>((resolve, reject) => {
      const s = connect(port, '127.0.0.1')
      let buf = ''
      s.on('data', (d) => {
        buf += d.toString()
        const line = buf.split('\r\n')[0]
        if (line) {
          s.destroy()
          resolve(line)
        }
      })
      s.on('error', reject)
      // Host NO permitido: si la autenticación pasa, responde 403 sin abrir ninguna conexión externa.
      s.write(`CONNECT bloqueado.test:443 HTTP/1.1\r\nHost: bloqueado.test:443\r\n${auth ? `Proxy-Authorization: ${auth}\r\n` : ''}\r\n`)
    })
  }
  const basic = (v: string): string => `Basic ${Buffer.from(v).toString('base64')}`

  it('sin credenciales o con otro usuario → 407', async () => {
    expect(await connectStatus(null)).toContain('407')
    expect(await connectStatus(basic('otro:x'))).toContain('407')
    expect(await connectStatus('Bearer tok-secreto')).toContain('407')
  })

  it('token con contraseña cualquiera o vacía → pasa la autenticación (403 por host no permitido)', async () => {
    expect(await connectStatus(basic('tok-secreto:x'))).toContain('403')
    expect(await connectStatus(basic('tok-secreto:'))).toContain('403')
  })
})
