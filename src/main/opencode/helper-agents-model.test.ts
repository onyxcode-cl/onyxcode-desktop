/**
 * Modelo de los ayudantes de la app (PLAN-OLA-A §2.6, decisión D6): `lazunox-helper` y `lazunox-chat-helper`
 * deben declarar `model:` explícito en el frontmatter, con `inherit` (el de la conversación) o `small`.
 * Sin la clave, el motor los dejaría heredar sin que nadie lo haya decidido por escrito.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const AGENTS_DIR = join(__dirname, '../../../resources/opencode/agents')

/** Devuelve las líneas de nivel superior del frontmatter (entre el primer `---` y el siguiente). */
function frontmatterLines(file: string): string[] {
  const text = readFileSync(join(AGENTS_DIR, file), 'utf8')
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
  expect(m, `${file} debe tener frontmatter entre ---`).not.toBeNull()
  return m![1].split(/\r?\n/)
}

/** Valor de la clave `model` de nivel superior, o `undefined` si no existe. */
function modelOf(file: string): string | undefined {
  const line = frontmatterLines(file).find((l) => /^model:/.test(l))
  return line === undefined ? undefined : line.replace(/^model:/, '').trim()
}

describe('modelo de los ayudantes de la app (D6 = inherit)', () => {
  for (const file of ['lazunox-helper.md', 'lazunox-chat-helper.md']) {
    it(`${file} declara model explícito (inherit o small)`, () => {
      const model = modelOf(file)
      expect(model, `${file} no tiene la clave model`).toBeDefined()
      expect(['inherit', 'small']).toContain(model)
    })

    it(`${file} documenta por qué no fija un proveedor/modelo concreto`, () => {
      const lines = frontmatterLines(file)
      const idx = lines.findIndex((l) => /^model:/.test(l))
      // La línea de comentario YAML va justo encima de `model:` y explica la decisión.
      expect(idx).toBeGreaterThan(0)
      expect(lines[idx - 1]).toMatch(/^# .*PLAN-OLA-A/)
    })
  }

  it('ninguno de los dos fija un proveedor/modelo concreto', () => {
    for (const file of ['lazunox-helper.md', 'lazunox-chat-helper.md']) {
      expect(modelOf(file)).not.toMatch(/\//)
    }
  })
})
