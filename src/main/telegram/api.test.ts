import { afterEach, describe, expect, it } from 'vitest'
import { startFakeTelegram, type FakeTelegram } from '../../../e2e/fake-telegram/server.mjs'
import { TELEGRAM_API_BASE, TelegramApi, TelegramApiError, resolveApiBase } from './api'
import { fakeToken } from './test-kit'

let tg: FakeTelegram | null = null
afterEach(async () => {
  await tg?.stop()
  tg = null
})

describe('dirección base', () => {
  it('en producción es siempre api.telegram.org, aunque haya variable de entorno', () => {
    const env = { LAZUNOX_TELEGRAM_API_BASE: 'http://127.0.0.1:9999' }
    expect(resolveApiBase({ isPackaged: true, env })).toBe(TELEGRAM_API_BASE)
    expect(resolveApiBase({ isPackaged: true, env: {} })).toBe('https://api.telegram.org')
  })

  it('sin empaquetar solo acepta un servidor LOCAL por la variable de pruebas', () => {
    const base = (v: string | undefined) => resolveApiBase({ isPackaged: false, env: { LAZUNOX_TELEGRAM_API_BASE: v } })
    expect(base('http://127.0.0.1:4321')).toBe('http://127.0.0.1:4321')
    expect(base('http://localhost:4321/')).toBe('http://localhost:4321')
    expect(base('http://[::1]:4321')).toBe('http://[::1]:4321')
    for (const bad of [
      'https://evil.example',
      'http://evil.example:80',
      'http://127.0.0.1.evil.example',
      'http://127.0.0.1@evil.example',
      'ftp://127.0.0.1',
      '',
      undefined
    ])
      expect(base(bad)).toBe(TELEGRAM_API_BASE)
  })
})

describe('TelegramApi', () => {
  it('429: espera retry_after (con tope) y reintenta', async () => {
    tg = await startFakeTelegram({ token: fakeToken() })
    const sleeps: number[] = []
    const api = new TelegramApi({ token: tg.token, baseUrl: tg.url, minGapMs: 0, sleep: async (ms) => void sleeps.push(ms) })
    tg.failNext('sendMessage', { status: 429, retry_after: 7, times: 2 })
    const m = await api.sendMessage({ chatId: 1, text: 'hola' })
    expect(m.message_id).toBeGreaterThan(0)
    expect(sleeps.filter((s) => s >= 1000)).toEqual([7000, 7000])
    expect(tg.requests.filter((r) => r.method === 'sendMessage')).toHaveLength(3)
  })

  it('429: no espera más del tope y se rinde tras los reintentos', async () => {
    tg = await startFakeTelegram({ token: fakeToken() })
    const sleeps: number[] = []
    const api = new TelegramApi({
      token: tg.token,
      baseUrl: tg.url,
      minGapMs: 0,
      maxRetries: 2,
      maxRetryAfterSec: 30,
      sleep: async (ms) => void sleeps.push(ms)
    })
    tg.failNext('sendMessage', { status: 429, retry_after: 3600, times: 10 })
    await expect(api.sendMessage({ chatId: 1, text: 'hola' })).rejects.toMatchObject({ kind: 'rate-limited', retryAfter: 3600 })
    expect(Math.max(...sleeps)).toBe(30_000)
    expect(tg.requests.filter((r) => r.method === 'sendMessage')).toHaveLength(3)
  })

  it('clasifica los errores y nunca incluye el token en el mensaje', async () => {
    tg = await startFakeTelegram({ token: fakeToken() })
    const bad = new TelegramApi({ token: fakeToken('123456789', 'w'), baseUrl: tg.url, minGapMs: 0 })
    const err = await bad.getMe().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TelegramApiError)
    expect(err).toMatchObject({ kind: 'unauthorized', status: 401 })
    expect(String((err as Error).message)).not.toContain('www')
    tg.block(42)
    const api = new TelegramApi({ token: tg.token, baseUrl: tg.url, minGapMs: 0 })
    await expect(api.sendMessage({ chatId: 42, text: 'x' })).rejects.toMatchObject({ kind: 'forbidden' })
  })

  it('error de red: el mensaje no lleva el token aunque el error original traiga la URL', async () => {
    const token = fakeToken()
    const api = new TelegramApi({
      token,
      baseUrl: 'http://127.0.0.1:1',
      minGapMs: 0,
      fetch: (async (url: string) => {
        throw new Error(`fallo al conectar con ${url}`)
      }) as unknown as typeof fetch
    })
    const err = (await api.getMe().catch((e: unknown) => e)) as TelegramApiError
    expect(err.kind).toBe('network')
    expect(err.message).not.toContain(token.split(':')[1])
  })

  it('callback_data de más de 64 bytes, HTML mal escapado y mensajes de más de 4096 los rechaza el servidor', async () => {
    tg = await startFakeTelegram({ token: fakeToken() })
    const api = new TelegramApi({ token: tg.token, baseUrl: tg.url, minGapMs: 0 })
    await expect(
      api.sendMessage({ chatId: 1, text: 'x', markup: { inline_keyboard: [[{ text: 'a', callback_data: 'x'.repeat(65) }]] } })
    ).rejects.toMatchObject({ kind: 'bad-request' })
    await expect(api.sendMessage({ chatId: 1, text: 'a < b' })).rejects.toMatchObject({ kind: 'bad-request' })
    await expect(api.sendMessage({ chatId: 1, text: 'a'.repeat(4097) })).rejects.toMatchObject({ kind: 'bad-request' })
  })

  it('getUpdates respeta el offset (confirma lo anterior)', async () => {
    tg = await startFakeTelegram({ token: fakeToken(), firstUpdateId: 50 })
    const api = new TelegramApi({ token: tg.token, baseUrl: tg.url, minGapMs: 0 })
    tg.sendUser({ chatId: 1, text: 'a' })
    tg.sendUser({ chatId: 1, text: 'b' })
    const first = await api.getUpdates({ offset: 0, timeoutSec: 1 })
    expect(first.map((u) => u.update_id)).toEqual([50, 51])
    const second = await api.getUpdates({ offset: 51, timeoutSec: 1 })
    expect(second.map((u) => u.update_id)).toEqual([51])
    expect(await api.getUpdates({ offset: 52, timeoutSec: 1 })).toEqual([])
  })
})
