import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildInlineConfig } from './config'

describe('buildInlineConfig (sidecar principal)', () => {
  it('fija share:disabled y autoupdate:false, con y sin navegador', () => {
    for (const browserMcp of [null, { type: 'remote', url: 'http://127.0.0.1:1/mcp' }]) {
      const c = buildInlineConfig({ browserMcp })
      expect(c.share).toBe('disabled')
      expect(c.autoupdate).toBe(false)
    }
    expect(buildInlineConfig().share).toBe('disabled')
  })
})

describe('Chat: elegir formato de la presentación (editable o HTML/CSS)', () => {
  const inline = JSON.stringify(buildInlineConfig())
  const chatMd = readFileSync(resolve(__dirname, '../../../resources/opencode/agents/chat.md'), 'utf8').replace(/\s+/g, ' ')

  it('el prompt del Chat pide preguntar el formato ANTES de armar una presentación, con las dos opciones', () => {
    for (const text of [inline, chatMd]) {
      expect(text).toContain('ANTES de armar una PRESENTACIÓN')
      expect(text).toContain('EDITABLE (PowerPoint)')
      expect(text).toContain('DISEÑO LIBRE (HTML/CSS)')
      expect(text).toContain('NO se edita')
      expect(text).toContain('Presentar')
      expect(text).toContain('para proyectar')
      expect(text).toContain('¿Cuál preferís?')
    }
  })

  it('no vuelve a preguntar si el formato ya está claro o ya se eligió', () => {
    for (const text of [inline, chatMd]) {
      expect(text).toContain('NO vuelvas a preguntar')
    }
  })

  it('la copia larga y el prompt inline dicen lo mismo sobre las dos opciones', () => {
    const norm = (t: string): string => t.replace(/\\n|\s+|[-•]/g, ' ').replace(/ +/g, ' ')
    expect(norm(inline)).toContain('DISEÑO LIBRE (HTML/CSS)')
    expect(norm(chatMd)).toContain('DISEÑO LIBRE (HTML/CSS)')
  })
})
