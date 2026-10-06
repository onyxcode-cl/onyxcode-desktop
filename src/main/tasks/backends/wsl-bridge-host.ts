/**
 * Lado Windows del puente por la stdio de `wsl.exe` (F8-B81). Se testea con dobles (Duplex en lugar de wsl.exe y de
 * los sockets): el módulo no importa `net` ni Electron; `connect`/`listen` se inyectan.
 *
 *  - flujos «out» (el agente pide salir): SOLO a `127.0.0.1:<puerto>` con el puerto en `allowedPorts` (egress,
 *    credenciales, proxy MCP…); cualquier otro puerto se rechaza con `port_denied`, se registra y NO se conecta;
 *  - flujos «in»: `main` escucha en 127.0.0.1:`serverPort` (la `baseUrl` del servidor) y abre un flujo hacia el
 *    servidor de dentro (el agente solo acepta `serverPort`);
 *  - control de flujo por créditos: lo que el agente no puede absorber se encola y se pausa el socket; lo que `main`
 *    escribe a un socket se devuelve como crédito cuando el socket lo acepta;
 *  - cualquier violación del protocolo corta TODA la sesión (se cierra el stdin del agente => EOF => el lanzador sale).
 */
import { EventEmitter } from 'node:events'
import type { Duplex, Readable, Writable } from 'node:stream'
import {
  BridgeProtocolError,
  FrameDecoder,
  FrameType,
  MAX_FRAME_DATA,
  StreamTable,
  decodeError,
  decodeExit,
  decodePort,
  decodeWindow,
  encodeError,
  encodeFrame,
  encodePort,
  encodeWindow,
  idOwner,
  type BridgeErrorCode,
  type Frame
} from './bridge-protocol'

export interface BridgeListener {
  close(): Promise<void>
}

export interface BridgeHostOptions {
  /** Salida (stdout) de `wsl.exe`: tramas del agente. */
  input: Readable
  /** Entrada (stdin) de `wsl.exe`: tramas hacia el agente. */
  output: Writable
  /** Trama INIT ya construida (`buildWslInit`): se escribe primero. */
  initFrame: Buffer
  /** Puertos de 127.0.0.1 de Windows a los que el agente puede conectar. */
  allowedPorts: readonly number[]
  /** Puerto del servidor de OpenCode (escucha dentro; aquí se escucha el mismo número en 127.0.0.1). */
  serverPort: number
  connect(port: number): Promise<Duplex>
  listen(port: number, onConnection: (socket: Duplex) => void): Promise<BridgeListener>
  onReject?: (info: { port: number; streamId: number }) => void
}

interface HostStream {
  id: number
  socket: Duplex | null
  /** Datos del agente que llegaron antes de que conectara el socket. */
  pendingIn: Buffer[]
  /** Datos del socket que esperan créditos del agente. */
  queueOut: Buffer[]
  /** Créditos pendientes de devolver al agente. */
  owed: number
  closeAfterFlush: boolean
}

const SLICE = 64 * 1024
const WINDOW_BATCH = 32 * 1024
/** Tope de conexiones locales en espera de READY (el resto se rechaza). */
const MAX_EARLY = 16

export class WslBridgeHost extends EventEmitter {
  /** Se resuelve con READY del agente; se rechaza si la sesión se corta antes. */
  readonly ready: Promise<void>
  /** Se resuelve al terminar: código del servidor (EXIT) o null si la sesión se cortó. */
  readonly exited: Promise<number | null>
  readonly rejected: Array<{ port: number; streamId: number }> = []

  private readonly decoder = new FrameDecoder()
  private readonly table = new StreamTable('host')
  private readonly streams = new Map<number, HostStream>()
  private readonly allowed: Set<number>
  private listener: BridgeListener | null = null
  private nextId = 1
  private closed = false
  /** El lanzador ya mandó READY: solo desde entonces se le puede enviar OPEN/DATA (antes solo espera INIT). */
  private isReady = false
  /** Conexiones locales que llegaron antes de READY (p. ej. el sondeo de salud): esperan, en orden, hasta READY. */
  private readonly early: Duplex[] = []
  private serverExit: number | null = null
  private resolveReady!: () => void
  private rejectReady!: (e: Error) => void
  private resolveExited!: (c: number | null) => void

