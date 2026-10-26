import { describe, expect, it } from 'vitest'
import {
  buildHelperFile,
  checkHelperName,
  claudeAgentLabel,
  parseHelperList,
  readHelperFile,
  RESERVED_HELPER_NAMES,
  summarizeRules,
  validateHelperDef,
  type HelperDef
} from './helper-agents'

const DEF: HelperDef = {
  name: 'revisor-de-copias',
  description: 'Revisa copias de seguridad',
  prompt: 'Eres un revisor.\nSé breve.',
  model: 'small',
  allowedTools: ['Read', 'Grep'],
  disallowedTools: ['edit', 'bash'],
  maxTurns: 5,
  background: true,
  skills: ['uno', 'dos']
}

describe('nombres de ayudantes', () => {
  it('acepta nombres de archivo válidos', () => {
    for (const n of ['a', 'Mi-ayudante', 'x_1', 'a.b', '9lives', 'lector.v2']) expect(checkHelperName(n), n).toEqual({ ok: true })
  })
  it('rechaza rutas, vacíos, puntos al borde, extensión .md y exceso', () => {
    for (const n of [
      '',
      '.oculto',
      '-x',
      '_x',
      'a/b',
      'a\\b',
      '../x',
      'a..b',
      'a.',
      'a.md',
      'A.MD',
      'con espacio',
      'ñ',
      'a'.repeat(65),
      'a\0b',
      'a\nb'
    ])
      expect(checkHelperName(n), JSON.stringify(n)).toEqual({ ok: false, reason: expect.any(String) })
    expect(checkHelperName(undefined)).toMatchObject({ ok: false })
    expect(checkHelperName(7)).toMatchObject({ ok: false })
  })
  it('los once nombres reservados no se pueden usar, tampoco con otras mayúsculas', () => {
    expect([...RESERVED_HELPER_NAMES].sort()).toEqual(
      [
        'build',
        'chat',
        'computer',
        'explore',
        'general',
        'lazunox-chat-helper',
        'lazunox-helper',
        'plan',
        'revisor',
        'tasks',
        'verificador'
      ].sort()
    )
    for (const n of RESERVED_HELPER_NAMES) {
      expect(checkHelperName(n)).toEqual({ ok: false, reason: 'reserved' })
      expect(checkHelperName(n.toUpperCase())).toEqual({ ok: false, reason: 'reserved' })
    }
  })
})

describe('lista del motor (GET /agent)', () => {
  const raw = [
    { name: 'build', mode: 'primary', native: true, permission: [] },
    { name: 'oculto', mode: 'subagent', hidden: true, permission: [] },
    {
      name: 'explore',
      mode: 'subagent',
      native: true,
      description: 'Busca‮ en el código\u0000',
      permission: [
        { permission: '*', pattern: '*', action: 'deny' },
        { permission: 'read', pattern: '*', action: 'allow' },
        { permission: 'grep', pattern: '*', action: 'allow' }
      ],
      steps: 12
    },
    {
      name: 'mio',
      mode: 'all',
      description: '# Titular [enlace](https://x.test)\nsegunda línea',
      modelSmall: true,
      background: true,
      skills: ['uno', 3],
      permission: [
        { permission: '*', pattern: '*', action: 'allow' },
        { permission: 'edit', pattern: '*', action: 'deny' },
        { permission: 'bash', pattern: 'rm *', action: 'deny' }
      ]
    },
    { name: 'otro', mode: 'subagent', model: { providerID: 'opencode-go', modelID: 'flash' }, permission: 'basura' },
    { nombre: 'sin-name' },
    null
  ]
  it('deja solo ayudantes visibles y resume modelo, herramientas y turnos', () => {
    const list = parseHelperList(raw)
    expect(list.map((h) => h.name)).toEqual(['explore', 'mio', 'otro'])
    const explore = list[0]!
    expect(explore).toMatchObject({
      native: true,
      whitelist: true,
      allowedTools: ['grep', 'read'],
      blockedTools: [],
      maxTurns: 12,
      model: 'inherit'
    })
    const mio = list[1]!
    expect(mio).toMatchObject({
      model: 'small',
      background: true,
      whitelist: false,
      blockedTools: ['edit'],
      skills: ['uno'],
      maxTurns: null
    })
    expect(list[2]!.model).toBe('opencode-go/flash')
  })
  it('los textos son planos: sin controles ni marcas de dirección, en una sola línea', () => {
    const list = parseHelperList(raw)
    expect(list[0]!.description).toBe('Busca en el código')
    // El Markdown se conserva como texto literal (la interfaz lo pinta sin interpretarlo), pero sin saltos de línea.
    expect(list[1]!.description).toBe('# Titular [enlace](https://x.test) segunda línea')
  })
  it('algo que no es una lista -> vacío', () => {
    for (const v of [null, undefined, {}, 'x', 3]) expect(parseHelperList(v)).toEqual([])
  })
  it('summarizeRules: gana la última regla de patrón * de cada herramienta', () => {
    expect(
      summarizeRules([
        { permission: 'edit', pattern: '*', action: 'deny' },
        { permission: 'edit', pattern: '*', action: 'allow' },
        { permission: 'bash', pattern: 'ls', action: 'deny' }
      ])
    ).toEqual({ allowed: [], blocked: [], whitelist: false })
  })
})

