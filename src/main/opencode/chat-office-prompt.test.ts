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
    sha256: 'a962107c3a12a57212b018bd8751c750c34980fd8328707a2c53e42a70f9689a'
  },
  {
    path: 'src/main/opencode/config.ts',
    end: "          'Si eligen la opción HTML/CSS",
    sha256: '6fb78743dc2a2a61f43105e194bc6b9e650b7974809a205ce608ad039014d42e'
  }
])('$path: conserva los bytes de 1.8.21 hasta el final de la regla de formato, sin inserciones previas', ({ path, end, sha256 }) => {
  const source = readFileSync(resolve(root, path), 'utf8')
  const endIndex = source.indexOf(end)
  expect(endIndex).toBeGreaterThan(source.indexOf('REGLA OBLIGATORIA'))
  // Huellas obtenidas de `git show eb0c7a56:<path>`: incluyen TODO el prefijo y la regla completa,
  // no solo palabras clave; no se necesita Git ni lanzar un modelo para detectar una regresión.
  expect(createHash('sha256').update(source.slice(0, endIndex)).digest('hex')).toBe(sha256)
})
