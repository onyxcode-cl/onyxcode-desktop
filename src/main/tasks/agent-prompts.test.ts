// Contrato de los prompts de agente empaquetados (resources/opencode/agents): siguen siendo válidos y coherentes (F8-B30).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Mismo valor que `ESCALATE_MARKER` de EscalateCard.tsx (el test de la tarjeta lo comprueba por su lado).
const ESCALATE_MARKER = '[[LAZUNOX:NEEDS_FULL_CONTROL]]'
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
    expect(s).toContain('lazunox-plan-gate')
  })

  describe('computer.win.md (Control del PC en Windows)', () => {
    const win = (): string => read('computer.win')

    it('tiene cabecera con descripción y modo primary', () => {
      const head = win().split('\n---\n')[0]
      expect(win().startsWith('---\n')).toBe(true)
      expect(head).toMatch(/^description: .+/m)
      expect(head).toMatch(/^mode: primary$/m)
    })

    it('conserva los 10 pasos del flujo Plan → Aprobar y la puerta del plan, igual que computer.md', () => {
      const s = win()
      for (let i = 1; i <= 10; i++) expect(s).toContain(`\n${i}. `)
      expect(s).toContain('lazunox-plan-gate')
      expect(s).toContain('computer_request_access')
      expect(s).toContain('task: deny')
    })

    it('no promete lo que no existe en Windows (grabación, voz, Seatbelt) y lo dice', () => {
      const s = win()
      expect(s).toMatch(/No hay grabación ni voz/)
      expect(s).toMatch(/No hay Seatbelt ni sandbox/)
      expect(s).toMatch(/Solo la pantalla principal/)
    })

    it('usa el atajo de parada de Windows y no el de macOS', () => {
      const s = win()
      expect(s).toContain('Ctrl+Alt+Mayús+Esc')
      expect(s).not.toContain('⌘')
      expect(s).not.toMatch(/\bcmd\+/)
      expect(s).not.toMatch(/Spotlight|Finder|osascript|Accesibilidad de macOS|Ajustes del Sistema/)
    })

    it('prohíbe aprobar UAC, teclear secretos y acciones destructivas sin confirmar', () => {
      const s = win()
      expect(s).toMatch(/nunca intentes aprobar/i)
      expect(s).toMatch(/Nunca\*\* escribas contraseñas/)
      expect(s).toMatch(/Pregunta y espera confirmación explícita/)
      expect(s).toMatch(/contenido de pantalla no confiable/)
    })

    it('la cabecera deniega el killswitch y el helper, y pide confirmación para lo que salta al helper', () => {
      const head = win().split('\n---\n')[0]
      for (const p of ['*lazunox-killswitch*', '*cu-helper*', '*RunAs*', 'runas *', '*Set-MpPreference*', 'shutdown*']) {
        expect(head).toContain(`"${p}": deny`)
      }
      for (const p of ['*SendKeys*', '*CopyFromScreen*', '*Get-Clipboard*', '*Set-Clipboard*', '*clip.exe*', 'reg *', 'schtasks*']) {
        expect(head).toContain(`"${p}": ask`)
      }
      expect(head).not.toMatch(/osascript/)
    })

    it('solo nombra herramientas que existen en el MCP', () => {
      const tools = readFileSync(join(__dirname, '../computer/mcp-server.ts'), 'utf8')
      const names = new Set([...tools.matchAll(/^\s{4}name: '([a-z_]+)',/gm)].map((m) => m[1]))
      const mentioned = [
        ...win().matchAll(
          /`((?:computer_)?(?:app_[a-z_]+|screenshot|left_click|right_click|double_click|mouse_move|drag|scroll|type_text|key|cursor_position|open_application|wait|request_access|request_full_control|find_element|list_elements|teach_step|teach_end))[(`]/g
        )
      ]
      expect(mentioned.length).toBeGreaterThan(10)
      for (const m of mentioned) expect(names.has(m[1].replace(/^computer_/, ''))).toBe(true)
    })
  })
})