describe('archivo .md: construir', () => {
  it('crea un encabezado completo con mode: subagent y el cuerpo', () => {
    const text = buildHelperFile(DEF)!
    expect(text).toBe(
      [
        '---',
        'description: "Revisa copias de seguridad"',
        'mode: subagent',
        'model: small',
        'tools: [Read, Grep]',
        'disallowed_tools: [edit, bash]',
        'max_turns: 5',
        'background: true',
        'skills: [uno, dos]',
        '---',
        'Eres un revisor.',
        'Sé breve.',
        ''
      ].join('\n')
    )
  })
  it('sin tope, sin segundo plano y sin skills no escribe esas claves', () => {
    const text = buildHelperFile({
      ...DEF,
      maxTurns: null,
      background: false,
      skills: null,
      disallowedTools: [],
      allowedTools: [],
      model: 'inherit'
    })!
    expect(text).not.toMatch(/max_turns|background|skills|disallowed_tools|tools/)
    expect(text).toContain('model: inherit')
  })
  it('una descripción con comillas, dos puntos o # queda como una sola cadena YAML (no inyecta claves)', () => {
    const desc = 'x"\ny: z # no\u0000'
    const text = buildHelperFile({ ...DEF, description: desc.replace(/\n/g, ' ') })!
    const back = readHelperFile(DEF.name, text)
    expect(back.ok && back.def.description).toBe(desc.replace(/\n/g, ' '))
    expect(text.split('\n').filter((l) => l.startsWith('y:'))).toEqual([])
  })
  it('un cuerpo que empieza por --- no rompe el encabezado', () => {
    const text = buildHelperFile({ ...DEF, prompt: '---\nrojo: 1\n---\nhola' })!
    const back = readHelperFile(DEF.name, text)
    expect(back.ok && back.def.prompt).toBe('---\nrojo: 1\n---\nhola')
    expect(back.ok && back.def.model).toBe('small')
  })
})

