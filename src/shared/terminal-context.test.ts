import { describe, expect, it } from 'vitest'
import {
  buildTerminalAsk,
  cleanTerminalText,
  clipTail,
  MAX_TERMINAL_CONTEXT_CHARS,
  scrubTerminalSecrets,
  stripAnsi
} from './terminal-context'

describe('stripAnsi', () => {
  it('quita colores, cursor, OSC y retornos de carro', () => {
    expect(stripAnsi('\u001b[31mrojo\u001b[0m \u001b[2K\u001b[1Gok')).toBe('rojo ok')
    expect(stripAnsi('\u001b]0;título\u0007hola\r\nmundo')).toBe('hola\nmundo')
    expect(stripAnsi('a\u0000b\u0007c')).toBe('abc')
  })
})

describe('scrubTerminalSecrets', () => {
  const cases: Array<[string, string]> = [
    ['export OPENAI_API_KEY=abc123def456ghi789', 'abc123def456ghi789'],
    ['GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123', 'ghp_abcdefghijklmnopqrstuvwxyz0123'],
    ['MY_SECRET: "valor-super-secreto"', 'valor-super-secreto'],
    ['DB_PASSWORD=hunter2', 'hunter2'],
    ['curl -H "Authorization: Bearer abc.def.ghi" https://x', 'abc.def.ghi'],
    ['Cookie: sid=abcdef123456; other=1', 'abcdef123456'],
    ['sk-ant-api03-ABCDEFGHIJKLMNOP', 'ABCDEFGHIJKLMNOP'],
    [['AKIA', 'IOSFODNN7EXAMPLE'].join(''), ['AKIA', 'IOSFODNN7EXAMPLE'].join('')],
    ['https://user:pass1234@host.example/repo.git', 'pass1234'],
    ['GET /x?token=zzzzzzzzzz9999', 'zzzzzzzzzz9999'],
    [['-----BEGIN RSA ', 'PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA ', 'PRIVATE KEY-----'].join(''), 'MIIEowIBAAKCAQEA']
  ]
  it.each(cases)('tacha %s', (input, secret) => {
    const out = scrubTerminalSecrets(input)
    expect(out).not.toContain(secret)
    expect(out).toContain('…')
  })
  it('deja pasar texto normal y conserva el nombre de la variable', () => {
    expect(scrubTerminalSecrets('npm ERR! code ENOENT en src/index.ts:12')).toBe('npm ERR! code ENOENT en src/index.ts:12')
    expect(scrubTerminalSecrets('API_KEY=secreto123')).toBe('API_KEY=…')
  })
})

describe('cleanTerminalText / clipTail', () => {
  it('colapsa líneas en blanco y espacios finales', () => {
    expect(cleanTerminalText('\n\na   \n\n\n\nb\n\n')).toBe('a\n\nb')
  })
  it('recorta por el principio y avisa', () => {
    const big = Array.from({ length: 2000 }, (_, i) => `linea ${i} xxxxxxxxxx`).join('\n')
    const r = clipTail(big)
    expect(r.clipped).toBe(true)
    expect(r.text.length).toBeLessThanOrEqual(MAX_TERMINAL_CONTEXT_CHARS)
    expect(r.text.endsWith('linea 1999 xxxxxxxxxx')).toBe(true)
    expect(r.text.startsWith('linea ')).toBe(true)
    expect(clipTail('corto')).toEqual({ text: 'corto', clipped: false })
  })
})

describe('buildTerminalAsk', () => {
  it('arma intro + bloque text sin secretos', () => {
    const r = buildTerminalAsk('\u001b[31merror\u001b[0m TOKEN=abcdef123456\n', 'Intro', 'Aviso')
    expect(r.text).toBe('Intro\n\n```text\nerror TOKEN=…\n```\n')
    expect(r.clipped).toBe(false)
  })
  it('usa una valla más larga si el texto trae ```', () => {
    const r = buildTerminalAsk('a ``` b', 'I', 'N')
    expect(r.text).toContain('````text\na ``` b\n````')
  })
  it('vacío = null; recortado añade el aviso', () => {
    expect(buildTerminalAsk('  \n\u001b[0m\n', 'I', 'N').text).toBeNull()
    const big = Array.from({ length: 2000 }, (_, i) => `l${i} yyyyyyyyyyyy`).join('\n')
    const r = buildTerminalAsk(big, 'I', 'AVISO')
    expect(r.clipped).toBe(true)
    expect(r.text).toContain('AVISO')
  })
})
