import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildInlineConfig, CHAT_HELPER_AGENT, CHAT_READ_SENTINEL } from './config'

describe('buildInlineConfig (sidecar principal)', () => {
  it('fija share:disabled y autoupdate:false, con y sin navegador', () => {
    for (const browserMcp of [null, { type: 'remote', url: 'http://127.0.0.1:1/mcp' }]) {
      const c = buildInlineConfig({ browserMcp })
      expect(c.share).toBe('disabled')
      expect(c.autoupdate).toBe(false)
    }
    expect(buildInlineConfig().share).toBe('disabled')
  })

  it('conectores en Code (F8-B203): el bloque `permission` va tal cual y solo si trae reglas; el agente chat sigue con su deny', () => {
    expect(buildInlineConfig()).not.toHaveProperty('permission')
    expect(buildInlineConfig({ permission: {} })).not.toHaveProperty('permission')
    const permission = { 'crm_*': 'ask', 'gmail_*': 'allow', 'gmail_send *': 'deny' }
    const c = buildInlineConfig({ permission }) as {
      permission: Record<string, string>
      agent: { chat: { permission: Record<string, unknown> } }
    }
    expect(Object.entries(c.permission)).toEqual(Object.entries(permission))
    // Sin reglas de bash/edit: esas viven en el bloque de modo de cada sesión.
    expect(Object.keys(c.permission).some((k) => /^(bash|edit|write|read|webfetch|task)$/.test(k))).toBe(false)
    expect(c.agent.chat.permission['*']).toBe('deny')
  })

  it('bgshell (F8-B204): `mcp.bgshell` junto al navegador, solo si hay bloque', () => {
    const bgshellMcp = { type: 'local', command: ['/n', '/s.cjs'] }
    const browserMcp = { type: 'remote', url: 'http://127.0.0.1:1/mcp' }
    expect(buildInlineConfig({ bgshellMcp })).toMatchObject({ mcp: { bgshell: bgshellMcp } })
    expect(buildInlineConfig({ bgshellMcp, browserMcp })).toMatchObject({ mcp: { bgshell: bgshellMcp, browser: browserMcp } })
    expect(buildInlineConfig({ bgshellMcp: null, browserMcp: null })).not.toHaveProperty('mcp')
    expect((buildInlineConfig({ browserMcp }) as { mcp: object }).mcp).not.toHaveProperty('bgshell')
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
      expect(text).toContain('¿Cuál prefieres?')
    }
  })

  it('no vuelve a preguntar si el formato ya está claro o ya se eligió', () => {
    for (const text of [inline, chatMd]) {
      expect(text).toContain('NO vuelvas a preguntar')
    }
  })

  it('trae ejemplos concretos de pedidos que siempre deben recibir la pregunta', () => {
    for (const text of [inline, chatMd]) {
      expect(text).toContain('REGLA OBLIGATORIA')
      expect(text).toContain('un PPT de X')
      expect(text).toContain('una presentación en PowerPoint de X')
    }
  })

  it('decir solo «PowerPoint», «PPT» o «PPTX» NO cuenta como elegir: sigue preguntando', () => {
    for (const text of [inline.replace(/\\"/g, '"'), chatMd]) {
      expect(text).toContain('decir solo "PowerPoint", "PPT" o "PPTX" NO alcanza')
      expect(text).not.toMatch(/"PowerPoint", "\.pptx" → pptx/)
    }
  })

  it('la copia larga y el prompt inline dicen lo mismo sobre las dos opciones', () => {
    const norm = (t: string): string => t.replace(/\\n|\s+|[-•]/g, ' ').replace(/ +/g, ' ')
    expect(norm(inline)).toContain('DISEÑO LIBRE (HTML/CSS)')
    expect(norm(chatMd)).toContain('DISEÑO LIBRE (HTML/CSS)')
  })

  it('la pregunta de formato se hace con la herramienta `question` (dos opciones) y hay respaldo en texto', () => {
    for (const text of [inline.replace(/\\"/g, '"'), chatMd]) {
      expect(text).toContain('CON LA HERRAMIENTA `question`')
      expect(text).toContain('header «Formato»')
      expect(text).toContain('«Editable (PowerPoint)»')
      expect(text).toContain('«Diseño libre (HTML/CSS)»')
      expect(text).toContain('multiple:false')
      expect(text).toContain('no está disponible')
    }
  })

  it('el agente chat permite `question` y sigue denegando todo lo demás', () => {
    const chat = (buildInlineConfig() as { agent: { chat: { permission: Record<string, unknown> } } }).agent.chat
    expect(chat.permission).toMatchObject({ '*': 'deny', webfetch: 'allow', websearch: 'allow', question: 'allow' })
    expect(Object.keys(chat.permission).sort()).toEqual(['*', 'question', 'read', 'webfetch', 'websearch'])
    expect(chatMd).toMatch(/permission: "\*": deny webfetch: allow websearch: allow question: allow/)
  })

  // Regresión: el modelo gratuito de OpenCode responde 403 FreeTierError a toda petición cuya lista de herramientas
  // no incluya `read`. El motor quita del request la herramienta cuya última regla es `"*": deny`.
  it('`read` sigue anunciado (última regla distinta de "*") pero no puede leer ninguna ruta real', () => {
    const chat = (buildInlineConfig() as { agent: { chat: { permission: { read: Record<string, string> } } } }).agent.chat
    const rules = Object.entries(chat.permission.read)
    expect(rules[0]).toEqual(['*', 'deny'])
    const last = rules[rules.length - 1]
    expect(last[0]).not.toBe('*')
    expect(last).toEqual([CHAT_READ_SENTINEL, 'allow'])
    expect(CHAT_READ_SENTINEL.startsWith('/')).toBe(true)
    expect(CHAT_READ_SENTINEL).not.toMatch(/[*?]/)
    expect(chatMd).toContain(`read: "*": deny "${CHAT_READ_SENTINEL}": allow`)
  })
})

describe('Chat: subagentes (F8-B206)', () => {
  type ChatPerm = Record<string, unknown>
  const chatPerm = (chatSubagents?: boolean): ChatPerm =>
    (buildInlineConfig({ chatSubagents }) as { agent: { chat: { permission: ChatPerm } } }).agent.chat.permission
  const helperMd = readFileSync(resolve(__dirname, '../../../resources/opencode/agents/lazunox-chat-helper.md'), 'utf8')

  it('apagado (por defecto): sin `task`, como siempre', () => {
    expect(chatPerm()).not.toHaveProperty('task')
    expect(chatPerm(false)).not.toHaveProperty('task')
  })

  it('encendido: `task` solo para lazunox-chat-helper (lista blanca, no allow global) y lo demás igual', () => {
    const p = chatPerm(true)
    expect(Object.entries(p.task as Record<string, string>)).toEqual([
      ['*', 'deny'],
      [CHAT_HELPER_AGENT, 'allow']
    ])
    const { task: _t, ...rest } = p
    expect(rest).toEqual(chatPerm(false))
  })

  it('el ayudante tiene EXACTAMENTE los permisos del Chat salvo `question` (no escala nada) y no lanza subagentes', () => {
    const head = helperMd
      .split('\n---\n')[0]!
      .replace(/\s*#.*$/gm, '')
      .replace(/\s+/g, ' ')
    expect(head).toContain('mode: subagent')
    expect(head).toContain(`permission: "*": deny webfetch: allow websearch: allow read: "*": deny "${CHAT_READ_SENTINEL}": allow`)
    expect(head).not.toMatch(/\b(task|bash|edit|write|question|glob|grep|list):/)
    expect(CHAT_HELPER_AGENT).toBe('lazunox-chat-helper')
  })
})
