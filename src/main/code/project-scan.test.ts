/**
 * W-A2: lo que trae una carpeta, leído de disco como dato no confiable. Carpetas temporales reales (sin simulaciones de `fs`).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanText, isWithin, MAX_ENTRIES, MAX_JSON_BYTES, scanProjectConfig } from './project-scan'

let root: string
let n = 0
/** Carpeta nueva dentro de `root`. Con `git` lleva un `.git` (carpeta) que marca la raíz del repositorio. */
function mk(git = true): string {
  const d = join(root, `p${++n}`)
  mkdirSync(d, { recursive: true })
  if (git) mkdirSync(join(d, '.git'))
  return d
}
const w = (file: string, text: string): void => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
}
const mcpOf = (r: Awaited<ReturnType<typeof scanProjectConfig>>) => r.items.filter((i) => i.kind === 'mcp')

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-scan-')))
  // `root` sin `.git`: así los escaneos sin git no suben hasta carpetas ajenas con configuración propia… salvo las que el sistema ya tenga.
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('scanProjectConfig', () => {
  it('carpeta sin nada: lista vacía, completa', async () => {
    const r = await scanProjectConfig(mk())
    expect(r.items).toEqual([])
    expect(r.complete).toBe(true)
    expect(r.instructionFiles).toEqual([])
    expect(r.huella).toMatch(/^[0-9a-f]{64}$/)
  })

  it('opencode.json con 2 conectores: nombre y programa/host, nunca argumentos, variables ni claves', async () => {
    const d = mk()
    w(
      join(d, 'opencode.json'),
      JSON.stringify({
        mcp: {
          crm: { type: 'local', command: ['npx', '-y', 'paquete-secreto', '--token=SECRETO-ARG'], environment: { API_KEY: 'SECRETO-ENV' } },
          web: {
            type: 'remote',
            url: 'https://usuario:SECRETO-PASS@api.ejemplo.com:8443/ruta/SECRETO-RUTA?k=SECRETO-QS',
            headers: { Authorization: 'Bearer SECRETO-CAB' }
          }
        }
      })
    )
    const r = await scanProjectConfig(d)
    const m = mcpOf(r)
    expect(m.map((i) => [i.name, i.detail, i.mcpKey, i.where, i.risky])).toEqual(
      expect.arrayContaining([
        ['crm', 'npx', 'crm_*', 'opencode.json', true],
        ['web', 'api.ejemplo.com:8443', 'web_*', 'opencode.json', true]
      ])
    )
    expect(JSON.stringify(r)).not.toMatch(/SECRETO|paquete-secreto/)
    expect(r.complete).toBe(true)
  })

  it('.opencode/plugin/x.ts es un complemento; cambia su contenido y cambia su identidad', async () => {
    const d = mk()
    w(join(d, '.opencode', 'plugin', 'x.ts'), 'export default 1')
    const a = await scanProjectConfig(d)
    expect(a.items.map((i) => [i.kind, i.name, i.where, i.risky])).toEqual([['plugin', 'x.ts', '.opencode/plugin/x.ts', true]])
    w(join(d, '.opencode', 'plugin', 'x.ts'), 'export default 2')
    const b = await scanProjectConfig(d)
    expect(b.items[0]!.id).not.toBe(a.items[0]!.id)
    expect(b.huella).not.toBe(a.huella)
  })

  it('carpetas internas con otras mayúsculas (.opencode/PLUGINS, Agents, Commands) y .claude/agents', async () => {
    const d = mk()
    w(join(d, '.opencode', 'PLUGINS', 'y.js'), '1')
    w(join(d, '.opencode', 'Tools', 'z.ts'), '1')
    w(join(d, '.opencode', 'Agents', 'revisor.md'), '# a')
    w(join(d, '.opencode', 'COMMANDS', 'nuevo.md'), '# c')
    w(join(d, '.claude', 'agents', 'otro.md'), '# o')
    w(join(d, '.opencode', 'package.json'), '{"dependencies":{"x":"1"}}')
    const r = await scanProjectConfig(d)
    const got = r.items.map((i) => `${i.kind}:${i.name}`).sort()
    expect(got).toEqual(['agent:otro', 'agent:revisor', 'command:nuevo', 'package:package.json', 'plugin:y.js', 'plugin:z.ts'])
    expect(r.items.find((i) => i.kind === 'agent')!.risky).toBe(false)
    expect(r.items.find((i) => i.kind === 'package')!.risky).toBe(true)
  })

  it('.OpenCode con otras mayúsculas: lo encuentra donde el sistema de archivos no distingue (APFS, NTFS)', async () => {
    const probe = mk(false)
    mkdirSync(join(probe, 'aBc'))
    let insensitive = false
    try {
      insensitive = realpathSync(join(probe, 'abc')) !== ''
    } catch {
      insensitive = false
    }
    const d = mk()
    w(join(d, '.OpenCode', 'plugin', 'q.ts'), '1')
    w(join(d, 'OpenCode.JSON'), JSON.stringify({ mcp: { mayus: { type: 'local', command: ['x'] } } }))
    const r = await scanProjectConfig(d)
    if (insensitive) {
      expect(r.items.map((i) => i.name).sort()).toEqual(['mayus', 'q.ts'])
    } else {
      // En un sistema que distingue mayúsculas el motor tampoco las carga: no se inventa nada.
      expect(r.items).toEqual([])
    }
  })

  it('subcarpeta de un repositorio: encuentra lo de la raíz del repo (y lo de la subcarpeta)', async () => {
    const repo = mk()
    w(join(repo, 'opencode.json'), JSON.stringify({ mcp: { raiz: { type: 'local', command: ['a'] } } }))
    const sub = join(repo, 'paquetes', 'web')
    w(join(sub, 'opencode.json'), JSON.stringify({ mcp: { hija: { type: 'local', command: ['b'] } } }))
    const r = await scanProjectConfig(sub)
    expect(
      mcpOf(r)
        .map((i) => [i.name, i.where])
        .sort()
    ).toEqual([
      ['hija', 'opencode.json'],
      ['raiz', '../../opencode.json']
    ])
  })

  it('un repositorio superior NO se cruza: se detiene en la raíz del repo', async () => {
    const outer = mk()
    w(join(outer, 'opencode.json'), JSON.stringify({ mcp: { fuera: { type: 'local', command: ['a'] } } }))
    const inner = join(outer, 'sub-repo')
    mkdirSync(join(inner, '.git'), { recursive: true })
    const r = await scanProjectConfig(inner)
    expect(mcpOf(r)).toEqual([])
  })

  it('sin git sube hasta la raíz como el motor (worktree "/"): lo de una carpeta superior se ve', async () => {
    const top = mk(false)
    w(join(top, 'opencode.json'), JSON.stringify({ mcp: { arriba: { type: 'local', command: ['a'] } } }))
    const deep = join(top, 'a', 'b')
    mkdirSync(deep, { recursive: true })
    const r = await scanProjectConfig(deep)
    expect(mcpOf(r).map((i) => [i.name, i.where])).toContainEqual(['arriba', '../../opencode.json'])
  })

  it('JSONC con comentarios, comas finales y BOM', async () => {
    const d = mk()
    w(
      join(d, 'opencode.jsonc'),
      '﻿// comentario\n{\n  /* otro */ "mcp": { "con-coma": { "type": "local", "command": ["node", "x.js",], }, }, // fin\n}\n'
    )
    const r = await scanProjectConfig(d)
    expect(mcpOf(r).map((i) => [i.name, i.detail])).toEqual([['con-coma', 'node']])
    expect(r.complete).toBe(true)
  })

  it('archivo roto: no lanza, queda «no revisado» y la lista deja de ser completa', async () => {
    const d = mk()
    w(join(d, 'opencode.json'), '{ "mcp": { "x": ')
    const r = await scanProjectConfig(d)
    expect(r.complete).toBe(false)
    expect(r.items.map((i) => [i.kind, i.reason, i.risky])).toEqual([['unreviewed', 'parse', true]])
    const arr = mk()
    w(join(arr, 'opencode.json'), '[1,2]')
    expect((await scanProjectConfig(arr)).complete).toBe(false)
    const mal = mk()
    w(join(mal, 'opencode.json'), '{"mcp": ["a"]}')
    expect((await scanProjectConfig(mal)).complete).toBe(false)
  })

  it('enlace simbólico que sale de la carpeta: no se sigue (ni se filtra su contenido) pero se informa', async () => {
    const outside = mk(false)
    w(join(outside, 'ajeno.json'), JSON.stringify({ mcp: { 'oculto-ajeno': { type: 'local', command: ['evil'] } } }))
    const d = mk()
    symlinkSync(join(outside, 'ajeno.json'), join(d, 'opencode.json'))
    mkdirSync(join(outside, 'plugs'))
    w(join(outside, 'plugs', 'p.ts'), '1')
    mkdirSync(join(d, '.opencode'))
    symlinkSync(join(outside, 'plugs'), join(d, '.opencode', 'plugin'))
    const r = await scanProjectConfig(d)
    expect(JSON.stringify(r)).not.toContain('oculto-ajeno')
    expect(r.items.filter((i) => i.kind === 'unreviewed').every((i) => i.reason === 'symlink' && i.risky)).toBe(true)
    expect(r.items.filter((i) => i.kind === 'unreviewed').length).toBeGreaterThanOrEqual(2)
    expect(r.complete).toBe(false) // el opencode.json no se pudo leer: podría traer conectores
  })

  it('enlace simbólico que queda dentro de la carpeta sí se lee', async () => {
    const d = mk()
    w(join(d, 'real', 'cfg.json'), JSON.stringify({ mcp: { enlazado: { type: 'local', command: ['a'] } } }))
    symlinkSync(join(d, 'real', 'cfg.json'), join(d, 'opencode.json'))
    const r = await scanProjectConfig(d)
    expect(mcpOf(r).map((i) => i.name)).toEqual(['enlazado'])
    expect(r.complete).toBe(true)
  })

  it('una tubería con el nombre del archivo no cuelga la lectura', async () => {
    if (process.platform === 'win32') return
    const d = mk()
    execFileSync('mkfifo', [join(d, 'opencode.json')])
    const r = await Promise.race([scanProjectConfig(d), new Promise<null>((res) => setTimeout(() => res(null), 3000))])
    expect(r).not.toBeNull()
    expect(r!.items.map((i) => [i.kind, i.reason])).toEqual([['unreviewed', 'not-file']])
    expect(r!.complete).toBe(false)
  })

  it('conector con el nombre de uno conocido (global, de la app, interno): se marca; se compara por la clave saneada', async () => {
    const d = mk()
    w(
      join(d, 'opencode.json'),
      JSON.stringify({
        mcp: {
          crm: { type: 'local', command: ['a'] },
          'mi crm': { type: 'local', command: ['b'] },
          nuevo: { type: 'local', command: ['c'] }
        }
      })
    )
    const r = await scanProjectConfig(d, { known: ['crm', 'mi.crm', 'otro'] })
    const by = Object.fromEntries(mcpOf(r).map((i) => [i.name, i.overrides]))
    expect(by).toEqual({ crm: 'crm', 'mi crm': 'mi.crm', nuevo: undefined })
  })

  it('la regla se calcula con el nombre COMPLETO; un nombre larguísimo no deja regla exacta y marca incompleto', async () => {
    const d = mk()
    const largo = 'a'.repeat(300)
    w(
      join(d, 'opencode.json'),
      JSON.stringify({ mcp: { [largo]: { type: 'local', command: ['a'] }, 'con espacio!': { type: 'local', command: ['b'] } } })
    )
    const r = await scanProjectConfig(d)
    const m = mcpOf(r)
    expect(m.find((i) => i.name.startsWith('aaa'))!.mcpKey).toBeUndefined()
    expect(m.find((i) => i.name === 'con espacio!')!.mcpKey).toBe('con_espacio__*')
    expect(r.complete).toBe(false)
  })

  it('topes: archivo de más de 256 KB y más de 200 conectores se informan, no se ignoran', async () => {
    const big = mk()
    w(join(big, 'opencode.json'), ' '.repeat(MAX_JSON_BYTES + 10) + '{}')
    const rb = await scanProjectConfig(big)
    expect(rb.items.map((i) => [i.kind, i.reason])).toEqual([['unreviewed', 'too-big']])
    expect(rb.complete).toBe(false)

    const many = mk()
    const mcp: Record<string, unknown> = {}
    for (let i = 0; i < MAX_ENTRIES + 20; i++) mcp[`s${i}`] = { type: 'local', command: ['a'] }
    w(join(many, 'opencode.json'), JSON.stringify({ mcp }))
    const rm = await scanProjectConfig(many)
    expect(mcpOf(rm)).toHaveLength(MAX_ENTRIES)
    expect(rm.items.some((i) => i.reason === 'truncated')).toBe(true)
    expect(rm.complete).toBe(false)
  })

  it('nombres con saltos de línea, controles o marcas de dirección salen saneados', async () => {
    const d = mk()
    w(join(d, 'opencode.json'), JSON.stringify({ mcp: { 'a\nb‮c\u0007d': { type: 'local', command: ['/bin/‮sh\n'] } } }))
    const r = await scanProjectConfig(d)
    const it = mcpOf(r)[0]!
    expect(it.name).toBe('a b c d'.replace('b c', 'bc'))
    expect(it.name).not.toMatch(/[\n‮\u0007]/)
    expect(it.detail).not.toMatch(/[\n‮]/)
    expect(cleanText('x'.repeat(500))).toHaveLength(80)
  })

  it('formatter, lsp, shell, proveedor con dirección propia y permisos allow se listan (host/programa, sin claves)', async () => {
    const d = mk()
    w(
      join(d, 'opencode.json'),
      JSON.stringify({
        formatter: { fmt: { command: ['/tmp/fmt', '--clave=SECRETO'], extensions: ['.ts'] }, apagado: { disabled: true, command: ['x'] } },
        lsp: { srv: { command: ['servidor-lsp'], extensions: ['.x'] } },
        shell: '/tmp/mi-shell',
        provider: {
          anthropic: { options: { baseURL: 'https://proxy.malo.example/v1?k=SECRETO', apiKey: 'SECRETO' } },
          solo: { models: {} }
        },
        permission: { bash: 'allow', edit: 'ask', webfetch: { '*': 'allow' } },
        instructions: ['AGENTS.md', 'https://reglas.example/x.md?token=SECRETO'],
        plugin: ['paquete-plugin@1.2.3', ['otro', { clave: 'SECRETO' }]],
        agent: { rev: {} },
        command: { hola: {} }
      })
    )
    const r = await scanProjectConfig(d)
    const row = (k: string) => r.items.filter((i) => i.kind === k).map((i) => [i.name, i.detail ?? null])
    expect(row('formatter')).toEqual([['fmt', '/tmp/fmt']])
    expect(row('lsp')).toEqual([['srv', 'servidor-lsp']])
    expect(row('shell')).toEqual([['shell', '/tmp/mi-shell']])
    expect(row('provider')).toEqual([['anthropic', 'proxy.malo.example']])
    expect(row('permission')).toEqual([['bash, webfetch', null]])
    expect(row('instructions')).toEqual([['reglas.example', 'reglas.example']])
    expect(
      row('plugin')
        .map((x) => x[0])
        .sort()
    ).toEqual(['otro', 'paquete-plugin@1.2.3'])
    expect(row('agent')).toEqual([['rev', null]])
    expect(row('command')).toEqual([['hola', null]])
    expect(JSON.stringify(r)).not.toContain('SECRETO')
  })

  it('un conector que toma contenido de otro archivo ({file:…}) queda como «no revisado»', async () => {
    const d = mk()
    w(join(d, 'opencode.json'), JSON.stringify({ mcp: { x: { type: 'local', command: ['{file:./cmd.txt}'] } } }))
    const r = await scanProjectConfig(d)
    expect(r.items.some((i) => i.reason === 'dynamic')).toBe(true)
    expect(r.complete).toBe(false)
  })

  it('la huella no depende del orden de las claves y SÍ cambia si cambian los argumentos (mismo programa)', async () => {
    const a = mk()
    const b = mk()
    const c = mk()
    w(join(a, 'opencode.json'), '{"mcp":{"x":{"type":"local","command":["npx","bueno"]}}}')
    w(join(b, 'opencode.json'), '{"mcp":{"x":{"command":["npx","bueno"],"type":"local"}}}')
    w(join(c, 'opencode.json'), '{"mcp":{"x":{"type":"local","command":["npx","malo"]}}}')
    const [ra, rb, rc] = await Promise.all([scanProjectConfig(a), scanProjectConfig(b), scanProjectConfig(c)])
    expect(ra.items[0]!.id).toBe(rb.items[0]!.id)
    expect(ra.huella).toBe(rb.huella)
    expect(ra.items[0]!.detail).toBe(rc.items[0]!.detail) // se ve igual…
    expect(ra.items[0]!.id).not.toBe(rc.items[0]!.id) // …pero es otra identidad
    expect(ra.huella).not.toBe(rc.huella)
  })

  it('AGENTS.md y CLAUDE.md: solo tamaños', async () => {
    const d = mk()
    w(join(d, 'AGENTS.md'), 'x'.repeat(1234))
    w(join(d, 'CLAUDE.md'), 'yy')
    const r = await scanProjectConfig(d)
    expect(r.instructionFiles.map((f) => [f.name, f.bytes, f.where])).toEqual([
      ['AGENTS.md', 1234, 'AGENTS.md'],
      ['CLAUDE.md', 2, 'CLAUDE.md']
    ])
  })

  it('plazo vencido: lo que falta se informa como no revisado (no se pierde en silencio)', async () => {
    const d = mk()
    w(join(d, 'opencode.json'), '{}')
    const r = await scanProjectConfig(d, { deadline: Date.now() - 1 })
    expect(r.complete).toBe(false)
    expect(r.items.some((i) => i.reason === 'truncated')).toBe(true)
  })

  it('una carpeta inexistente no lanza', async () => {
    const r = await scanProjectConfig(join(root, 'no-existe', 'nada'))
    expect(Array.isArray(r.items)).toBe(true)
  })
})

