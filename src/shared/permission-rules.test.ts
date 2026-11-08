import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  approvalKindOf,
  effectiveModeFor,
  endsWithRuleset,
  isAutoApprovableCommand,
  rulesetForMode,
  type PermissionModeId,
  type PermissionRuleLike,
  type RuleAction
} from './permission-rules'

/** Simulador del motor 1.19.0 (verificado en el motor real): comodines en permiso y patrón, gana la ÚLTIMA regla; sin coincidencia, pregunta. */
function wild(text: string, pattern: string): boolean {
  let re = '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
  if (re.endsWith(' .*$')) re = re.slice(0, -4) + '( .*)?$'
  return new RegExp(re, 's').test(text)
}
function evaluate(permission: string, pattern: string, ...sets: PermissionRuleLike[][]): RuleAction {
  const hit = sets.flat().findLast((r) => wild(permission, r.permission) && wild(pattern, r.pattern))
  return hit?.action ?? 'ask'
}
/** Reglas del agente `build` del motor (valores por defecto que ve la sesión antes de las suyas). */
const BUILD: PermissionRuleLike[] = [
  { permission: '*', pattern: '*', action: 'allow' },
  { permission: 'doom_loop', pattern: '*', action: 'ask' },
  { permission: 'external_directory', pattern: '*', action: 'ask' },
  { permission: 'read', pattern: '*', action: 'allow' },
  { permission: 'read', pattern: '*.env', action: 'ask' },
  { permission: 'read', pattern: '*.env.*', action: 'ask' },
  { permission: 'read', pattern: '*.env.example', action: 'allow' }
]
const MODES: PermissionModeId[] = ['manual', 'acceptEdits', 'plan', 'auto', 'bypass']

const PROBES: Array<[string, string]> = [
  ['edit', 'src/a.ts'],
  ['write', 'a.txt'],
  ['read', 'README.md'],
  ['read', '.env'],
  ['read', 'config.env.local'],
  ['bash', 'ls'],
  ['bash', 'ls -la'],
  ['bash', 'echo hola > prueba.txt'],
  ['bash', 'git status'],
  ['bash', 'npm install'],
  ['webfetch', 'https://example.com'],
  ['websearch', 'algo'],
  ['external_directory', '/etc/*'],
  ['task', 'general'],
  ['doom_loop', '*']
]

