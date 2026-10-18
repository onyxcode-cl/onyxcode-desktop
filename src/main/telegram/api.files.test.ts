import { afterEach, describe, expect, it } from 'vitest'
import { startFakeTelegram, type FakeTelegram } from '../../../e2e/fake-telegram/server.mjs'
import { TelegramApi, TelegramApiError } from './api'
import { fakeToken } from './test-kit'

let tg: FakeTelegram | null = null
afterEach(async () => {
  await tg?.stop()
  tg = null
})

const api = (over: Partial<ConstructorParameters<typeof TelegramApi>[0]> = {}): TelegramApi =>
  new TelegramApi({ token: tg!.token, baseUrl: tg!.url, minGapMs: 0, sleep: async () => undefined, ...over })

describe('TelegramApi: archivos (entrega 2)', () => {
  it('sendDocument arma un multipart que el servidor entiende: nombre, bytes exactos, pie con HTML y botones', async () => {
    tg = await startFakeTelegram({ token: fakeToken() })
    const bytes = Buffer.from([0, 1, 2, 255, 254, 13, 10, 13, 10, 45, 45, 65])
    const sent = await api().sendDocument({
      chatId: 7,
      filename: 'a"b\r\nc.bin',
      data: bytes,
      caption: '<b>hola</b>',
      markup: { inline_keyboard: [[{ text: 'ok', callback_data: 'f:AAAAAAAAAAAA' }]] }
    })
    expect(sent.message_id).toBeGreaterThan(0)
    expect(tg.documents).toHaveLength(1)
    expect(Buffer.compare(tg.documents[0]!.bytes, bytes)).toBe(0)
    expect(tg.documents[0]!.filename).not.toMatch(/["\r\n]/)
    expect(tg.documents[0]!.caption).toBe('<b>hola</b>')
    expect(tg.documents[0]!.reply_markup?.inline_keyboard[0]?.[0]?.callback_data).toBe('f:AAAAAAAAAAAA')
  })

  it('sendDocument respeta 429 igual que el resto de escrituras', async () => {
    tg = await startFakeTelegram({ token: fakeToken() })
    tg.failNext('sendDocument', { status: 429, retry_after: 3, times: 1 })
    const sleeps: number[] = []
    await api({ sleep: async (ms) => void sleeps.push(ms) }).sendDocument({ chatId: 7, filename: 'x.txt', data: Buffer.from('x') })
    expect(sleeps).toContain(3000)
    expect(tg.documents).toHaveLength(1)
  })

  it('un pie con HTML mal escapado lo rechaza el servidor como el real', async () => {
    tg = await startFakeTelegram({ token: fakeToken() })
    await expect(api().sendDocument({ chatId: 7, filename: 'x.txt', data: Buffer.from('x'), caption: 'a < b' })).rejects.toMatchObject({
      kind: 'bad-request'
    })
  })

  it('downloadFile: baja los bytes exactos y NO acepta archivos grandes', async () => {
    tg = await startFakeTelegram({ token: fakeToken() })
    const id = tg.uploadFile({ name: 'a.txt', bytes: Buffer.from('contenido') })
    expect(Buffer.from(await api().downloadFile(id, 1000)).toString()).toBe('contenido')
    // demasiado grande: se rechaza por el tamaño que dice Telegram, sin bajar nada
    const big = tg.uploadFile({ name: 'g.bin', bytes: Buffer.alloc(5000) })
    const before = tg.requests.filter((r) => r.method === 'download').length
    await expect(api().downloadFile(big, 1000)).rejects.toMatchObject({ kind: 'bad-request', status: 413 })
    expect(tg.requests.filter((r) => r.method === 'download').length).toBe(before)
    await expect(api().downloadFile('nada', 1000)).rejects.toBeInstanceOf(TelegramApiError)
  })

  it('downloadFile rechaza una ruta con «..» o caracteres fuera de lo esperado', async () => {
    tg = await startFakeTelegram({ token: fakeToken() })
    for (const path of ['../../etc/passwd', 'documents/../../x', 'a b/c', 'http://evil.example/x', '']) {
      const a = api()
      ;(a as unknown as { getFile: () => Promise<unknown> }).getFile = async () => ({ file_id: 'x', file_size: 3, file_path: path })
      await expect(a.downloadFile('x', 1000), path).rejects.toMatchObject({ kind: 'bad-request' })
    }
  })

  it('un servidor que miente en el tamaño: se corta con lo realmente recibido', async () => {
    tg = await startFakeTelegram({ token: fakeToken() })
    const id = tg.uploadFile({ name: 'a.bin', bytes: Buffer.alloc(3000) })
    const a = api()
    const real = a.getFile.bind(a)
    ;(a as unknown as { getFile: typeof a.getFile }).getFile = async (f, s) => ({ ...(await real(f, s)), file_size: 10 })
    await expect(a.downloadFile(id, 1000)).rejects.toMatchObject({ kind: 'bad-request', status: 413 })
  })

  it('la clave nunca aparece en el mensaje de un error de descarga', async () => {
    tg = await startFakeTelegram({ token: fakeToken() })
    const a = new TelegramApi({ token: tg.token, baseUrl: 'http://127.0.0.1:1', minGapMs: 0, sleep: async () => undefined })
    const err = await a.downloadFile('x', 100).catch((e: unknown) => e as Error)
    expect(String((err as Error).message)).not.toContain(tg.token)
  })
})
