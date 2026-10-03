import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DevicesStore, type SafeStorageLike } from '../devices-store'
import { LanSignalingServer } from './lan-server'

const safe: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').reverse()),
  decryptString: (b) => Buffer.from(b).reverse().toString('utf8')
}
const auth = { authorize: () => false }
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remote-port-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const portOf = (origin: string): number => Number(new URL(origin).port)

describe('puerto estable por instalación (D1)', () => {
  it('el puerto se guarda en remote.bin junto a los dispositivos y sobrevive a reabrir', () => {
    const file = join(dir, 'remote.bin')
    const a = new DevicesStore(file, safe)
    expect(a.getPort()).toBeNull()
    const d = a.add('Móvil')
    a.setPort(53123)
    const b = new DevicesStore(file, safe)
    expect(b.getPort()).toBe(53123)
    expect(b.get(d.id)?.name).toBe('Móvil')
    b.add('Otro')
    expect(new DevicesStore(file, safe).getPort()).toBe(53123) // añadir un dispositivo no pierde el puerto
    a.setPort(80) // fuera de rango: se ignora
    expect(a.getPort()).toBe(53123)
  })

  it('sin puerto guardado: usa uno libre y lo notifica; después se reutiliza el mismo', async () => {
    const saved: number[] = []
    const s1 = new LanSignalingServer({ ip: '127.0.0.1', pwaDir: dir, preferredPort: null, onFirstPort: (p) => saved.push(p) })
    const p1 = portOf((await s1.start(auth)).origin)
    await s1.stop()
    expect(saved).toEqual([p1])
    const s2 = new LanSignalingServer({ ip: '127.0.0.1', pwaDir: dir, preferredPort: p1, onFirstPort: (p) => saved.push(p) })
    expect(portOf((await s2.start(auth)).origin)).toBe(p1)
    await s2.stop()
    expect(saved).toEqual([p1]) // con puerto preferido no se vuelve a guardar
  })

  it('con el puerto ocupado cae a otro libre y no pisa el guardado', async () => {
    const blocker = createServer()
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r))
    const busy = (blocker.address() as { port: number }).port
    const saved: number[] = []
    const s = new LanSignalingServer({ ip: '127.0.0.1', pwaDir: dir, preferredPort: busy, onFirstPort: (p) => saved.push(p) })
    const p = portOf((await s.start(auth)).origin)
    expect(p).not.toBe(busy)
    expect(saved).toEqual([])
    await s.stop()
    await new Promise<void>((r) => blocker.close(() => r()))
  })
})
