// Contrato de los prompts de agente empaquetados (resources/opencode/agents): siguen siendo válidos y coherentes (F8-B30).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { UNIFIED_APPS_PROMPT, writeUnifiedAppsPrompt } from './unified-apps-prompt'

// Mismo valor que `ESCALATE_MARKER` de EscalateCard.tsx (el test de la tarjeta lo comprueba por su lado).
const ESCALATE_MARKER = '[[LAZUNOX:NEEDS_FULL_CONTROL]]'
const dir = join(__dirname, '../../../resources/opencode/agents')
// El agente de Windows vive fuera de `agents/` (esa carpeta se copia entera a userData y opencode-config.test.ts vigila su contenido).
const winDir = join(__dirname, '../../../resources/opencode/agents-win')
const read = (n: string): string => readFileSync(join(n === 'computer.win' ? winDir : dir, `${n}.md`), 'utf8')

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

  it('la instrucción del modo unificado conserva la salida a «El computador completo» y pide el nivel justo por app', () => {
    expect(UNIFIED_APPS_PROMPT).toContain(ESCALATE_MARKER)
    expect(UNIFIED_APPS_PROMPT).toContain('control completo del ordenador')
    expect(UNIFIED_APPS_PROMPT).toContain('como última línea')
    expect(UNIFIED_APPS_PROMPT).toContain('Pide el nivel justo POR APP')
    expect(UNIFIED_APPS_PROMPT).toContain('basta para manejar ESA app')
    expect(UNIFIED_APPS_PROMPT).toContain('No pidas control de todo el equipo para algo que es de una sola app')
    expect(UNIFIED_APPS_PROMPT).toContain('No cambies tú el modo')
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

  it('computer.md y computer.win.md: documentos/archivos/web no usan ratón ni apps, y full_control solo tras fallo real', () => {
    for (const n of ['computer', 'computer.win']) {
      const t = read(n)
      expect(t).toContain('NO uses el ratón ni el teclado ni listes aplicaciones')
      expect(t).toContain('`apps: []`')
      expect(t).toContain('«verificarlo»')
      expect(t).toContain('tras un fallo real de las herramientas `app_*`')
    }
  })

  it('computer.md y computer.win.md: una app bloqueada no se rodea (ni se vuelve a pedir)', () => {
    for (const n of ['computer', 'computer.win']) {
      const t = read(n)
      expect(t).toContain('Una app bloqueada no se rodea')
      expect(t).toContain('no la pidas de nuevo')
      expect(t).toContain('otra aplicación, un comando')
    }
  })

  it('tasks.md: NEEDS_APP y OPEN_FOLDER, con la regla de la última línea', () => {
    const t = read('tasks')
    expect(t).toContain('[[LAZUNOX:NEEDS_APP:<nombre de la app>]]')
    expect(t).toContain('[[LAZUNOX:OPEN_FOLDER]]')
    expect(t).toContain('lo último que escribes')
    expect(t.replace(/\s+/g, ' ')).toContain('Cambiar a El computador completo y continuar')
    expect(t).toContain('Abrir o mostrar SU carpeta no es una razón para escalar')
  })

  it('tasks.md dice DÓNDE está el permiso de borrar (texto exacto del glosario)', () => {
    const t = read('tasks')
    expect(t).toContain('botón **Proyecto e instrucciones**')
    expect(t).toContain('pestaña **Proyecto** › sección **Carpeta**')
    expect(t.replace(/\s+/g, ' ')).toContain('interruptor **Permitir borrar, mover y renombrar**')
    expect(t).toContain('tarjeta amarilla')
  })

  it('tasks.md: la ruta que cita al permiso de borrar existe en la interfaz (etiquetas exactas, es)', async () => {
    const { DICTIONARIES } = await import('../../shared/i18n')
    const es = DICTIONARIES.es
    const t = read('tasks').replace(/\s+/g, ' ')
    const tasksPanel = readFileSync(join(__dirname, '../../renderer/src/features/tasks/impl/ProjectPanel.tsx'), 'utf8')
    const deleteGrant = readFileSync(join(__dirname, '../../renderer/src/features/tasks/impl/DeleteGrant.tsx'), 'utf8')
    const sidebar = readFileSync(join(__dirname, '../../renderer/src/features/tasks/impl/TasksSidebar.tsx'), 'utf8')
    const label = (k: string): string => es[k] as string
    // Cada tramo citado es exactamente la etiqueta que ve la persona...
    expect(t).toContain(`**${label('tasks.sidebar.project')}**`)
    expect(t).toContain(`pestaña **${label('tasks.proj.tabProject')}**`)
    expect(t).toContain(`sección **${label('tasks.proj.folder')}**`)
    expect(t).toContain(`**${label('tasksSettings.glossary.deleteGrant')}**`)
    // ...y el código los pinta donde dice: botón del libro en la barra, pestaña, sección «Carpeta» con el interruptor.
    expect(sidebar).toContain("t('tasks.sidebar.project')")
    expect(tasksPanel).toContain("t('tasks.proj.tabProject')")
    expect(tasksPanel).toMatch(/t\('tasks\.proj\.folder'\)\}<\/span>\s*<DeleteGrantToggle \/>/)
    expect(deleteGrant).toContain('TASKS_TERMS.deleteGrant')
  })

  it('tasks.md acota la escalada a una petición explícita', () => {
    const t = read('tasks')
    expect(t).toContain('pidió explícitamente manejar OTRA aplicación')
    expect(t).toContain('NO escales')
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

describe('instrucción de apps del modo unificado', () => {
  it('tasks.md no la contiene (sin bandera el prompt del agente es el de siempre)', () => {
    expect(read('tasks')).not.toContain('computer_request_access')
  })

  it('el archivo de instrucciones trae lo esencial y no nombra otros productos', () => {
    const t = UNIFIED_APPS_PROMPT
    for (const x of [
      'computer_*',
      'computer_request_access',
      'CADA app',
      'por app y por nivel',
      'bloqueadas no se pueden usar de ninguna forma',
      'solo hay accesibilidad',
      'computer_app_screenshot',
      'captura de pantalla completa'
    ]) {
      expect(t).toContain(x)
    }
    expect(t).toContain('ratón y el teclado reales')
    expect(t).not.toMatch(/paridad|mejor que/i)
  })

  it('writeUnifiedAppsPrompt escribe el archivo y devuelve su ruta', () => {
    const d = mkdtempSync(join(tmpdir(), 'unif-prompt-'))
    try {
      const p = writeUnifiedAppsPrompt(d)
      expect(p).toBe(join(d, 'unified-apps.md'))
      expect(readFileSync(p!, 'utf8')).toBe(UNIFIED_APPS_PROMPT)
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })
})
