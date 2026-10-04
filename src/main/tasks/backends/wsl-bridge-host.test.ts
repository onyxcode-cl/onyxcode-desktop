import { Duplex, PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  FrameDecoder,
  FrameType,
  INITIAL_WINDOW,
  decodeError,
  decodePort,
  encodeError,
  encodeExit,
  encodeFrame,
  encodePort,
  encodeWindow,
  type Frame
} from './bridge-protocol'
import { WslBridgeHost, type BridgeListener } from './wsl-bridge-host'

/** Socket doble: lo que se escribe queda en `received`; `push()` simula datos que llegan del otro extremo. */
class FakeSocket extends Duplex {
  received: Buffer[] = []
  ended = false
  _read(): void {}
  _write(chunk: Buffer, _enc: BufferEncoding, cb: () => void): void {
    this.received.push(Buffer.from(chunk))
    cb()
  }
  _final(cb: () => void): void {
    this.ended = true
    cb()
  }
  push2(b: Buffer | string): void {
    this.push(Buffer.from(b))
  }
  text(): string {
    return Buffer.concat(this.received).toString()
  }
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await tick()
}

function setup(over: { allowed?: number[]; connect?: (p: number) => Promise<Duplex> } = {}) {
  const wslOut = new PassThrough() // stdout de wsl.exe: tramas del agente
  const wslIn = new PassThrough() // stdin de wsl.exe: tramas hacia el agente
  const dec = new FrameDecoder()
  const fromHost: Frame[] = []
  wslIn.on('data', (c: Buffer) => fromHost.push(...dec.push(c)))
  const sockets = new Map<number, FakeSocket>()
  const connects: number[] = []
  let onConn: ((s: Duplex) => void) | null = null
  const listens: number[] = []
  let listenerClosed = false
  const rejected: number[] = []
  const host = new WslBridgeHost({
    input: wslOut,
    output: wslIn,
    initFrame: encodeFrame({ id: 0, type: FrameType.INIT, data: Buffer.from('{"v":1}') }),
    allowedPorts: over.allowed ?? [52000, 52001],
    serverPort: 51000,
    connect:
      over.connect ??
      (async (port) => {
        connects.push(port)
        const s = new FakeSocket()
        sockets.set(port, s)
        return s
      }),
    listen: async (port, cb): Promise<BridgeListener> => {
      listens.push(port)
      onConn = cb
      return {
        close: async () => {
          listenerClosed = true
        }
      }
    },
    onReject: (i) => rejected.push(i.port)
  })
  const agent = (id: number, type: number, data?: Buffer): void => void wslOut.write(encodeFrame({ id, type, data }))
  return {
    host,
    agent,
    wslOut,
    wslIn,
    fromHost,
    sockets,
    connects,
    listens,
    rejected,
    inbound: (s: Duplex) => onConn!(s),
    listenerClosed: () => listenerClosed
  }
}