describe('rulesetForMode: bloques autosuficientes', () => {
  it('cada modo devuelve un bloque (también «Solo explorar») y lo mismo en cada llamada', () => {
    for (const m of MODES) {
      expect(rulesetForMode(m).length).toBeGreaterThan(0)
      expect(rulesetForMode(m)).toEqual(rulesetForMode(m))
    }
  })

  it('un modo en una sesión que venía de CUALQUIER otro equivale a una sesión nueva en ese modo (tabla modo × comando)', () => {
    for (const to of MODES) {
      const fresh = PROBES.map(([p, pat]) => evaluate(p, pat, BUILD, rulesetForMode(to)))
      for (const from of MODES) {
        const changed = PROBES.map(([p, pat]) => evaluate(p, pat, BUILD, rulesetForMode(from), rulesetForMode(to)))
        expect({ from, to, changed }).toEqual({ from, to, changed: fresh })
      }
    }
  })

  it('tabla de comportamiento por modo (sesión nueva)', () => {
    const row = (m: PermissionModeId): Record<string, RuleAction> =>
      Object.fromEntries(PROBES.map(([p, pat]) => [`${p} ${pat}`, evaluate(p, pat, BUILD, rulesetForMode(m))]))
    expect(row('manual')).toMatchObject({
      'edit src/a.ts': 'ask',
      'bash ls': 'ask',
      'webfetch https://example.com': 'ask',
      'task general': 'ask',
      'read .env': 'ask',
      'external_directory /etc/*': 'ask',
      'doom_loop *': 'ask'
    })
    expect(row('acceptEdits')).toMatchObject({
      'edit src/a.ts': 'allow',
      'write a.txt': 'allow',
      'bash ls': 'ask',
      'websearch algo': 'ask',
      'read .env': 'ask'
    })
    expect(row('auto')).toMatchObject({
      'edit src/a.ts': 'allow',
      'read README.md': 'allow',
      'bash npm install': 'ask',
      'webfetch https://example.com': 'ask',
      'read .env': 'ask'
    })
    expect(row('plan')).toMatchObject({
      'edit src/a.ts': 'deny',
      'write a.txt': 'deny',
      'bash npm install': 'ask',
      'task general': 'deny',
      'read README.md': 'allow'
    })
    expect(row('bypass')).toMatchObject({
      'bash echo hola > prueba.txt': 'allow',
      'external_directory /etc/*': 'allow',
      'webfetch https://example.com': 'allow',
      'doom_loop *': 'ask'
    })
  })

  it('«Editar sin preguntar» pregunta por los comandos en sesión nueva (antes no)', () => {
    expect(evaluate('bash', 'ls', BUILD, rulesetForMode('acceptEdits'))).toBe('ask')
    expect(evaluate('bash', 'ls', BUILD, rulesetForMode('manual'), rulesetForMode('acceptEdits'))).toBe('ask')
  })

  it('el plan permite escribir su plan .md pero no editar el proyecto', () => {
    expect(evaluate('edit', '.opencode/plans/uno.md', BUILD, rulesetForMode('plan'))).toBe('allow')
    expect(evaluate('edit', 'src/main.ts', BUILD, rulesetForMode('plan'))).toBe('deny')
  })

  it('nada se abre respecto de hoy: ningún modo salvo «Todo sin preguntar» permite bash, web ni carpetas externas', () => {
    for (const m of ['manual', 'acceptEdits', 'plan', 'auto'] as const) {
      expect(evaluate('bash', 'rm -rf x', BUILD, rulesetForMode(m))).toBe('ask')
      expect(evaluate('external_directory', '/etc/*', BUILD, rulesetForMode(m))).toBe('ask')
    }
  })
})

describe('idempotencia', () => {
  it('endsWithRuleset: iguala con el bloque al final y no con otro', () => {
    const auto = rulesetForMode('auto')
    const manual = rulesetForMode('manual')
    expect(endsWithRuleset(auto, auto)).toBe(true)
    expect(endsWithRuleset([...manual, ...auto], auto)).toBe(true)
    expect(endsWithRuleset([...auto, ...manual], auto)).toBe(false)
    expect(endsWithRuleset(undefined, auto)).toBe(false)
    expect(endsWithRuleset(manual, auto)).toBe(false)
  })

  it('los bloques de Automático y de Editar sin preguntar se distinguen por las reglas de la sesión', () => {
    expect(approvalKindOf([...rulesetForMode('manual'), ...rulesetForMode('auto')])).toBe('auto')
    expect(approvalKindOf(rulesetForMode('plan'))).toBe('plan')
    expect(approvalKindOf(rulesetForMode('acceptEdits'))).toBeNull()
    expect(approvalKindOf([...rulesetForMode('auto'), ...rulesetForMode('manual')])).toBeNull()
  })

  it('el agente Plan manda; «Solo explorar» con agente Build vale como Preguntar siempre', () => {
    expect(effectiveModeFor('bypass', 'plan')).toBe('plan')
    expect(effectiveModeFor('plan', 'build')).toBe('manual')
    expect(effectiveModeFor('auto', 'build')).toBe('auto')
  })
})

