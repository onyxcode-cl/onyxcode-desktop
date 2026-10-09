import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { downloadPinnedFile, type FetchFn } from './pinned-fetch'

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const BODY = Buffer.from('contenido-de-prueba-'.repeat(500))
const URL0 = 'https://example.com/modelo.bin'

const ok =
  (b: Buffer = BODY, chunk = 700): FetchFn =>
  async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          for (let i = 0; i < b.length; i += chunk) c.enqueue(new Uint8Array(b.subarray(i, i + chunk)))
          c.close()
        }
      }),
      { status: 200 }
    )

let dir: string
let dest: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pinned-fetch-'))
  dest = join(dir, 'modelo.bin')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('downloadPinnedFile', () => {
  it('descarga, escribe el destino final y limpia el .part', async () => {
    const bytes: Array<[number, number]> = []
    await downloadPinnedFile(URL0, dest, BODY.length, sha(BODY), { fetch: ok(), onBytes: (r, t) => bytes.push([r, t]) })
    expect(readFileSync(dest)).toEqual(BODY)
    expect(existsSync(`${dest}.part`)).toBe(false)
    expect(bytes.length).toBeGreaterThan(0)
    expect(bytes[bytes.length - 1]).toEqual([BODY.length, BODY.length])
  })

  it('si el destino ya existe con el SHA-256 correcto, no llama a fetch', async () => {
    writeFileSync(dest, BODY)
    let calls = 0
    const spy: FetchFn = async () => {
      calls++
      return ok()(URL0)
    }
    await downloadPinnedFile(URL0, dest, BODY.length, sha(BODY), { fetch: spy })
    expect(calls).toBe(0)
  })

  it('si el destino existe pero con otro contenido, descarga de nuevo y lo reemplaza', async () => {
    writeFileSync(dest, Buffer.from('viejo-y-corrupto'))
    await downloadPinnedFile(URL0, dest, BODY.length, sha(BODY), { fetch: ok() })
    expect(readFileSync(dest)).toEqual(BODY)
  })

  it('tamaño recibido distinto al pinneado: falla y no deja .part ni destino corrupto', async () => {
    await expect(downloadPinnedFile(URL0, dest, BODY.length + 1, sha(BODY), { fetch: ok() })).rejects.toThrow()
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('SHA-256 recibido distinto al pinneado: falla y no deja .part ni destino corrupto', async () => {
    await expect(downloadPinnedFile(URL0, dest, BODY.length, sha(Buffer.from('otra-cosa')), { fetch: ok() })).rejects.toThrow()
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('respuesta no-ok: falla sin escribir nada', async () => {
    const bad: FetchFn = async () => new Response(null, { status: 404 })
    await expect(downloadPinnedFile(URL0, dest, BODY.length, sha(BODY), { fetch: bad })).rejects.toThrow()
    expect(existsSync(dest)).toBe(false)
  })

  it('el servidor manda más bytes de los pinneados (más allá del margen): aborta sin dejar .part', async () => {
    const big = Buffer.alloc(BODY.length + 50_000_000, 1)
    await expect(downloadPinnedFile(URL0, dest, BODY.length, sha(BODY), { fetch: ok(big), slackBytes: 1_000 })).rejects.toThrow()
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })
})
