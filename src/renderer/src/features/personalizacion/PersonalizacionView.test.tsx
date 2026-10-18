// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillFolderPreview, SkillsState } from '@shared/ipc-extras'
import { CATALOG } from '@shared/catalogo'
import { MCP_CATALOG } from '@shared/mcp-catalog'
import { useUi } from '../../stores/ui'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const invoke = vi.hoisted(() => vi.fn())
vi.mock('../settings/impl/extras', () => ({
  getExtras: () => ({ invoke, on: () => () => undefined }),
  requireExtras: () => ({ invoke, on: () => () => undefined })
}))
vi.mock('../../components/ConfirmDialog', () => ({ confirmDialog: vi.fn(async () => true), promptDialog: vi.fn() }))

import { PersonalizacionView } from './PersonalizacionView'

const ALL_SKILLS: SkillsState = { bundled: CATALOG.skills.map((s) => ({ id: s.id, enabled: true })), user: [] }
const PREVIEW: SkillFolderPreview = {
  token: 'a'.repeat(32),
  folderLabel: 'mi-carpeta',
  name: 'mi-habilidad',
  description: 'Hace algo útil',
  fileCount: 2,
  bytes: 120,
  files: [
    { path: 'SKILL.md', bytes: 80, script: false },
    { path: 'scripts/run.py', bytes: 40, script: true }
  ],
  scripts: ['scripts/run.py'],
  bodyPreview: '# Mi habilidad\n\nPasos.',
  bodyTruncated: false
}

let host: HTMLDivElement
let root: Root
let skillsState: SkillsState
const flush = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}
const click = async (el: Element | null): Promise<void> => {
  if (!el) throw new Error('elemento no encontrado')
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}
const byText = (sel: string, text: string | RegExp): HTMLElement | null =>
  Array.from(host.ownerDocument.querySelectorAll<HTMLElement>(sel)).find((e) =>
    typeof text === 'string' ? e.textContent?.trim() === text : text.test(e.textContent ?? '')
  ) ?? null
/** Escribe en un campo controlado: en este entorno de pruebas los eventos del DOM no llegan a React, así que se llama a su `onChange`. */
const type = async (el: HTMLInputElement, value: string): Promise<void> => {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'))!
  const props = (el as unknown as Record<string, { onChange: (e: unknown) => void }>)[key]
  await act(async () => props.onChange({ target: { value }, currentTarget: { value } }))
}

function setup(over: Record<string, (req?: unknown) => unknown> = {}): void {
  const handlers: Record<string, (req?: unknown) => unknown> = {
    'mcp:getConfig': () => ({ path: '/x/opencode.json', servers: {} }),
    'mcp:catalog': () => ({ items: [...MCP_CATALOG], installed: {}, local: {} }),
    'personalizacion:skills:list': () => skillsState,
    ...over
  }
  invoke.mockImplementation(async (channel: string, req?: unknown) => {
    const h = handlers[channel]
    if (!h) throw new Error(`canal sin manejador: ${channel}`)
    return h(req)
  })
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(createElement(PersonalizacionView))
  })
  await flush()
}

