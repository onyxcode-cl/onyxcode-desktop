import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildInlineConfig, type InlineConfigInput } from './inline-config'
import { projectCodeEnv, projectText, QUARANTINE_DIR, QUARANTINE_KEEP, quarantineEngineUserConfig } from './project-code'

const base = (over: Partial<InlineConfigInput> = {}): InlineConfigInput => ({
  fullAccess: false,
  extras: [],
  browserMcp: null,
  computerMcp: null,
  mcpContribution: { mcp: {}, permission: {} },
  rulesPermission: {},
  skills: {},
  ...over
})

describe('H5: variables del motor', () => {
  it('con jaula apaga la config del proyecto; Control total no cambia', () => {
    expect(projectCodeEnv(false)).toEqual({ OPENCODE_DISABLE_PROJECT_CONFIG: '1' })
    expect(projectCodeEnv(true)).toEqual({})
  })
})

describe('H5: texto de la carpeta', () => {
  it('elige AGENTS.md, luego CLAUDE.md, luego CONTEXT.md; sin ninguno, AGENTS.md', () => {
    const has = (names: string[]) => (p: string) => names.includes(basename(p))
    expect(projectText('/c', has(['CLAUDE.md', 'AGENTS.md'])).instructionFile).toBe(join('/c', 'AGENTS.md'))
    expect(projectText('/c', has(['CLAUDE.md', 'CONTEXT.md'])).instructionFile).toBe(join('/c', 'CLAUDE.md'))
    expect(projectText('/c', has(['CONTEXT.md'])).instructionFile).toBe(join('/c', 'CONTEXT.md'))
    expect(projectText('/c', has([])).instructionFile).toBe(join('/c', 'AGENTS.md'))
    expect(projectText('/c', has([])).skillDirs).toEqual([join('/c', '.opencode', 'skills'), join('/c', '.opencode', 'skill')])
  })

  it('inline con jaula: instrucciones y skills por ruta absoluta, LSP y formateadores apagados', () => {
    const cfg = buildInlineConfig(base({ projectText: { instructionFile: '/c/AGENTS.md', skillDirs: ['/c/.opencode/skills'] } }))
    expect(cfg.instructions).toEqual(['/c/AGENTS.md'])
    expect(cfg.skills).toEqual({ paths: ['/c/.opencode/skills'] })
    expect(cfg.lsp).toBe(false)
    expect(cfg.formatter).toBe(false)
  })

  it('suma (no pisa) las instrucciones del puente y las rutas de skills que ya hubiera; traduce rutas en Windows', () => {
    const cfg = buildInlineConfig(
      base({
        instructions: ['C:\\app\\apps.md'],
        skills: { skills: { paths: ['/ya/estaba'] } },
        projectText: { instructionFile: 'C:\\c\\AGENTS.md', skillDirs: ['C:\\c\\.opencode\\skills'] },
        toSandbox: (p) => '/win/' + p.replace(/\\/g, '/').replace(':', '').toLowerCase()
      })
    )
    expect(cfg.instructions).toEqual(['/win/c/c/agents.md', '/win/c/app/apps.md'])
    expect(cfg.skills).toEqual({ paths: ['/ya/estaba', '/win/c/c/.opencode/skills'] })
  })

  it('sin `projectText` o con Control total el resultado es el de siempre', () => {
    expect(buildInlineConfig(base())).toEqual(buildInlineConfig(base({ projectText: undefined })))
    const full = buildInlineConfig(base({ fullAccess: true, projectText: { instructionFile: '/c/AGENTS.md', skillDirs: [] } }))
    expect(full.instructions).toBeUndefined()
    expect(full.lsp).toBeUndefined()
    expect(full.formatter).toBeUndefined()
  })
})

