// Contrato de los prompts de agente empaquetados (resources/opencode/agents): siguen siendo válidos y coherentes (F8-B30).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Mismo valor que `ESCALATE_MARKER` de EscalateCard.tsx (el test de la tarjeta lo comprueba por su lado).
const ESCALATE_MARKER = '[[ONYX:NEEDS_FULL_CONTROL]]'
const dir = join(__dirname, '../../../resources/opencode/agents')
const read = (n: string): string => readFileSync(join(dir, `${n}.md`), 'utf8')

describe('prompts de agente', () => {
  it.each(['chat', 'tasks', 'computer'])('%s.md tiene cabecera con descripción y modo primary', (n) => {
    const s = read(n)
    expect(s.startsWith('---\n')).toBe(true)
    const head = s.split('\n---\n')[0]
    expect(head).toMatch(/^description: .+/m)
    expect(head).toMatch(/^mode: primary$/m)
  })

  it('tasks.md pide el marcador neutro que detecta la tarjeta de escalada', () => {
    expect(read('tasks')).toContain(ESCALATE_MARKER)
    expect(read('tasks')).toContain('**Necesita Control total del Mac**')
  })

  it('tasks.md: una sola regla de temporales y una sola de «Pregunta antes de borrar»', () => {
    const s = read('tasks')
    expect((s.match(/^- \*\*Pregunta antes de borrar\*\*/gm) ?? []).length).toBe(1)
    expect(s).not.toMatch(/Usa `\/tmp` solo para archivos temporales/)
    expect((s.match(/Archivos auxiliares/g) ?? []).length).toBeGreaterThanOrEqual(1)
  })

  it('chat.md pide citar las URL de websearch/webfetch', () => {
    expect(read('chat')).toMatch(/cita las fuentes/)
  })

  it('el flujo Plan → Aprobar sigue en computer.md con sus 10 pasos y sin ser contradictorio', () => {
    const s = read('computer')
    for (let i = 1; i <= 10; i++) expect(s).toContain(`\n${i}. `)
    expect(s).toContain('onyxcode-plan-gate')
  })
})