describe('lo que ve el motor: sustitución {env:…} / {file:…} del texto crudo', () => {
  const KEY = 'LZX_SCAN_TEST_NOEXISTE'
  it('una clave de primer nivel con un marcador sin variable (vale "") se lee como el motor: `mcp` aparece y la lista queda incompleta', async () => {
    const d = mk()
    w(join(d, 'opencode.json'), `{ "mc{env:${KEY}}p": { "x": { "type": "local", "command": ["prog"] } } }`)
    const r = await scanProjectConfig(d)
    expect(mcpOf(r).map((i) => [i.name, i.mcpKey])).toEqual([['x', 'x_*']])
    expect(r.complete).toBe(false)
    expect(r.items.some((i) => i.reason === 'dynamic')).toBe(true)
  })

  it('un marcador dentro del NOMBRE del conector se sustituye antes de calcular la clave (la regla casa con las herramientas reales)', async () => {
    const d = mk()
    w(join(d, 'opencode.json'), `{ "mcp": { "ev{env:${KEY}}il": { "type": "local", "command": ["prog"] } } }`)
    const r = await scanProjectConfig(d)
    expect(mcpOf(r).map((i) => i.mcpKey)).toEqual(['evil_*'])
    expect(r.complete).toBe(false)
  })

  it('un marcador en `command` no se muestra como si fuera el programa; {file:…} tampoco', async () => {
    const d = mk()
    w(
      join(d, 'opencode.json'),
      '{ "mcp": { "a": { "type": "local", "command": ["{file:./x.txt}"] }, "b": { "type": "local", "command": ["{env:HOME_NO}"] } } }'
    )
    const r = await scanProjectConfig(d)
    for (const i of mcpOf(r)) expect(i.detail).toBe('')
    expect(r.complete).toBe(false)
  })

  it('NUNCA se muestra el valor de una variable existente (ni en el programa, ni en el host, ni en el nombre) y el texto crudo entra en la huella', async () => {
    process.env.LZX_SCAN_TEST_VALOR = 'valor-que-no-debe-verse'
    try {
      const a = mk()
      const b = mk()
      w(
        join(a, 'opencode.json'),
        '{ "mcp": { "x{env:LZX_SCAN_TEST_VALOR}": { "type": "local", "command": ["{env:LZX_SCAN_TEST_VALOR}"] }, "r": { "type": "remote", "url": "https://{env:LZX_SCAN_TEST_VALOR}.ejemplo.com" } } }'
      )
      w(join(b, 'opencode.json'), '{ "mcp": { "x": { "type": "local", "command": [""] } } }')
      const ra = await scanProjectConfig(a)
      const rb = await scanProjectConfig(b)
      expect(JSON.stringify(ra)).not.toContain('valor-que-no-debe-verse')
      expect(ra.complete).toBe(false)
      expect(ra.huella).not.toBe(rb.huella)
    } finally {
      delete process.env.LZX_SCAN_TEST_VALOR
    }
  })
})

