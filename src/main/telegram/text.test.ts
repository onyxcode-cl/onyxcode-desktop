import { describe, expect, it } from 'vitest'
import { visibleText } from '../../../e2e/fake-telegram/server.mjs'
import { escapeHtml, redactForTelegram, safeBlock, safeLine, scrubToken, stripControl, truncateMiddle } from './text'

const key = (): string => ['sk', 'live', 'abcDEF123456ghiJKL'].join('-')
const PEM_HEAD = ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ')
const PEM_TAIL = ['-----END', 'PRIVATE', 'KEY-----'].join(' ')
const botToken = (): string => `${'8'.repeat(9)}:${'AAH'.repeat(11)}`

describe('tapado', () => {
  it('tapa claves conocidas, tokens de bot, cabeceras y llaves privadas', () => {
    const k = key()
    const t = botToken()
    const out = redactForTelegram(
      `curl -H "Authorization: Bearer ${'xyz123ABC'.repeat(3)}" ${k} https://api.telegram.org/bot${t}/getMe\n${PEM_HEAD}\nMIIE...\n${PEM_TAIL}`
    )
    expect(out).not.toContain(k)
    expect(out).not.toContain(t)
    expect(out).not.toContain('xyz123ABC')
    expect(out).not.toContain('MIIE')
  })

  it('scrubToken quita el token exacto aunque no tenga forma reconocible', () => {
    expect(scrubToken('error con zzzzzzzzzzzz dentro', 'zzzzzzzzzzzz')).not.toContain('zzzzzzzzzzzz')
  })
})

describe('escape y recorte', () => {
  it('escapa & < > y nada más', () => {
    expect(escapeHtml('<b>"a" & \'b\'</b>')).toBe('&lt;b&gt;"a" &amp; \'b\'&lt;/b&gt;')
  })

  it('quita controles y marcas de dirección que confunden', () => {
    expect(stripControl('a\u0000b‮c d\ne\tf')).toBe('abcd\ne\tf')
  })

  it('truncateMiddle deja inicio y final y avisa de lo omitido', () => {
    const out = truncateMiddle('A'.repeat(100) + 'MEDIO' + 'Z'.repeat(100), 60)
    expect(out.startsWith('AAAA')).toBe(true)
    expect(out.endsWith('ZZZZ')).toBe(true)
    expect(out).toMatch(/\[… \d+ …\]/)
    expect(out.length).toBeLessThanOrEqual(70)
    expect(truncateMiddle('corto', 60)).toBe('corto')
  })

  it('safeBlock: escapado nunca pasa del presupuesto, aunque cada carácter se multiplique', () => {
    for (const ch of ['<', '&', '>', 'a']) {
      const out = safeBlock(ch.repeat(30_000), { max: 5000, budget: 1000 })
      expect(out.length).toBeLessThanOrEqual(1000)
      expect(visibleText(`<pre>${out}</pre>`).length).toBeLessThanOrEqual(1000)
    }
  })

  it('safeLine: una línea, sin etiquetas, recortada', () => {
    const out = safeLine('<i>hola</i>\n\nmundo ' + 'x'.repeat(200), 40)
    expect(out).not.toMatch(/[\n<]/)
    expect(out.length).toBeLessThanOrEqual(60)
  })
})
