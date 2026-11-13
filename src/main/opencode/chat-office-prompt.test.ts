import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { buildInlineConfig } from './config'

const root = resolve(__dirname, '../../..')
const raw = readFileSync(resolve(root, 'resources/opencode/agents/chat.md'), 'utf8')
const inline = (buildInlineConfig() as { agent: { chat: { prompt: string } } }).agent.chat.prompt
const rule =
  'Si piden editar un Word, Excel o PowerPoint adjunto, no lo reconstruyas ni lo sustituyas por uno nuevo: indica que la edición del original se hace en Overdrive.'

it('la regla de edición es una sola frase idéntica al final de ambas guías, lejos de las presentaciones', () => {
  expect(raw.trimEnd().split('\n').at(-1)).toBe(`- ${rule}`)
  for (const text of [raw, inline]) {
    expect(text.trimEnd().endsWith(rule)).toBe(true)
    expect(text.split(rule)).toHaveLength(2)
    expect(text).not.toContain('Hacer esto en Overdrive')
    expect(text).not.toContain('Si el usuario pide editar un Word')
    expect(text.indexOf(rule)).toBeGreaterThan(text.indexOf('En TODO bloque de documento'))
    expect(text).toContain('pregunta de formato y NADA más')
  }
})

it.each([
  {
    path: 'resources/opencode/agents/chat.md',
    end: '- Si eligen la opción HTML/CSS',
    sha256: 'a12f124f213ee1af45104f588a3eebd536de4929190df226f30151429411ccdf'
  },
  {
    path: 'src/main/opencode/config.ts',
    end: "          'Si eligen la opción HTML/CSS",
    sha256: '2218fc74e8d4de948ec41a5d4c2db99ddbcab081501e82efa920322259703a70'
  }
])('$path: conserva el prefijo de guía aprobado en V26 y la regla de formato', ({ path, end, sha256 }) => {
  const source = readFileSync(resolve(root, path), 'utf8')
  const endIndex = source.indexOf(end)
  expect(endIndex).toBeGreaterThan(source.indexOf('REGLA OBLIGATORIA'))
  // V26 autoriza identidad propia en las guías. Huellas del prefijo actualizado;
  // la pregunta original de formato se congela además por separado abajo.
  expect(createHash('sha256').update(source.slice(0, endIndex)).digest('hex')).toBe(sha256)
})

// Esta pregunta no está autorizada a cambiar en V26.
it.each([
  {
    path: 'resources/opencode/agents/chat.md',
    end: '- Si eligen la opción HTML/CSS',
    sha256: '36a2050fcd4a0e845d762257a2d3279f8a3f4d8558492887cbd1226415d73c97'
  },
  {
    path: 'src/main/opencode/config.ts',
    end: "          'Si eligen la opción HTML/CSS",
    sha256: '7f00d2ee0cccfee38053e0efb3de7ad9f1a7951bf6ed58d561d2452e97f3efbe'
  }
])('$path: pregunta de formato idéntica a la anterior', ({ path, end, sha256 }) => {
  const source = readFileSync(resolve(root, path), 'utf8')
  expect(
    createHash('sha256')
      .update(source.slice(source.indexOf('REGLA OBLIGATORIA'), source.indexOf(end)))
      .digest('hex')
  ).toBe(sha256)
})
