import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BridgeProtocolError,
  FrameDecoder,
  FrameType,
  HEADER_SIZE,
  INITIAL_WINDOW,
  MAX_FRAME_DATA,
  MAX_INIT_BYTES,
  MAX_STREAMS,
  StreamTable,
  decodeError,
  decodeExit,
  decodePort,
  decodeWindow,
  decodeWslOutput,
  encodeError,
  encodeExit,
  encodeFrame,
  encodeInit,
  encodePort,
  encodeWindow,
  idOwner
} from './bridge-protocol'

const code = (fn: () => unknown): string | undefined => {
  try {
    fn()
  } catch (e) {
    return e instanceof BridgeProtocolError ? e.code : `otro:${String(e)}`
  }
  return undefined
}

describe('vectores compartidos con resources/wsl (Python)', () => {
  const vectors = JSON.parse(readFileSync(join(process.cwd(), 'resources/wsl/vectors.json'), 'utf8')) as {
    frames: Array<{ id: number; type: number; data_hex: string; frame_hex: string }>
    wsl_output: Array<{ hex: string; text: string }>
  }
  it('encodeFrame produce exactamente los bytes de cada vector y el decodificador los recupera', () => {
    expect(vectors.frames.length).toBeGreaterThan(5)
    for (const v of vectors.frames) {
      const frame = encodeFrame({ id: v.id, type: v.type, data: Buffer.from(v.data_hex, 'hex') })
      expect(frame.toString('hex')).toBe(v.frame_hex)
      const out = new FrameDecoder().push(frame)
      expect(out).toHaveLength(1)
      expect(out[0]!.id).toBe(v.id)
      expect(out[0]!.type).toBe(v.type)
      expect(out[0]!.data.toString('hex')).toBe(v.data_hex)
    }
  })
  it('decodeWslOutput coincide con los vectores (UTF-16LE con/sin BOM y UTF-8)', () => {
    for (const v of vectors.wsl_output) expect(decodeWslOutput(Buffer.from(v.hex, 'hex'))).toBe(v.text)
  })
})