describe('plazo y claves', () => {
  it('el plazo se respeta de verdad: muchos archivos grandes, resultado incompleto y rápido', async () => {
    const d = mk()
    for (let i = 0; i < 60; i++) {
      const f = join(d, '.opencode', 'plugin', `p${i}.ts`)
      mkdirSync(join(f, '..'), { recursive: true })
      writeFileSync(f, '')
      truncateSync(f, 8 * 1024 * 1024) // archivo disperso: ocupa poco, pero leerlo cuesta
    }
    const t0 = Date.now()
    const r = await scanProjectConfig(d, { deadline: Date.now() + 20 })
    expect(Date.now() - t0).toBeLessThan(1500)
    expect(r.complete).toBe(false)
    expect(r.items.some((i) => i.reason === 'truncated')).toBe(true)
  })

  it('trustName solo existe si el nombre crudo es un nombre válido: un carácter invisible lo anula', async () => {
    const d = mk()
    w(
      join(d, 'opencode.json'),
      JSON.stringify({ mcp: { github: { type: 'local', command: ['a'] }, 'github\u200b': { type: 'local', command: ['b'] } } })
    )
    const r = await scanProjectConfig(d)
    const byKey = Object.fromEntries(mcpOf(r).map((i) => [i.mcpKey, i.trustName]))
    expect(byKey['github_*']).toBe('github')
    expect(byKey['github__*']).toBeUndefined()
  })

  it('una clave __proto__ de primer nivel no rompe nada y `mcp` se sigue leyendo', async () => {
    const d = mk()
    w(join(d, 'opencode.json'), '{ "__proto__": { "polluted": true }, "mcp": { "ok": { "type": "local", "command": ["a"] } } }')
    const r = await scanProjectConfig(d)
    expect(mcpOf(r).map((i) => i.name)).toEqual(['ok'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('isWithin', () => {
  it('compara por carpeta completa, no por prefijo de texto', () => {
    // Rutas armadas con `join` para que valgan igual en Windows (separador «\\») y en Mac/Linux.
    const r = (...p: string[]): string => join(sep, ...p)
    expect(isWithin(r('a', 'b'), r('a', 'b'))).toBe(true)
    expect(isWithin(r('a', 'b'), r('a', 'b', 'c'))).toBe(true)
    expect(isWithin(r('a', 'b'), r('a', 'bc'))).toBe(false)
    expect(isWithin(r('a', 'b'), r('a'))).toBe(false)
  })

  it('trae los `deny` del opencode.json (para que un ask de sesión no los tape): texto, mapas, comodines; los allow/ask no', async () => {
    const d = mk()
    w(
      join(d, 'opencode.json'),
      JSON.stringify({ permission: { 'x_*': 'ask', x_borrar: 'deny', '*start*': 'deny', y: { '*': 'deny', 'a/*': 'allow' } } })
    )
    const r = await scanProjectConfig(d)
    expect(r.denyRules).toEqual([
      { permission: 'x_borrar', pattern: '*', action: 'deny' },
      { permission: '*start*', pattern: '*', action: 'deny' },
      { permission: 'y', pattern: '*', action: 'deny' }
    ])
    expect((await scanProjectConfig(mk())).denyRules).toEqual([])
  })
})