describe('H5: cuarentena de la config global privada del motor', () => {
  let root: string
  let priv: string
  let conf: string
  const logs: string[] = []
  const log = (m: string): void => void logs.push(m)

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-h5u-')))
    priv = join(root, 'privada')
    conf = join(priv, 'config', 'opencode')
    mkdirSync(conf, { recursive: true })
    logs.length = 0
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('sin nada que apartar no crea la cuarentena', () => {
    writeFileSync(join(conf, 'package.json'), '{}')
    mkdirSync(join(conf, 'node_modules'))
    writeFileSync(join(conf, '.gitignore'), 'x')
    expect(quarantineEngineUserConfig(priv, log)).toEqual([])
    expect(existsSync(join(priv, QUARANTINE_DIR))).toBe(false)
    expect(readdirSync(conf).sort()).toEqual(['.gitignore', 'node_modules', 'package.json'])
  })

  it('aparta complementos, herramientas, opencode.json, comandos, agentes… y deja lo propio del motor', () => {
    for (const d of ['plugin', 'plugins', 'tool', 'tools', 'command', 'agent', 'mode', 'skills']) mkdirSync(join(conf, d))
    writeFileSync(join(conf, 'plugin', 'x.js'), 'nada')
    writeFileSync(join(conf, 'opencode.json'), '{"mcp":{}}')
    writeFileSync(join(conf, 'opencode.jsonc'), '{}')
    writeFileSync(join(conf, 'config.json'), '{}')
    writeFileSync(join(conf, 'AGENTS.md'), 'texto')
    writeFileSync(join(conf, 'package.json'), '{}')
    const moved = quarantineEngineUserConfig(priv, log, 1000)
    expect(moved.sort()).toEqual(
      ['AGENTS.md', 'agent', 'command', 'config.json', 'mode', 'opencode.json', 'opencode.jsonc', 'plugin', 'plugins', 'skills', 'tool', 'tools'].sort()
    )
    expect(readdirSync(conf)).toEqual(['package.json'])
    expect(readFileSync(join(priv, QUARANTINE_DIR, '1000', 'plugin', 'x.js'), 'utf8')).toBe('nada')
    expect(logs.join(' ')).toContain('plugin')
  })

  it.skipIf(process.platform === 'win32')('un enlace con nombre «propio» (node_modules → fuera) también se aparta, sin tocar su destino', () => {
    const fuera = join(root, 'fuera')
    mkdirSync(fuera)
    writeFileSync(join(fuera, 'dato'), 'intacto')
    symlinkSync(fuera, join(conf, 'node_modules'))
    expect(quarantineEngineUserConfig(priv, log, 5)).toEqual(['node_modules'])
    expect(lstatSync(join(priv, QUARANTINE_DIR, '5', 'node_modules')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(fuera, 'dato'), 'utf8')).toBe('intacto')
  })

  it.skipIf(process.platform === 'win32')('si `config/opencode` es un enlace, se quita el enlace (no su destino) y queda una carpeta real vacía', () => {
    const fuera = join(root, 'fuera')
    mkdirSync(join(fuera, 'plugin'), { recursive: true })
    writeFileSync(join(fuera, 'plugin', 'x.js'), 'intacto')
    rmSync(conf, { recursive: true })
    symlinkSync(fuera, conf)
    expect(quarantineEngineUserConfig(priv, log)).toEqual([])
    expect(lstatSync(conf).isDirectory()).toBe(true)
    expect(lstatSync(conf).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(fuera, 'plugin', 'x.js'), 'utf8')).toBe('intacto')
  })

  it('crea `config/opencode` si falta y guarda solo las cuarentenas más nuevas', () => {
    rmSync(join(priv, 'config'), { recursive: true })
    expect(quarantineEngineUserConfig(priv, log)).toEqual([])
    expect(lstatSync(conf).isDirectory()).toBe(true)
    for (let i = 1; i <= QUARANTINE_KEEP + 2; i++) {
      writeFileSync(join(conf, 'opencode.json'), String(i))
      quarantineEngineUserConfig(priv, log, 1000 + i)
    }
    const kept = readdirSync(join(priv, QUARANTINE_DIR)).sort()
    expect(kept).toHaveLength(QUARANTINE_KEEP)
    expect(kept.at(-1)).toBe(String(1000 + QUARANTINE_KEEP + 2))
  })

  it('misma marca de tiempo dos veces: no pisa la cuarentena anterior', () => {
    writeFileSync(join(conf, 'opencode.json'), 'a')
    quarantineEngineUserConfig(priv, log, 7)
    writeFileSync(join(conf, 'opencode.json'), 'b')
    quarantineEngineUserConfig(priv, log, 7)
    expect(readFileSync(join(priv, QUARANTINE_DIR, '7', 'opencode.json'), 'utf8')).toBe('a')
    expect(readFileSync(join(priv, QUARANTINE_DIR, '7-1', 'opencode.json'), 'utf8')).toBe('b')
  })
})