describe('isAutoApprovableCommand: solo un comando simple de lectura', () => {
  const ok = [
    'ls',
    'ls -la src',
    'dir',
    'pwd',
    'git status',
    'git status -s',
    'git diff HEAD~1',
    'git log --oneline -5',
    'git branch',
    'git branch -a',
    'git branch --list feat/*',
    'git show HEAD',
    'git rev-parse --show-toplevel',
    'Get-ChildItem',
    'Get-ChildItem -Recurse src',
    'Get-Location'
  ]
  const no = [
    'ls > salida.txt',
    'ls | wc -l > conteo.txt',
    'ls | wc -l',
    'ls && ls > b.txt',
    'ls; rm -rf x',
    'ls & echo hi',
    'ls $(rm -rf x)',
    'ls `pwd`',
    'ls\nrm x',
    'lsof',
    'ls2',
    'git status > s.txt',
    'git diff --output=d.txt',
    'git branch nueva',
    'git branch -D vieja',
    'git branch -m otra',
    'git -c core.pager=x status',
    'git push',
    'git clone x',
    'cat .env',
    'curl https://example.com',
    'npm install',
    'Get-ChildItem | Out-File x.txt',
    'Get-Content .env',
    '',
    'rm -rf /'
  ]
  it.each(ok)('«%s» se aprueba sola en Automático y en Solo explorar', (c) => {
    expect(isAutoApprovableCommand('auto', c)).toBe(true)
    expect(isAutoApprovableCommand('plan', c)).toBe(true)
  })
  it.each(no)('«%s» NO se aprueba sola', (c) => {
    expect(isAutoApprovableCommand('auto', c)).toBe(false)
    expect(isAutoApprovableCommand('plan', c)).toBe(false)
  })
  it('1.8.12 (R1): npm test / npm run NUNCA se aprueban solos, tampoco en Automático', () => {
    for (const kind of ['auto', 'plan'] as const) {
      for (const c of ['npm test', 'npm run build', 'npm run', 'npm test -- --watch', 'npm install', 'pnpm test', 'yarn test']) {
        expect(isAutoApprovableCommand(kind, c), `${kind} ${c}`).toBe(false)
      }
    }
    expect(isAutoApprovableCommand('auto', 'npm run build && npm publish')).toBe(false)
    expect(isAutoApprovableCommand('auto', undefined)).toBe(false)
    // lo de solo lectura sigue igual
    expect(isAutoApprovableCommand('auto', 'git status')).toBe(true)
  })
})

// Las herramientas de recursos de un conector MCP piden `read` con patrón `mcp:<servidor>:*` (verificado en el binario del motor 1.19):
// el `read: * allow` de cada modo las dejaba pasar sin tarjeta. «Todo sin preguntar» (bypass) lo levanta como siempre.
describe('recursos de conectores MCP (read con patrón mcp:<servidor>:*)', () => {
  // Misma semántica del motor: gana la ÚLTIMA regla que coincide; `*` casa con cualquier texto (también con «:»).
  const wild = (pattern: string, text: string): boolean =>
    new RegExp(
      '^' +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') +
        '$'
    ).test(text)
  const actionFor = (mode: Parameters<typeof rulesetForMode>[0], text: string): string | null => {
    const hit = rulesetForMode(mode)
      .filter((r) => r.permission === 'read' && wild(r.pattern, text))
      .at(-1)
    return hit?.action ?? null
  }

  it.each(['manual', 'acceptEdits', 'plan', 'auto'] as const)(
    '%s: un recurso de conector pregunta, pero leer un archivo sigue permitido',
    (mode) => {
      expect(actionFor(mode, 'mcp:gmail:*')).toBe('ask')
      expect(actionFor(mode, 'mcp:mi-crm:file:///datos/clientes.csv')).toBe('ask')
      expect(actionFor(mode, '/proyecto/src/index.ts')).toBe('allow')
      expect(actionFor(mode, '/proyecto/.env')).toBe('ask') // sin cambios
    }
  )
  it('bypass («Todo sin preguntar») no pregunta, como siempre', () => {
    expect(actionFor('bypass', 'mcp:gmail:*')).toBe('allow')
  })
})