describe('archivo .md: leer y editar conservando lo demás', () => {
  const ORIGINAL = [
    '---',
    'description: Hace cosas',
    'color: "#ff0000"',
    'mode: subagent',
    'permission:',
    '  bash: ask',
    '  edit:',
    '    "src/**": allow',
    'model: opencode-go/flash',
    'max_turns: 3',
    'disallowed_tools:',
    '  - edit',
    '  - write',
    '---',
    '',
    'Cuerpo original',
    ''
  ].join('\n')

  it('lee los campos gestionados (escalares y listas de las dos formas)', () => {
    const r = readHelperFile('hace', ORIGINAL)
    expect(r.ok && r.def).toMatchObject({
      name: 'hace',
      description: 'Hace cosas',
      model: 'opencode-go/flash',
      maxTurns: 3,
      disallowedTools: ['edit', 'write'],
      background: false,
      skills: null,
      prompt: 'Cuerpo original'
    })
    const inline = readHelperFile('x', '---\nskills: [a, "b"]\nbackground: true\n---\nx\n')
    expect(inline.ok && inline.def.skills).toEqual(['a', 'b'])
    expect(inline.ok && inline.def.background).toBe(true)
  })

  it('al editar conserva TAL CUAL las claves ajenas (permission anidado, color) y su orden', () => {
    const r = readHelperFile('hace', ORIGINAL)
    expect(r.ok).toBe(true)
    const edited = buildHelperFile({ ...(r.ok ? r.def : DEF), name: 'hace', maxTurns: 9, prompt: 'Nuevo cuerpo' }, ORIGINAL)!
    expect(edited).toContain('color: "#ff0000"')
    expect(edited).toContain('permission:\n  bash: ask\n  edit:\n    "src/**": allow')
    expect(edited).toContain('max_turns: 9')
    expect(edited).not.toContain('max_turns: 3')
    expect(edited.endsWith('---\nNuevo cuerpo\n')).toBe(true)
    // El orden original de las claves se respeta.
    expect(edited.indexOf('color:')).toBeLessThan(edited.indexOf('permission:'))
    expect(edited.indexOf('permission:')).toBeLessThan(edited.indexOf('model:'))
  })

  it('quitar el tope borra max_turns; añadir una clave gestionada nueva la agrega', () => {
    const edited = buildHelperFile(
      { ...DEF, name: 'hace', maxTurns: null, background: true, skills: ['a'], disallowedTools: [], allowedTools: [], model: 'inherit' },
      ORIGINAL
    )!
    expect(edited).not.toContain('max_turns')
    expect(edited).not.toContain('disallowed_tools')
    expect(edited).toContain('background: true')
    expect(edited).toContain('skills: [a]')
  })

  it('formatos que no sabe editar (valores multilínea, objetos, repetidos): no los reescribe', () => {
    const multi = '---\ndescription: >\n  largo\n  texto\n---\nx\n'
    expect(readHelperFile('x', multi)).toMatchObject({ ok: false, reason: 'complex', complex: ['description'] })
    const obj = '---\nmodel: {a: 1}\n---\nx\n'
    expect(readHelperFile('x', obj)).toMatchObject({ ok: false, reason: 'complex' })
    const dup = '---\nmodel: small\nmodel: inherit\n---\nx\n'
    expect(readHelperFile('x', dup)).toMatchObject({ ok: false, reason: 'complex' })
    const badTurns = '---\nmax_turns: muchos\n---\nx\n'
    expect(readHelperFile('x', badTurns)).toMatchObject({ ok: false, reason: 'complex', complex: ['max_turns'] })
  })

  it('sin encabezado válido -> format; nombre inválido -> name', () => {
    expect(readHelperFile('x', 'solo texto')).toEqual({ ok: false, reason: 'format' })
    expect(readHelperFile('x', '---\nsin cierre\n')).toEqual({ ok: false, reason: 'format' })
    expect(readHelperFile('../x', '---\n---\n')).toEqual({ ok: false, reason: 'name' })
    expect(buildHelperFile(DEF, 'sin encabezado')).toBeNull()
  })

  it('el modo del archivo existente se conserva (primary/all) y uno raro se rechaza', () => {
    const all = '---\nmode: all\n---\nx\n'
    expect(buildHelperFile(DEF, all)).toContain('mode: all')
    expect(buildHelperFile(DEF, '---\nmode: "{x}"\n---\nx\n')).toBeNull()
  })

  it('CRLF se normaliza', () => {
    const r = readHelperFile('x', '---\r\nmodel: small\r\n---\r\nhola\r\n')
    expect(r.ok && r.def).toMatchObject({ model: 'small', prompt: 'hola' })
  })
})