beforeEach(() => {
  vi.unstubAllGlobals()
  localStorage.setItem('lazunox.langPref', 'es')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  skillsState = ALL_SKILLS
  invoke.mockReset()
  useUi.setState({ personalizationTab: 'habilidades', personalizationOpen: true })
  setup()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

describe('Personalización: pestañas y habilidades', () => {
  it('muestra el estado de carga y luego las habilidades incluidas con su etiqueta', async () => {
    let release: (v: SkillsState) => void = () => undefined
    setup({ 'personalizacion:skills:list': () => new Promise<SkillsState>((r) => (release = r)) })
    await act(async () => {
      root.render(createElement(PersonalizacionView))
    })
    await flush()
    expect(document.querySelector('[data-testid="pers-loading"]')).not.toBeNull()
    expect(document.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Cargando Personalización…')
    await act(async () => release(ALL_SKILLS))
    await flush()
    expect(document.querySelector('[data-testid="pers-loading"]')).toBeNull()
    for (const s of CATALOG.skills) expect(document.querySelector(`[data-testid="pers-skill-${s.id}"]`), s.id).not.toBeNull()
    expect(document.body.textContent).toContain('Planillas de Excel')
    expect(document.body.textContent).toContain('Incluida')
    expect(document.body.textContent).toContain('Revisado por Lazunox')
  })

  it('tres pestañas accesibles con ArrowRight y la pestaña activa seleccionada', async () => {
    await mount()
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    expect(tabs.map((t) => t.textContent?.replace(/\d+$/, '').trim())).toEqual(['Habilidades', 'Conectores', 'Tuyos'])
    expect(document.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe('pers-tab-habilidades')
    await act(async () => {
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(useUi.getState().personalizationTab).toBe('conectores')
  })

  it('el buscador filtra (sin tildes ni mayúsculas) y avisa si nada coincide', async () => {
    await mount()
    const input = document.querySelector<HTMLInputElement>('input[type="search"]')!
    await type(input, 'EXCÉL')
    expect(document.querySelector('[data-testid="pers-skill-xlsx"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="pers-skill-docx"]')).toBeNull()
    await type(input, 'zzzz')
    expect(document.querySelector('[data-testid="pers-empty"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Nada coincide con «zzzz»')
    await click(byText('button', 'Borrar la búsqueda'))
    expect(document.querySelector('[data-testid="pers-skill-docx"]')).not.toBeNull()
  })

  it('una habilidad que no existe en el equipo no se ofrece', async () => {
    skillsState = { bundled: ALL_SKILLS.bundled.filter((b) => b.id !== 'pdf'), user: [] }
    await mount()
    expect(document.querySelector('[data-testid="pers-skill-pdf"]')).toBeNull()
    expect(document.querySelector('[data-testid="pers-skill-docx"]')).not.toBeNull()
  })

  it('el detalle de una habilidad dice qué hace, qué permisos pide, ejemplos y la apaga con el interruptor', async () => {
    setup({
      'personalizacion:skills:setEnabled': (req) => {
        const { id, enabled } = req as { id: string; enabled: boolean }
        skillsState = { ...skillsState, bundled: skillsState.bundled.map((b) => (b.id === id ? { ...b, enabled } : b)) }
        return skillsState
      }
    })
    await mount()
    await click(byText('button', 'Documentos de Word'))
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('Qué hace')
    expect(dialog.textContent).toContain('Qué permisos pide')
    expect(dialog.textContent).toContain('Ejemplos de lo que puedes pedir')
    expect(dialog.textContent).toContain('carta formal de renuncia')
    await click(dialog.querySelector('[role="switch"]'))
    expect(invoke).toHaveBeenCalledWith('personalizacion:skills:setEnabled', { id: 'docx', enabled: false })
    expect(document.querySelector('[role="dialog"] [role="switch"]')?.getAttribute('aria-checked')).toBe('false')
  })

  it('Esc cierra el detalle', async () => {
    await mount()
    await click(byText('button', 'Documentos de Word'))
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe('Personalización: instalar una habilidad desde una carpeta', () => {
  it('vista previa con aviso, programas listados y nada se instala sin la casilla', async () => {
    const installed: SkillsState = {
      ...ALL_SKILLS,
      user: [
        { name: 'mi-habilidad', description: 'Hace algo útil', installedAt: 1, fileCount: 2, bytes: 120, hasScripts: true, modified: false }
      ]
    }
    setup({ 'personalizacion:skills:pick': () => PREVIEW, 'personalizacion:skills:install': () => installed })
    await mount()
    await click(document.querySelector('[data-testid="pers-add-folder"]'))
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('Esta habilidad es de terceros')
    expect(dialog.textContent).toContain('scripts/run.py')
    expect(dialog.textContent).toContain('No se ejecutan al instalar')
    expect(dialog.textContent).toContain('# Mi habilidad')
    const install = byText('[role="dialog"] button', 'Instalar') as HTMLButtonElement
    expect(install.disabled).toBe(true)
    expect(document.activeElement?.textContent).toBe('Cancelar') // el foco inicial no instala nada por accidente
    await click(install)
    expect(invoke).not.toHaveBeenCalledWith('personalizacion:skills:install', expect.anything())
    await click(dialog.querySelector('input[type="checkbox"]'))
    expect((byText('[role="dialog"] button', 'Instalar') as HTMLButtonElement).disabled).toBe(false)
    await click(byText('[role="dialog"] button', 'Instalar'))
    expect(invoke).toHaveBeenCalledWith('personalizacion:skills:install', { token: PREVIEW.token })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(useUi.getState().personalizationTab).toBe('tuyos')
    expect(document.body.textContent).toContain('mi-habilidad')
    expect(document.body.textContent).toContain('Instalada')
  })

  it('una carpeta inválida muestra el motivo y no abre nada; cancelar el diálogo no hace nada', async () => {
    setup({
      'personalizacion:skills:pick': () => {
        throw new Error('Falta el archivo SKILL.md en la carpeta.')
      }
    })
    await mount()
    await click(document.querySelector('[data-testid="pers-add-folder"]'))
    expect(document.querySelector('[data-testid="pers-notice"]')?.textContent).toContain('SKILL.md')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    setup({ 'personalizacion:skills:pick': () => null })
    await click(document.querySelector('[data-testid="pers-add-folder"]'))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('Tuyos: una habilidad propia se quita (con confirmación) y las incluidas solo se apagan', async () => {
    skillsState = {
      ...ALL_SKILLS,
      user: [
        {
          name: 'mi-habilidad',
          description: 'Hace algo útil',
          installedAt: 1,
          fileCount: 2,
          bytes: 120,
          hasScripts: false,
          modified: false
        }
      ]
    }
    setup({
      'personalizacion:skills:remove': () => {
        skillsState = { ...ALL_SKILLS, user: [] }
        return skillsState
      }
    })
    useUi.setState({ personalizationTab: 'tuyos' })
    await mount()
    expect(document.body.textContent).toContain('mi-habilidad')
    const row = Array.from(document.querySelectorAll('li')).find((l) => l.textContent?.includes('mi-habilidad'))!
    expect(row.textContent).not.toContain('Revisado por Lazunox') // el sello es solo del catálogo empaquetado
    await click(row.querySelector('button[aria-label^="Quitar la habilidad"]'))
    expect(invoke).toHaveBeenCalledWith('personalizacion:skills:remove', { name: 'mi-habilidad' })
    expect(document.body.textContent).not.toContain('mi-habilidad')
    // las incluidas llevan interruptor, no «Quitar»
    expect(document.querySelectorAll('button[aria-label^="Quitar la habilidad"]').length).toBe(0)
    expect(document.querySelectorAll('[role="switch"]').length).toBe(CATALOG.skills.length)
  })
})

describe('Personalización: conectores', () => {
  it('agrupa por tareas, oculta los grupos vacíos y marca «No conectado»', async () => {
    useUi.setState({ personalizationTab: 'conectores' })
    await mount()
    const headings = Array.from(document.querySelectorAll('h2')).map((h) => h.textContent)
    expect(headings).toEqual(['Correo y calendario', 'Desarrollo', 'Proyectos y notas'])
    expect(document.body.textContent).not.toContain('Contabilidad')
    for (const c of CATALOG.connectors) expect(document.querySelector(`[data-testid="pers-conn-${c.id}"]`), c.id).not.toBeNull()
    expect(document.body.textContent).toContain('No conectado')
    expect(document.body.textContent).not.toMatch(/\bConectado\b(?!.*No conectado)/) // ninguno figura conectado sin el motor
    expect(document.querySelector('[data-testid="pers-add-folder"]')).toBeNull() // «desde una carpeta» es de habilidades
  })

  it('el enlace cruzado lleva a Ajustes › Conectores', async () => {
    useUi.setState({ personalizationTab: 'conectores' })
    await mount()
    await click(byText('button', /Conectores avanzados en Ajustes/))
    expect(useUi.getState().settingsOpen).toBe(true)
    expect(useUi.getState().personalizationOpen).toBe(false)
  })

  it('detalle: qué podrá y qué NO podrá hacer, permisos, ejemplos y verificación', async () => {
    useUi.setState({ personalizationTab: 'conectores' })
    await mount()
    await click(byText('button', 'GitHub'))
    const d = document.querySelector('[role="dialog"]')!
    expect(d.textContent).toContain('Lo que podrá hacer')
    expect(d.textContent).toContain('Lo que NO podrá hacer')
    expect(d.textContent).toContain('Hacer más de lo que permita el token')
    expect(d.textContent).toContain('Necesita una clave de acceso')
    expect(d.textContent).toContain('Se conecta a api.githubcopilot.com')
    expect(d.textContent).toContain('Revisado por Lazunox')
    expect(d.textContent).toContain('Revisado y comprobado el')
    expect(byText('[role="dialog"] button', 'Conectar')).not.toBeNull()
    expect(byText('[role="dialog"] button', 'Quitar')).toBeNull() // no está añadido
  })

  it('paso a paso: el aviso de datos y la casilla «Entiendo» frenan; sin cuenta se conecta desactivado en Tareas y sin secretos', async () => {
    const installs: unknown[] = []
    setup({
      'mcp:installCatalog': (req) => {
        installs.push(req)
        return { path: '/x', servers: {} }
      }
    })
    useUi.setState({ personalizationTab: 'conectores' })
    await mount()
    await click(byText('button', 'Context7'))
    await click(byText('[role="dialog"] button', 'Conectar'))
    let d = document.querySelector('[role="dialog"]')!
    expect(d.textContent).toContain('Conectar Context7')
    expect(d.textContent).toContain('Lee esto')
    expect(d.textContent).toContain('verá tus datos')
    expect(d.textContent).toContain('se lo enviará al modelo')
    expect(d.textContent).toContain('Lo que NO podrá hacer')
    const next = byText('[role="dialog"] button', 'Seguir') as HTMLButtonElement
    expect(next.disabled).toBe(true)
    await click(d.querySelector('input[type="checkbox"]'))
    await click(byText('[role="dialog"] button', 'Seguir'))
    d = document.querySelector('[role="dialog"]')!
    expect(d.textContent).toContain('no necesita cuenta ni clave')
    expect(d.textContent).toContain('queda apagado en Tareas')
    expect(installs).toEqual([])
    await click(byText('[role="dialog"] button', 'Conectar'))
    expect(installs).toEqual([{ id: 'context7', name: 'context7', inputs: {}, enable: true, askEachUse: true }])
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Listo')
  })

  it('con clave: no se envía hasta que el formato es válido y el valor nunca aparece en pantalla', async () => {
    const installs: Array<{ inputs: Record<string, string> }> = []
    setup({
      'mcp:installCatalog': (req) => {
        installs.push(req as { inputs: Record<string, string> })
        return { path: '/x', servers: {} }
      }
    })
    useUi.setState({ personalizationTab: 'conectores' })
    await mount()
    await click(byText('button', 'GitHub'))
    await click(byText('[role="dialog"] button', 'Conectar'))
    await click(document.querySelector('[role="dialog"] input[type="checkbox"]'))
    await click(byText('[role="dialog"] button', 'Seguir'))
    const field = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="password"]')!
    const connect = (): HTMLButtonElement => byText('[role="dialog"] button', 'Conectar') as HTMLButtonElement
    expect(connect().disabled).toBe(true)
    await type(field, 'no-es-un-token')
    expect(connect().disabled).toBe(true)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('no tiene el formato esperado')
    const fake = 'ghp_' + 'A1'.repeat(15)
    await type(field, fake)
    expect(connect().disabled).toBe(false)
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(fake) // ni siquiera en la vista previa de lo que se guarda
    await click(connect())
    expect(installs[0].inputs).toEqual({ token: fake })
  })

  it('con inicio de sesión: explica los pasos, nunca pide la contraseña y no dice «conectado» si falta entrar', async () => {
    setup({ 'mcp:installCatalog': () => ({ path: '/x', servers: {} }) })
    useUi.setState({ personalizationTab: 'conectores' })
    await mount()
    await click(byText('button', 'Notion'))
    await click(byText('[role="dialog"] button', 'Conectar'))
    await click(document.querySelector('[role="dialog"] input[type="checkbox"]'))
    await click(byText('[role="dialog"] button', 'Seguir'))
    const d = document.querySelector('[role="dialog"]')!
    expect(d.textContent).toContain('Entra a tu cuenta')
    expect(d.textContent).toContain('Lazunox nunca ve tu contraseña')
    expect(d.querySelector('input[type="password"]')).toBeNull()
    expect(byText('[role="dialog"] button', /Continuar en Notion/)).not.toBeNull()
  })

  it('dice la verdad: los conectores sin prueba con cuenta real lo avisan en la tarjeta y en el detalle; los demás no', async () => {
    useUi.setState({ personalizationTab: 'conectores' })
    await mount()
    const notion = document.querySelector('[data-testid="pers-conn-notion"]')!
    expect(notion.textContent).toContain('Aún sin probar con una cuenta real')
    expect(notion.textContent).toContain('No conectado') // y nunca «Conectado» por su cuenta
    expect(document.querySelector('[data-testid="pers-conn-github"] [data-testid="pers-untested"]')).toBeNull()
    await click(byText('button', 'Notion'))
    expect(document.querySelector('[role="dialog"] [data-testid="pers-untested-detail"]')?.textContent).toContain(
      'nadie lo ha probado todavía con una cuenta real'
    )
  })

  it('«Ahora no» cierra sin añadir nada', async () => {
    useUi.setState({ personalizationTab: 'conectores' })
    await mount()
    await click(byText('button', 'Context7'))
    await click(byText('[role="dialog"] button', 'Conectar'))
    await click(byText('[role="dialog"] button', 'Ahora no'))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(invoke.mock.calls.some((c) => c[0] === 'mcp:installCatalog')).toBe(false)
  })

  it('un conector añadido y conectado figura «Conectado» y se puede quitar (con confirmación)', async () => {
    let servers: Record<string, unknown> = {
      context7: { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true, oauth: false }
    }
    setup({
      'mcp:getConfig': () => ({ path: '/x', servers }),
      'mcp:catalog': () => ({
        items: [...MCP_CATALOG],
        installed: Object.keys(servers).length ? { context7: { catalogId: 'context7', drift: false } } : {}
      }),
      'mcp:remove': () => {
        servers = {}
        return { path: '/x', servers }
      }
    })
    useUi.setState({ personalizationTab: 'tuyos' })
    await mount()
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('Tuyos')
    await click(byText('button', /^Context7/))
    const d = document.querySelector('[role="dialog"]')!
    expect(byText('[role="dialog"] button', 'Quitar')).not.toBeNull()
    await click(byText('[role="dialog"] button', 'Quitar'))
    expect(invoke).toHaveBeenCalledWith('mcp:remove', { name: 'context7' })
    expect(d.isConnected).toBe(false)
  })
})

describe('Personalización: vacío y error', () => {
  it('Tuyos vacío invita a ver habilidades', async () => {
    setup({ 'personalizacion:skills:list': () => ({ bundled: [], user: [] }) })
    useUi.setState({ personalizationTab: 'tuyos' })
    await mount()
    expect(document.body.textContent).toContain('Todavía no hay nada tuyo aquí')
    await click(byText('button', 'Ver habilidades'))
    expect(useUi.getState().personalizationTab).toBe('habilidades')
  })

  it('error al cargar: mensaje, «Reintentar» y se recupera', async () => {
    let fail = true
    setup({
      'personalizacion:skills:list': () => {
        if (fail) throw new Error('sin conexión con el motor')
        return skillsState
      }
    })
    await mount()
    expect(document.querySelector('[data-testid="pers-error"]')?.textContent).toContain('sin conexión con el motor')
    fail = false
    await click(byText('button', 'Reintentar'))
    expect(document.querySelector('[data-testid="pers-error"]')).toBeNull()
    expect(document.querySelector('[data-testid="pers-skill-docx"]')).not.toBeNull()
  })
})

describe('Personalización: conectores locales (instalan un programa en el equipo)', () => {
  const READY = { platformOk: true, manager: 'uv', managerFound: true }
  const check = async (testId: string, checked: boolean): Promise<void> => {
    const el = document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)!
    const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'))!
    const props = (el as unknown as Record<string, { onChange: (e: unknown) => void }>)[key]
    await act(async () => props.onChange({ target: { checked }, currentTarget: { checked } }))
  }
  const btn = (testId: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!

  async function openWizard(local = { 'google-workspace': READY } as Record<string, unknown>): Promise<void> {
    setup({ 'mcp:catalog': () => ({ items: [...MCP_CATALOG], installed: {}, local }) })
    useUi.setState({ personalizationTab: 'conectores' })
    await mount()
    await click(document.querySelector('[data-testid="pers-conn-google-workspace"] h3 button'))
    await click(byText('[role="dialog"] button', 'Conectar'))
  }

  it('la tarjeta dice que instala un programa y que aún no se probó con una cuenta real', async () => {
    useUi.setState({ personalizationTab: 'conectores' })
    await mount()
    const card = document.querySelector('[data-testid="pers-conn-google-workspace"]')!
    expect(card.textContent).toContain('Instala un programa en tu equipo')
    expect(card.textContent).toContain('Aún sin probar con una cuenta real')
    expect(document.querySelector('[data-testid="pers-conn-microsoft-365"]')!.textContent).toContain('Aún sin probar con una cuenta real')
  })

  it('el detalle muestra autor, licencia, versión fijada, descarga, tamaño, que no hay aislamiento y las herramientas', async () => {
    useUi.setState({ personalizationTab: 'conectores' })
    await mount()
    await click(document.querySelector('[data-testid="pers-conn-google-workspace"] h3 button'))
    const d = document.querySelector('[role="dialog"]')!.textContent ?? ''
    expect(d).toContain('Taylor Wilsdon')
    expect(d).toContain('MIT')
    expect(d).toContain('2.0.1')
    expect(d).toContain('pypi.org')
    expect(d).toContain('230 MB')
    expect(d).toContain('fuera del aislamiento de Overdrive')
    expect(d).toContain('Lazunox no revisó el código')
    expect(d).toContain('Solo consulta')
    expect(d).toContain('Herramientas: 17 se pueden usar y 21 están desactivadas')
    expect(d).toContain('send_gmail_message')
  })

  it('«Seguir» no se habilita hasta marcar LAS DOS casillas, y «Instalar» hasta elegir el archivo del cliente', async () => {
    await openWizard()
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Entiendo que esto instala un programa de un tercero.')
    expect(btn('pers-local-next').disabled).toBe(true)
    await check('pers-local-ack-third', true)
    expect(btn('pers-local-next').disabled).toBe(true)
    await check('pers-local-ack-data', true)
    expect(btn('pers-local-next').disabled).toBe(false)
    await check('pers-local-ack-third', false)
    expect(btn('pers-local-next').disabled).toBe(true)
    await check('pers-local-ack-third', true)
    await click(btn('pers-local-next'))
    expect(btn('pers-local-install').disabled).toBe(true)
    expect(invoke).not.toHaveBeenCalledWith('mcp:installLocal', expect.anything())
  })

  it('elige el archivo (sin ver su contenido), instala con las dos confirmaciones y llega al paso de entrar a la cuenta', async () => {
    const calls: unknown[] = []
    await openWizard()
    setup({
      'mcp:catalog': () => ({ items: [...MCP_CATALOG], installed: {}, local: { 'google-workspace': READY } }),
      'mcp:localPickClient': () => ({ fileName: 'client_secret_1.json', hint: '12345678…' }),
      'mcp:installLocal': (req) => {
        calls.push(req)
        return { path: '/x', servers: {} }
      }
    })
    await check('pers-local-ack-third', true)
    await check('pers-local-ack-data', true)
    await click(btn('pers-local-next'))
    await click(btn('pers-local-pick'))
    expect(document.querySelector('[data-testid="pers-local-picked"]')!.textContent).toContain('client_secret_1.json')
    expect(document.body.textContent).not.toMatch(/GOCSPX|client_secret"/)
    expect(btn('pers-local-install').disabled).toBe(false)
    await click(btn('pers-local-install'))
    expect(calls).toEqual([{ id: 'google-workspace', name: 'google', understandThirdParty: true, understandData: true, askEachUse: true }])
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Conecta mi cuenta de Google')
  })

  it('sin «uv» en el equipo explica qué falta y no deja instalar', async () => {
    await openWizard({ 'google-workspace': { ...READY, managerFound: false } })
    await check('pers-local-ack-third', true)
    await check('pers-local-ack-data', true)
    await click(btn('pers-local-next'))
    expect(document.querySelector('[data-testid="pers-local-need-manager"]')!.textContent).toContain('uv')
    expect(btn('pers-local-install').disabled).toBe(true)
  })
})