describe('encodeFrame / FrameDecoder', () => {
  it('cabecera de 9 bytes en orden de red', () => {
    const f = encodeFrame({ id: 0x01020304, type: FrameType.DATA, data: Buffer.from('ab') })
    expect([...f]).toEqual([1, 2, 3, 4, 3, 0, 0, 0, 2, 0x61, 0x62])
    expect(HEADER_SIZE).toBe(9)
  })
  it('tramas pegadas en un solo chunk', () => {
    const a = encodeFrame({ id: 1, type: FrameType.OPEN, data: encodePort(4096) })
    const b = encodeFrame({ id: 1, type: FrameType.DATA, data: Buffer.from('hola') })
    const c = encodeFrame({ id: 1, type: FrameType.CLOSE })
    const out = new FrameDecoder().push(Buffer.concat([a, b, c]))
    expect(out.map((f) => f.type)).toEqual([FrameType.OPEN, FrameType.DATA, FrameType.CLOSE])
    expect(decodePort(out[0]!.data)).toBe(4096)
    expect(out[1]!.data.toString()).toBe('hola')
  })
  it('tramas partidas byte a byte', () => {
    const wire = Buffer.concat([
      encodeFrame({ id: 2, type: FrameType.DATA, data: Buffer.from('x'.repeat(300)) }),
      encodeFrame({ id: 4, type: FrameType.PING })
    ])
    const dec = new FrameDecoder()
    const got = []
    for (const byte of wire) got.push(...dec.push(Buffer.from([byte])))
    expect(got.map((f) => [f.id, f.type, f.data.length])).toEqual([
      [2, FrameType.DATA, 300],
      [4, FrameType.PING, 0]
    ])
    expect(dec.buffered).toBe(0)
  })
  it('límite de tamaño: exactamente MAX pasa; MAX+1 falla al codificar y al decodificar (sin esperar los datos)', () => {
    expect(encodeFrame({ id: 1, type: FrameType.DATA, data: Buffer.alloc(MAX_FRAME_DATA) })).toHaveLength(HEADER_SIZE + MAX_FRAME_DATA)
    expect(code(() => encodeFrame({ id: 1, type: FrameType.DATA, data: Buffer.alloc(MAX_FRAME_DATA + 1) }))).toBe('frame_too_large')
    const hdr = Buffer.alloc(HEADER_SIZE)
    hdr.writeUInt32BE(1, 0)
    hdr[4] = FrameType.DATA
    hdr.writeUInt32BE(0xffffffff, 5)
    const dec = new FrameDecoder()
    expect(code(() => dec.push(hdr))).toBe('frame_too_large')
    expect(dec.buffered).toBe(0)
  })
  it('id inválido y tipo inválido', () => {
    expect(code(() => encodeFrame({ id: -1, type: FrameType.DATA }))).toBe('bad_id')
    expect(code(() => encodeFrame({ id: 2 ** 32, type: FrameType.DATA }))).toBe('bad_id')
    expect(code(() => encodeFrame({ id: 1.5, type: FrameType.DATA }))).toBe('bad_id')
    expect(code(() => encodeFrame({ id: 1, type: 0 }))).toBe('bad_type')
    expect(code(() => encodeFrame({ id: 1, type: 99 }))).toBe('bad_type')
    const hdr = Buffer.alloc(HEADER_SIZE)
    hdr[4] = 77
    expect(code(() => new FrameDecoder().push(hdr))).toBe('bad_type')
  })
  it('tras un error el decodificador queda envenenado', () => {
    const dec = new FrameDecoder()
    const hdr = Buffer.alloc(HEADER_SIZE)
    hdr[4] = 77
    expect(code(() => dec.push(hdr))).toBe('bad_type')
    expect(dec.failed?.code).toBe('bad_type')
    expect(code(() => dec.push(encodeFrame({ id: 1, type: FrameType.PING })))).toBe('bad_type')
  })
  it('fuzz corto con semilla fija: nunca lanza algo que no sea BridgeProtocolError ni acumula sin límite', () => {
    let s = 0x9e3779b9
    const rnd = (): number => {
      s ^= s << 13
      s ^= s >>> 17
      s ^= s << 5
      return (s >>> 0) / 0x100000000
    }
    const t0 = Date.now()
    for (let i = 0; i < 300; i++) {
      const buf = Buffer.alloc(1 + Math.floor(rnd() * 200))
      for (let j = 0; j < buf.length; j++) buf[j] = Math.floor(rnd() * 256)
      const dec = new FrameDecoder()
      try {
        dec.push(buf)
      } catch (e) {
        expect(e).toBeInstanceOf(BridgeProtocolError)
      }
      expect(dec.buffered).toBeLessThanOrEqual(HEADER_SIZE + MAX_FRAME_DATA)
    }
    expect(Date.now() - t0).toBeLessThan(2000)
  })
})

describe('cargas útiles tipadas', () => {
  it('puerto, ventana, error y salida', () => {
    expect(decodePort(encodePort(65535))).toBe(65535)
    expect(code(() => encodePort(0))).toBe('bad_payload')
    expect(code(() => encodePort(65536))).toBe('bad_payload')
    expect(code(() => decodePort(Buffer.from([0, 0])))).toBe('bad_payload')
    expect(code(() => decodePort(Buffer.from([1])))).toBe('bad_payload')
    expect(decodeWindow(encodeWindow(12345))).toBe(12345)
    expect(code(() => decodeWindow(Buffer.alloc(3)))).toBe('bad_payload')
    expect(decodeError(encodeError('port_denied', 'puerto 9 no permitido ñ'))).toEqual({
      code: 'port_denied',
      message: 'puerto 9 no permitido ñ'
    })
    expect(decodeError(Buffer.from([0xff, 0xff])).code).toBe('internal')
    expect(code(() => decodeError(Buffer.alloc(1)))).toBe('bad_payload')
    expect(decodeExit(encodeExit(-9))).toBe(-9)
  })
})