describe('herramientas permitidas (tools)', () => {
  it('se escriben como lista y se leen de vuelta', () => {
    const text = buildHelperFile({ ...DEF, allowedTools: ['Read', 'mcp__srv__tool', '*'] })!
    expect(text).toContain('tools: [Read, mcp__srv__tool, "*"]')
    const back = readHelperFile(DEF.name, text)
    expect(back.ok && back.def.allowedTools).toEqual(['Read', 'mcp__srv__tool', '*'])
  })
  it('lee el formato de Claude Code (cadena con comas) y la lista en varias líneas', () => {
    const a = readHelperFile('x', '---\ntools: Read, Grep, Glob\n---\nx\n')
    expect(a.ok && a.def.allowedTools).toEqual(['Read', 'Grep', 'Glob'])
    const b = readHelperFile('x', '---\ntools:\n  - Read\n  - Bash\n---\nx\n')
    expect(b.ok && b.def.allowedTools).toEqual(['Read', 'Bash'])
    const none = readHelperFile('x', '---\nmodel: small\n---\nx\n')
    expect(none.ok && none.def.allowedTools).toEqual([])
  })
  it('una lista con nombres raros o demasiado larga no se edita aquí (complex)', () => {
    expect(readHelperFile('x', '---\ntools: "Re ad"\n---\nx\n')).toMatchObject({ ok: false, reason: 'complex', complex: ['tools'] })
    expect(readHelperFile('x', '---\ntools: {a: 1}\n---\nx\n')).toMatchObject({ ok: false, reason: 'complex', complex: ['tools'] })
    const many = Array.from({ length: 31 }, (_, i) => `t${i}`).join(', ')
    expect(readHelperFile('x', `---\ntools: ${many}\n---\nx\n`)).toMatchObject({ ok: false, reason: 'complex' })
  })
  it('al editar reemplaza `tools` en su sitio y conserva permission; vaciarla la quita', () => {
    const orig = '---\ndescription: d\ntools: Read\npermission:\n  bash: ask\nmodel: small\n---\nx\n'
    const edited = buildHelperFile({ ...DEF, name: 'x', allowedTools: ['Read', 'Grep'] }, orig)!
    expect(edited).toContain('tools: [Read, Grep]')
    expect(edited).not.toContain('tools: Read\n')
    expect(edited).toContain('permission:\n  bash: ask')
    expect(edited.indexOf('tools:')).toBeLessThan(edited.indexOf('permission:'))
    const cleared = buildHelperFile({ ...DEF, name: 'x', allowedTools: [] }, orig)!
    expect(cleared).not.toMatch(/^tools:/m)
    expect(cleared).toContain('permission:\n  bash: ask')
  })
})

describe('validar la definición', () => {
  it('acepta la definición completa', () => {
    expect(validateHelperDef(DEF)).toEqual({ ok: true })
  })
  it.each([
    ['name', { name: '../x' }],
    ['description', { description: 'a\nb' }],
    ['description', { description: 'x'.repeat(501) }],
    ['prompt', { prompt: 'x'.repeat(32_001) }],
    ['model', { model: 'raro' }],
    ['model', { model: 'a/b c' }],
    ['disallowedTools', { disallowedTools: ['ed it'] }],
    ['disallowedTools', { disallowedTools: ['x\ny: 1'] }],
    ['allowedTools', { allowedTools: ['Re ad'] }],
    ['allowedTools', { allowedTools: ['x\ny: 1'] }],
    ['allowedTools', { allowedTools: ['a:b'] }],
    ['allowedTools', { allowedTools: ['a'.repeat(65)] }],
    ['allowedTools', { allowedTools: Array.from({ length: 31 }, (_, i) => `t${i}`) }],
    ['maxTurns', { maxTurns: 0 }],
    ['maxTurns', { maxTurns: 1.5 }],
    ['maxTurns', { maxTurns: 1001 }],
    ['skills', { skills: ['a,b'] }]
  ])('rechaza %s', (field, over) => {
    expect(validateHelperDef({ ...DEF, ...over } as HelperDef)).toEqual({ ok: false, field })
  })
  it('acepta modelos proveedor/modelo', () => {
    expect(validateHelperDef({ ...DEF, model: 'opencode-go/deepseek-v4.1-flash' })).toEqual({ ok: true })
    expect(validateHelperDef({ ...DEF, model: 'inherit' })).toEqual({ ok: true })
  })
})

describe('.claude/agents', () => {
  it('solo .md con nombre razonable, en texto plano', () => {
    expect(claudeAgentLabel('lector.md')).toBe('lector')
    expect(claudeAgentLabel('README.txt')).toBeNull()
    expect(claudeAgentLabel('.md')).toBeNull()
    expect(claudeAgentLabel(`${'a'.repeat(65)}.md`)).toBeNull()
    expect(claudeAgentLabel('hola‮mundo.md')).toBe('holamundo')
  })
})