describe('agentes empaquetados: recursos de conectores', () => {
  const read = (f: string): string => readFileSync(join(__dirname, '../../resources/opencode/agents', f), 'utf8')
  it('tasks y computer preguntan por mcp:*; lazunox-helper lo deniega', () => {
    expect(read('tasks.md')).toMatch(/read:\n\s+"\*": allow\n(?:\s+#.*\n)*\s+"mcp:\*": ask/)
    expect(read('computer.md')).toMatch(/read:\n\s+"\*": allow\n(?:\s+#.*\n)*\s+"mcp:\*": ask/)
    expect(read('lazunox-helper.md')).toMatch(/"mcp:\*": deny/)
  })
})

// Editar la config de git pregunta en los modos que dejan editar sin preguntar: `core.fsmonitor` en `.git/config` hace que un `git status`
// (aprobado solo por la app como «solo lectura» en Automático) EJECUTE un comando.
describe('editar la configuración de git', () => {
  const wild = (pattern: string, text: string): boolean =>
    new RegExp(
      '^' +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') +
        '$'
    ).test(text)
  const lastAction = (mode: Parameters<typeof rulesetForMode>[0], permission: 'edit' | 'write', path: string): string | null =>
    rulesetForMode(mode)
      .filter((r) => r.permission === permission && wild(r.pattern, path))
      .at(-1)?.action ?? null

  const SENSIBLES = [
    '.git/config',
    '.git/hooks/pre-commit',
    'sub/proyecto/.git/config',
    '.gitattributes',
    'sub/.gitattributes',
    '.gitmodules'
  ]
  const NORMALES = ['src/index.ts', 'README.md', '.gitignore', '.github/workflows/ci.yml', 'docs/git.md', 'src/.gitkeep']

  it.each(['acceptEdits', 'auto'] as const)(
    '%s: editar/escribir archivos sensibles de git pregunta; el resto de archivos sigue permitido',
    (mode) => {
      for (const permission of ['edit', 'write'] as const) {
        for (const p of SENSIBLES) expect(lastAction(mode, permission, p), `${mode} ${permission} ${p}`).toBe('ask')
        for (const p of NORMALES) expect(lastAction(mode, permission, p), `${mode} ${permission} ${p}`).toBe('allow')
      }
    }
  )
  it('manual ya pregunta por todo; plan no deja editar; «Todo sin preguntar» queda como elección explícita', () => {
    expect(lastAction('manual', 'edit', '.git/config')).toBe('ask')
    expect(lastAction('plan', 'edit', '.git/config')).toBe('deny')
    expect(lastAction('bypass', 'edit', '.git/config')).toBe('allow')
  })
  it('la app sigue aprobando sola solo comandos simples de lectura (la mitad de la cadena: no se amplía la lista)', () => {
    expect(isAutoApprovableCommand('auto', 'git status')).toBe(true)
    expect(isAutoApprovableCommand('auto', 'git -c core.fsmonitor=touch status')).toBe(false)
    expect(isAutoApprovableCommand('auto', 'git config core.fsmonitor "touch x"')).toBe(false)
  })
})

// 1.8.12 (R1/R4): «Automático» y «Comparar» no ejecutan código del proyecto sin tarjeta; opencode.json(c) pregunta; «Solo explorar» pregunta por la web.
describe('1.8.12: cierre de R1 y R4', () => {
  const wild = (pattern: string, text: string): boolean =>
    new RegExp(
      '^' +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') +
        '$'
    ).test(text)
  const last = (rules: ReturnType<typeof rulesetForMode>, permission: 'edit' | 'write', path: string): string | null =>
    rules.filter((r) => r.permission === permission && wild(r.pattern, path)).at(-1)?.action ?? null

  it('Automático (con o sin permiso de solo lectura del motor) no contiene npm', () => {
    for (const opts of [{}, { engineAllowReadOnly: true }]) {
      const rules = rulesetForMode('auto', opts)
      expect(rules.filter((r) => /npm/.test(r.pattern))).toEqual([])
      expect(evaluate('bash', 'npm test', BUILD, rules)).toBe('ask')
      expect(evaluate('bash', 'npm run build', BUILD, rules)).toBe('ask')
    }
    // Comparar conserva solo la lectura de git
    expect(evaluate('bash', 'git status', BUILD, rulesetForMode('auto', { engineAllowReadOnly: true }))).toBe('allow')
  })

  it.each(['acceptEdits', 'auto'] as const)('%s: editar opencode.json(c) pregunta; un archivo normal sigue permitido', (mode) => {
    const rules = rulesetForMode(mode)
    for (const permission of ['edit', 'write'] as const) {
      for (const p of ['opencode.json', 'sub/opencode.jsonc', 'a/b/opencode.json', 'opencode.jsonc']) {
        expect(last(rules, permission, p), `${mode} ${permission} ${p}`).toBe('ask')
      }
      expect(last(rules, permission, 'src/a.ts')).toBe('allow')
    }
    expect(evaluate('edit', 'opencode.json', BUILD, rules)).toBe('ask')
    expect(evaluate('edit', 'sub/opencode.jsonc', BUILD, rules)).toBe('ask')
    expect(evaluate('edit', 'src/a.ts', BUILD, rules)).toBe('allow')
  })

  it('«Solo explorar»: la web pregunta', () => {
    const rules = rulesetForMode('plan')
    expect(evaluate('webfetch', 'https://example.com', BUILD, rules)).toBe('ask')
    expect(evaluate('websearch', 'algo', BUILD, rules)).toBe('ask')
  })

  it('approvalKindOf reconoce auto y plan y no confunde auto con acceptEdits', () => {
    expect(approvalKindOf(rulesetForMode('auto'))).toBe('auto')
    expect(approvalKindOf(rulesetForMode('plan'))).toBe('plan')
    expect(approvalKindOf(rulesetForMode('acceptEdits'))).toBeNull()
    expect(approvalKindOf(rulesetForMode('manual'))).toBeNull()
    expect(approvalKindOf(rulesetForMode('bypass'))).toBeNull()
    expect(approvalKindOf([...rulesetForMode('auto'), ...rulesetForMode('acceptEdits')])).toBeNull()
    expect(approvalKindOf([...rulesetForMode('acceptEdits'), ...rulesetForMode('auto')])).toBe('auto')
  })

  it('una sesión con el bloque «auto» VIEJO (con npm) ya no se reconoce como auto (lado seguro: más tarjetas, nada aprobado de más)', () => {
    const a = (
      permission: string,
      pattern: string,
      action: 'allow' | 'ask' | 'deny'
    ): { permission: string; pattern: string; action: typeof action } => ({
      permission,
      pattern,
      action
    })
    const marks = [
      'ls',
      'dir',
      'pwd',
      'git branch',
      'git show',
      'git rev-parse',
      'git status',
      'git diff',
      'git log',
      'Get-ChildItem',
      'Get-Location',
      'npm run',
      'npm test'
    ]
    const viejo = [
      a('edit', '*', 'allow'),
      a('write', '*', 'allow'),
      ...['.git/*', '*/.git/*', '.gitattributes', '*/.gitattributes', '.gitmodules', '*/.gitmodules'].flatMap((p) => [
        a('edit', p, 'ask'),
        a('write', p, 'ask')
      ]),
      a('read', '*', 'allow'),
      a('read', '*.env', 'ask'),
      a('read', '*.env.*', 'ask'),
      a('read', '*.env.example', 'allow'),
      a('read', 'mcp:*', 'ask'),
      a('bash', '*', 'ask'),
      ...marks.map((c) => a('bash', `${c} *`, 'ask')),
      a('webfetch', '*', 'ask'),
      a('websearch', '*', 'ask'),
      a('external_directory', '*', 'ask'),
      a('task', '*', 'allow')
    ]
    expect(approvalKindOf(viejo)).toBeNull()
  })
})