  constructor(private readonly o: BridgeHostOptions) {
    super()
    this.allowed = new Set(o.allowedPorts)
    this.ready = new Promise<void>((res, rej) => {
      this.resolveReady = res
      this.rejectReady = rej
    })
    this.ready.catch(() => {}) // quien no espere `ready` no provoca un rechazo sin manejar
    this.exited = new Promise<number | null>((res) => (this.resolveExited = res))
  }

  async start(): Promise<void> {
    this.o.input.on('data', (c: Buffer) => this.onData(c))
    this.o.input.on('end', () => this.shutdown('eof'))
    this.o.input.on('close', () => this.shutdown('eof'))
    this.o.input.on('error', () => this.shutdown('eof'))
    this.o.output.on('error', () => this.shutdown('eof'))
    this.o.output.write(this.o.initFrame)
    this.listener = await this.o.listen(this.o.serverPort, (s) => this.onInbound(s))
    if (this.closed) await this.listener.close().catch(() => {})
  }

  /** Cierra la sesión: EOF al agente (sale solo), sockets destruidos, listener cerrado. */
  async close(): Promise<void> {
    this.shutdown('close')
    await this.listener?.close().catch(() => {})
  }

  get streamCount(): number {
    return this.table.count
  }

  // ───────── entrada del agente ─────────
  private onData(chunk: Buffer): void {
    if (this.closed) return
    let frames: Frame[]
    try {
      frames = this.decoder.push(chunk)
    } catch (e) {
      this.fatal(e)
      return
    }
    for (const f of frames) {
      try {
        this.onFrame(f)
      } catch (e) {
        this.fatal(e)
        return
      }
      if (this.closed) return
    }
  }

  private onFrame(f: Frame): void {
    switch (f.type) {
      case FrameType.OPEN:
        return this.onOpenFromAgent(f)
      case FrameType.DATA: {
        const st = this.streams.get(f.id)
        if (!st) return this.sendError(f.id, 'stream_unknown')
        if (st.socket) this.writeToSocket(st, f.data)
        else st.pendingIn.push(f.data)
        return
      }
      case FrameType.CLOSE:
        return this.dropStream(f.id, false)
      case FrameType.WINDOW: {
        const st = this.streams.get(f.id)
        if (!st) return
        this.table.grant(f.id, decodeWindow(f.data))
        this.flushQueue(st)
        return
      }
      case FrameType.PING:
        return this.send(0, FrameType.PONG, f.data.subarray(0, 64))
      case FrameType.PONG:
        return
      case FrameType.READY:
        this.isReady = true
        for (const sock of this.early.splice(0)) this.onInbound(sock)
        this.resolveReady()
        this.emit('ready')
        return
      case FrameType.EXIT:
        this.serverExit = decodeExit(f.data)
        this.emit('server-exit', this.serverExit)
        return
      case FrameType.ERROR: {
        const e = decodeError(f.data)
        this.emit('agent-error', f.id, e)
        if (f.id !== 0) this.dropStream(f.id, false)
        return
      }
      default:
        // INIT no viaja hacia el host
        throw new BridgeProtocolError('bad_type')
    }
  }

  private onOpenFromAgent(f: Frame): void {
    if (idOwner(f.id) !== 'agent') throw new BridgeProtocolError('bad_id')
    const port = decodePort(f.data)
    if (!this.allowed.has(port)) {
      // Se valida ANTES de tocar la tabla ni de conectar: un destino no listado no consume nada.
      this.rejected.push({ port, streamId: f.id })
      this.o.onReject?.({ port, streamId: f.id })
      this.sendError(f.id, 'port_denied', `puerto ${port} no permitido`)
      this.send(f.id, FrameType.CLOSE)
      return
    }
    this.table.openRemote(f.id)
    const st = this.track(f.id)
    this.o
      .connect(port)
      .then((sock) => {
        if (this.closed || !this.streams.has(f.id)) {
          sock.destroy()
          return
        }
        this.attach(st, sock)
        for (const d of st.pendingIn.splice(0)) this.writeToSocket(st, d)
      })
      .catch(() => {
        this.sendError(f.id, 'closed', 'no se pudo conectar')
        this.dropStream(f.id, true)
      })
  }