describe('WslBridgeHost', () => {
  it('start: escribe INIT primero y escucha en el puerto del servidor', async () => {
    const t = setup()
    await t.host.start()
    await flush()
    expect(t.fromHost[0]).toMatchObject({ id: 0, type: FrameType.INIT })
    expect(t.listens).toEqual([51000])
  })

  it('flujo «out» a un puerto permitido (egress y credenciales): conecta a 127.0.0.1:<puerto> y reenvía en ambos sentidos', async () => {
    const t = setup()
    await t.host.start()
    t.agent(2, FrameType.OPEN, encodePort(52000))
    t.agent(4, FrameType.OPEN, encodePort(52001))
    await flush()
    expect(t.connects).toEqual([52000, 52001])
    t.agent(2, FrameType.DATA, Buffer.from('CONNECT opencode.ai:443'))
    await flush()
    expect(t.sockets.get(52000)!.text()).toBe('CONNECT opencode.ai:443')
    expect(t.sockets.get(52001)!.text()).toBe('')
    // crédito devuelto al agente tras escribir
    expect(t.fromHost.some((f) => f.id === 2 && f.type === FrameType.WINDOW)).toBe(true)
    t.sockets.get(52000)!.push2('HTTP/1.1 200')
    await flush()
    const data = t.fromHost.find((f) => f.id === 2 && f.type === FrameType.DATA)!
    expect(data.data.toString()).toBe('HTTP/1.1 200')
  })

  it('datos que llegan antes de que conecte el socket se conservan en orden', async () => {
    let release!: (s: Duplex) => void
    const t = setup({ connect: () => new Promise<Duplex>((r) => (release = r)) })
    await t.host.start()
    t.agent(2, FrameType.OPEN, encodePort(52000))
    t.agent(2, FrameType.DATA, Buffer.from('uno'))
    t.agent(2, FrameType.DATA, Buffer.from('dos'))
    await flush()
    const s = new FakeSocket()
    release(s)
    await flush()
    expect(s.text()).toBe('unodos')
  })

  it('cualquier otro puerto se rechaza, se registra y NO se conecta (puertos del sidecar, SSH, 80…)', async () => {
    const t = setup()
    await t.host.start()
    for (const p of [1, 22, 80, 443, 3000, 4096, 51000, 52002, 65535]) t.agent(2 * (p % 100) + 2, FrameType.OPEN, encodePort(p))
    await flush()
    expect(t.connects).toEqual([])
    expect(t.rejected).toEqual([1, 22, 80, 443, 3000, 4096, 51000, 52002, 65535])
    expect(t.host.rejected.map((r) => r.port)).toEqual(t.rejected)
    const errors = t.fromHost.filter((f) => f.type === FrameType.ERROR).map((f) => decodeError(f.data).code)
    expect(errors).toEqual(Array(9).fill('port_denied'))
    expect(t.fromHost.filter((f) => f.type === FrameType.CLOSE)).toHaveLength(9)
    expect(t.host.streamCount).toBe(0)
  })

  it('el agente no puede abrir con un id impar (de main): corta la sesión', async () => {
    const t = setup()
    await t.host.start()
    t.agent(1, FrameType.OPEN, encodePort(52000))
    await flush()
    expect(await t.host.exited).toBeNull()
    expect(t.connects).toEqual([])
  })

  it('flujo «in»: una conexión a 127.0.0.1:P abre un flujo impar hacia el puerto del servidor y vuelve la respuesta', async () => {
    const t = setup()
    await t.host.start()
    const client = new FakeSocket()
    t.inbound(client)
    await flush()
    const open = t.fromHost.find((f) => f.type === FrameType.OPEN)!
    expect(open.id % 2).toBe(1)
    expect(decodePort(open.data)).toBe(51000)
    client.push2('GET /global/health')
    await flush()
    expect(t.fromHost.find((f) => f.type === FrameType.DATA)!.data.toString()).toBe('GET /global/health')
    t.agent(open.id, FrameType.DATA, Buffer.from('200 OK'))
    await flush()
    expect(client.text()).toBe('200 OK')
    // el cliente cierra: CLOSE hacia el agente y el flujo se libera
    client.end()
    client.destroy()
    await flush()
    expect(t.fromHost.some((f) => f.id === open.id && f.type === FrameType.CLOSE)).toBe(true)
    expect(t.host.streamCount).toBe(0)
  })

  it('control de flujo: sin créditos se pausa y se encola; un WINDOW reanuda', async () => {
    const t = setup()
    await t.host.start()
    const client = new FakeSocket()
    t.inbound(client)
    await flush()
    const id = t.fromHost.find((f) => f.type === FrameType.OPEN)!.id
    client.push2(Buffer.alloc(INITIAL_WINDOW + 1000, 1))
    await flush()
    const sent = (): number => t.fromHost.filter((f) => f.id === id && f.type === FrameType.DATA).reduce((n, f) => n + f.data.length, 0)
    expect(sent()).toBe(INITIAL_WINDOW)
    t.agent(id, FrameType.WINDOW, encodeWindow(1000))
    await flush()
    expect(sent()).toBe(INITIAL_WINDOW + 1000)
  })

  it('PING → PONG; READY resuelve ready; EXIT guarda el código', async () => {
    const t = setup()
    await t.host.start()
    t.agent(0, FrameType.PING, Buffer.from('x'))
    t.agent(0, FrameType.READY)
    t.agent(0, FrameType.EXIT, encodeExit(3))
    await flush()
    await t.host.ready
    expect(t.fromHost.some((f) => f.type === FrameType.PONG && f.data.toString() === 'x')).toBe(true)
    t.wslOut.end()
    expect(await t.host.exited).toBe(3)
  })

  it('al morir wsl.exe se cierran todos los flujos, el listener y `exited` se resuelve', async () => {
    const t = setup()
    await t.host.start()
    t.agent(2, FrameType.OPEN, encodePort(52000))
    const client = new FakeSocket()
    t.inbound(client)
    await flush()
    expect(t.host.streamCount).toBe(2)
    const closed = new Promise((r) => t.host.once('closed', r))
    t.wslOut.destroy() // wsl.exe murió
    await closed
    expect(t.host.streamCount).toBe(0)
    expect(t.sockets.get(52000)!.destroyed).toBe(true)
    expect(client.destroyed).toBe(true)
    expect(await t.host.exited).toBeNull()
    expect(t.listenerClosed()).toBe(true)
    await expect(t.host.ready).rejects.toThrow(/antes de READY/)
  })

  it('trama inválida del agente (tipo, tamaño o INIT): error tipado y sesión cortada con EOF al agente', async () => {
    for (const bad of [
      Buffer.from([0, 0, 0, 2, 99, 0, 0, 0, 0]),
      Buffer.from([0, 0, 0, 2, 3, 0xff, 0xff, 0xff, 0xff]),
      encodeFrame({ id: 0, type: FrameType.INIT })
    ]) {
      const t = setup()
      await t.host.start()
      const err = new Promise((r) => t.host.once('protocol-error', r))
      t.wslOut.write(bad)
      await err
      await flush()
      expect(await t.host.exited).toBeNull()
      expect(t.fromHost.some((f) => f.type === FrameType.ERROR)).toBe(true)
      expect(t.wslIn.writableEnded).toBe(true)
    }
  })

  it('demasiados flujos «out» abiertos: error too_many_streams y sesión cortada (máx. 256)', async () => {
    const t = setup()
    await t.host.start()
    for (let i = 1; i <= 257; i++) t.agent(2 * i, FrameType.OPEN, encodePort(52000))
    await flush()
    const errs = t.fromHost.filter((f) => f.type === FrameType.ERROR && f.id === 0).map((f) => decodeError(f.data).code)
    expect(errs).toContain('too_many_streams')
    expect(await t.host.exited).toBeNull()
    expect(t.host.streamCount).toBe(0)
  })

  it('demasiadas conexiones «in»: se rechaza esa conexión, la sesión sigue', async () => {
    const t = setup()
    await t.host.start()
    const socks: FakeSocket[] = []
    for (let i = 0; i < 258; i++) {
      const s = new FakeSocket()
      socks.push(s)
      t.inbound(s)
    }
    await flush()
    expect(t.host.streamCount).toBe(256)
    expect(socks.slice(256).every((s) => s.destroyed)).toBe(true)
    expect(socks.slice(0, 256).every((s) => !s.destroyed)).toBe(true)
  })

  it('fallo al conectar: ERROR + CLOSE y el flujo se libera; ERROR del agente cierra el flujo', async () => {
    const t = setup({ connect: async () => Promise.reject(new Error('ECONNREFUSED')) })
    await t.host.start()
    t.agent(2, FrameType.OPEN, encodePort(52000))
    await flush()
    expect(t.fromHost.some((f) => f.type === FrameType.ERROR && decodeError(f.data).code === 'closed')).toBe(true)
    expect(t.host.streamCount).toBe(0)
    const t2 = setup()
    await t2.host.start()
    t2.agent(2, FrameType.OPEN, encodePort(52000))
    await flush()
    t2.agent(2, FrameType.ERROR, encodeError('internal', 'x'))
    await flush()
    expect(t2.host.streamCount).toBe(0)
  })

  it('close(): EOF al agente, sin flujos y listener cerrado', async () => {
    const t = setup()
    await t.host.start()
    await t.host.close()
    expect(t.wslIn.writableEnded).toBe(true)
    expect(t.listenerClosed()).toBe(true)
    expect(await t.host.exited).toBeNull()
  })
})
