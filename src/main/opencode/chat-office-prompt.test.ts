import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { buildInlineConfig } from './config'

it('la regla de edición de adjuntos coincide literalmente y mantiene la pregunta de formato de presentaciones', () => {
  const raw = readFileSync(resolve(__dirname, '../../../resources/opencode/agents/chat.md'), 'utf8')
  const rule = raw
    .split('\n')
    .find((line) => line.startsWith('- Si el usuario pide editar un Word'))!
    .slice(2)
  const inline = JSON.stringify(buildInlineConfig()).replace(/\\"/g, '"')
  expect(inline).toContain(rule)
  expect(rule).toContain('no lo reconstruyas desde el texto extraído')
  for (const text of [raw, inline].map((s) => s.replace(/\s+/g, ' '))) {
    expect(text).toContain('Hacer esto en Overdrive')
    expect(text).toContain('ANTES de armar una PRESENTACIÓN')
    expect(text).toContain('pregunta de formato y NADA más')
  }
})