describe('INIT: la clave real NUNCA va en la trama', () => {
  it('serializa y respeta el tope', () => {
    const f = encodeInit({ v: 1, folder: 'C:\\x' })
    expect(f[4]).toBe(FrameType.INIT)
    expect(code(() => encodeInit({ big: 'x'.repeat(MAX_INIT_BYTES) }))).toBe('init_invalid')
    expect(code(() => encodeInit(undefined))).toBe('init_invalid')
    const cyc: Record<string, unknown> = {}
    cyc.self = cyc
    expect(code(() => encodeInit(cyc))).toBe('init_invalid')
  })
  it('un secreto vigilado (también escapado) hace fallar la construcción', () => {
    const key = 'sk-real-ABCDEF"123\\456'
    expect(code(() => encodeInit({ env: { X: key } }, [key]))).toBe('init_secret')
    expect(code(() => encodeInit({ env: { X: `prefijo-${key}-sufijo` } }, [key]))).toBe('init_secret')
    expect(code(() => encodeInit({ env: { X: 'sandboxed-placeholder-0123' } }, [key]))).toBeUndefined()
  })
  it('propiedad con claves aleatorias (semilla fija): si aparece, falla; si no, pasa', () => {
    let s = 12345
    const rnd = (): number => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789-_"\\'
    for (let i = 0; i < 100; i++) {
      const key = 'sk-' + Array.from({ length: 10 + Math.floor(rnd() * 30) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('')
      expect(
        code(() => encodeInit({ a: { b: [key] } }, [key])),
        key
      ).toBe('init_secret')
      expect(
        code(() => encodeInit({ a: { b: ['otra cosa'] } }, [key])),
        key
      ).toBeUndefined()
    }
  })
  it('secretos de menos de 8 caracteres no se vigilan', () => {
    expect(code(() => encodeInit({ a: 'abc' }, ['abc']))).toBeUndefined()
  })
})

describe('StreamTable', () => {
  it('paridad de ids: impares los abre el host, pares el agente', () => {
    const host = new StreamTable('host')
    host.openLocal(1)
    host.openRemote(2)
    expect(code(() => host.openLocal(4))).toBe('bad_id')
    expect(code(() => host.openRemote(3))).toBe('bad_id')
    expect(code(() => host.openRemote(0))).toBe('bad_id')
    expect(code(() => host.openLocal(1))).toBe('bad_id') // duplicado
    expect(idOwner(0)).toBe('control')
  })
  it('máximo de flujos y reutilización tras cerrar', () => {
    const t = new StreamTable('host')
    for (let i = 0; i < MAX_STREAMS; i++) t.openRemote(2 * (i + 1))
    expect(t.count).toBe(MAX_STREAMS)
    expect(code(() => t.openRemote(2 * (MAX_STREAMS + 1)))).toBe('too_many_streams')
    expect(t.close(2)).toBe(true)
    t.openRemote(2 * (MAX_STREAMS + 1))
    expect(t.closeAll()).toHaveLength(MAX_STREAMS)
    expect(t.count).toBe(0)
  })
  it('créditos: consumir, esperar y conceder; sin desbordes ni flujos desconocidos', () => {
    const t = new StreamTable('agent')
    t.openLocal(2)
    expect(t.window(2)).toBe(INITIAL_WINDOW)
    t.consume(2, INITIAL_WINDOW)
    expect(code(() => t.consume(2, 1))).toBe('window_exceeded')
    t.grant(2, 10)
    expect(t.window(2)).toBe(10)
    expect(code(() => t.grant(2, 0xffffffff))).toBe('window_exceeded')
    expect(code(() => t.window(8))).toBe('stream_unknown')
  })
})

describe('decodeWslOutput (UTF-16LE de wsl.exe)', () => {
  const u16 = (s: string, bom = false): Buffer =>
    Buffer.concat([bom ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(0), Buffer.from(s, 'utf16le')])
  it('UTF-16LE con BOM, sin BOM, UTF-8 con y sin BOM, UTF-16BE', () => {
    const text = '  NAME      STATE      VERSION\r\n* Debian    Running    2\r\n'
    const expected = '  NAME      STATE      VERSION\n* Debian    Running    2\n'
    expect(decodeWslOutput(u16(text, true))).toBe(expected)
    expect(decodeWslOutput(u16(text))).toBe(expected)
    expect(decodeWslOutput(Buffer.from(text, 'utf8'))).toBe(expected)
    expect(decodeWslOutput(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]))).toBe(expected)
    const be = u16(text)
    be.swap16()
    expect(decodeWslOutput(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toBe(expected)
  })
  it('acentos y NULs sueltos; vacío', () => {
    expect(decodeWslOutput(u16('Versión de WSL: 2.4\r\n'))).toBe('Versión de WSL: 2.4\n')
    expect(decodeWslOutput(Buffer.from('hola\u0000 mundo', 'utf8'))).toBe('hola mundo')
    expect(decodeWslOutput(Buffer.alloc(0))).toBe('')
  })
})