  // ───────── flujos «in» ─────────
  private onInbound(sock: Duplex): void {
    if (this.closed) return void sock.destroy()
    if (!this.isReady) {
      // El lanzador solo espera INIT hasta que manda READY: un OPEN/DATA antes lo hace salir («la primera trama no es INIT»).
      if (this.early.length >= MAX_EARLY) return void sock.destroy()
      sock.pause()
      this.early.push(sock)
      return
    }
    const id = this.nextId
    this.nextId += 2
    try {
      this.table.openLocal(id)
    } catch {
      return void sock.destroy() // demasiados flujos: se rechaza esa conexión, la sesión sigue
    }
    const st = this.track(id)
    this.send(id, FrameType.OPEN, encodePort(this.o.serverPort))
    this.attach(st, sock)
    sock.resume() // si esperó a READY estaba en pausa
  }

  // ───────── sockets ─────────
  private track(id: number): HostStream {
    const st: HostStream = { id, socket: null, pendingIn: [], queueOut: [], owed: 0, closeAfterFlush: false }
    this.streams.set(id, st)
    return st
  }

  private attach(st: HostStream, sock: Duplex): void {
    st.socket = sock
    sock.on('data', (chunk: Buffer) => {
      for (let i = 0; i < chunk.length; i += SLICE) st.queueOut.push(chunk.subarray(i, i + SLICE))
      this.flushQueue(st)
    })
    const end = (): void => {
      st.closeAfterFlush = true
      this.flushQueue(st)
    }
    sock.on('end', end)
    sock.on('close', end)
    sock.on('error', end)
  }

  private flushQueue(st: HostStream): void {
    if (this.closed || !this.streams.has(st.id)) return
    while (st.queueOut.length) {
      const win = this.table.window(st.id)
      if (win <= 0) {
        st.socket?.pause()
        return
      }
      const head = st.queueOut[0]!
      const n = Math.min(head.length, win, MAX_FRAME_DATA)
      this.table.consume(st.id, n)
      this.send(st.id, FrameType.DATA, head.subarray(0, n))
      if (n === head.length) st.queueOut.shift()
      else st.queueOut[0] = head.subarray(n)
    }
    if (st.closeAfterFlush) {
      this.dropStream(st.id, true)
      return
    }
    st.socket?.resume()
  }

  private writeToSocket(st: HostStream, data: Buffer): void {
    st.socket!.write(data, () => {
      st.owed += data.length
      if (st.owed >= WINDOW_BATCH || !st.socket || st.socket.writableLength === 0) {
        const n = st.owed
        st.owed = 0
        if (n > 0 && this.streams.has(st.id)) this.send(st.id, FrameType.WINDOW, encodeWindow(n))
      }
    })
  }

  private dropStream(id: number, notify: boolean): void {
    const st = this.streams.get(id)
    if (!st) return
    this.streams.delete(id)
    this.table.close(id)
    st.socket?.destroy()
    if (notify) this.send(id, FrameType.CLOSE)
  }

  // ───────── salida hacia el agente / cierre ─────────
  private send(id: number, type: number, data?: Buffer): void {
    if (this.closed && type !== FrameType.ERROR) return
    try {
      this.o.output.write(encodeFrame({ id, type, data }))
    } catch {
      this.shutdown('eof')
    }
  }

  private sendError(id: number, code: BridgeErrorCode, message = ''): void {
    this.send(id, FrameType.ERROR, encodeError(code, message))
  }

  private fatal(e: unknown): void {
    const code: BridgeErrorCode = e instanceof BridgeProtocolError ? e.code : 'internal'
    try {
      this.o.output.write(encodeFrame({ id: 0, type: FrameType.ERROR, data: encodeError(code) }))
    } catch {
      /* el agente ya no escucha */
    }
    this.emit('protocol-error', e)
    this.shutdown(code)
  }

  private shutdown(reason: string): void {
    if (this.closed) return
    this.closed = true
    for (const id of [...this.streams.keys()]) {
      const st = this.streams.get(id)
      this.streams.delete(id)
      st?.socket?.destroy()
    }
    for (const sock of this.early.splice(0)) sock.destroy()
    this.table.closeAll()
    this.rejectReady(new Error(`puente cerrado antes de READY (${reason})`))
    this.o.output.end() // EOF hacia el lanzador: sale solo
    void this.listener?.close().catch(() => {})
    this.resolveExited(this.serverExit)
    this.emit('closed', reason)
  }
}
