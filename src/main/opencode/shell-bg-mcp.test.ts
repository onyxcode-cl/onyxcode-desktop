import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { effectiveModeFor, rulesetForMode, approvalKindOf, endsWithRuleset, type PermissionModeId } from '@shared/permission-rules'
import { TOOLS, SERVER_NAME } from '../background-shell/mcp-server'
import {
  SHELL_BG_SERVER,
  SHELL_BG_TOOLS,
  bgshellConfigPermission,
  bgshellSessionRules,
  bgshellToolAction,
  prepareShellBgDirs,
  shellBgMcpConfig,
  shellBgPaths,
  shellBgToolId
} from './shell-bg-mcp'

const posix = process.platform === 'win32' ? it.skip : it

describe('nombres', () => {
  it('servidor corto + herramientas del núcleo dan bgshell_start|status|read|stop|list', () => {
    expect(SHELL_BG_SERVER).toBe(SERVER_NAME)
    expect(TOOLS.map((t) => shellBgToolId(t.name as (typeof SHELL_BG_TOOLS)[number]))).toEqual([
      'bgshell_start',
      'bgshell_status',
      'bgshell_read',
      'bgshell_stop',
      'bgshell_list'
    ])
    expect([...SHELL_BG_TOOLS]).toEqual(TOOLS.map((t) => t.name))
  })
})

describe('shellBgMcpConfig', () => {
  const base = { nodePath: '/rt/node/bin/node', scriptPath: '/app/resources/shell-bg/shell-bg-mcp.cjs', baseDir: '/ud/shell-bg/code/work' }

  it('bloque local con command y environment', () => {
    expect(shellBgMcpConfig({ ...base, eventsFile: '/ud/shell-bg/code/events.jsonl', quietMs: 600000, maxJobs: 4 })).toEqual({
      type: 'local',
      command: ['/rt/node/bin/node', '/app/resources/shell-bg/shell-bg-mcp.cjs'],
      environment: {
        LAZUNOX_SHELL_BG_DIR: '/ud/shell-bg/code/work',
        LAZUNOX_SHELL_BG_EVENTS: '/ud/shell-bg/code/events.jsonl',
        LAZUNOX_SHELL_BG_QUIET_MS: '600000',
        LAZUNOX_SHELL_BG_MAX_JOBS: '4'
      },
      enabled: true,
      timeout: 15000
    })
  })
  it('prefijo de comando (quitar credenciales del servidor) y sin opcionales no inventa variables', () => {
    const c = shellBgMcpConfig({ ...base, commandPrefix: ['/usr/bin/env', '-u', 'X'], quietMs: 0, maxJobs: NaN })!
    expect(c.command).toEqual(['/usr/bin/env', '-u', 'X', base.nodePath, base.scriptPath])
    expect(c.environment).toEqual({ LAZUNOX_SHELL_BG_DIR: base.baseDir })
  })
  it('degrada a null (sin romper el motor) si falta Node, el .cjs o hay rutas relativas', () => {
    expect(shellBgMcpConfig({ ...base, nodePath: null })).toBeNull()
    expect(shellBgMcpConfig({ ...base, scriptPath: null })).toBeNull()
    expect(shellBgMcpConfig({ ...base, nodePath: 'node' })).toBeNull()
    expect(shellBgMcpConfig({ ...base, baseDir: 'work' })).toBeNull()
    expect(shellBgMcpConfig({ ...base, eventsFile: 'e.jsonl' })).toBeNull()
  })
  it('es serializable tal cual para OPENCODE_CONFIG_CONTENT', () => {
    const c = shellBgMcpConfig(base)
    expect(JSON.parse(JSON.stringify({ mcp: { [SHELL_BG_SERVER]: c } })).mcp.bgshell.type).toBe('local')
  })
})

describe('permisos', () => {
  const modes: PermissionModeId[] = ['manual', 'acceptEdits', 'plan', 'auto', 'bypass']
  const bashStar = (mode: PermissionModeId, agent?: string) =>
    rulesetForMode(effectiveModeFor(mode, agent))
      .filter((r) => r.permission === 'bash' && r.pattern === '*')
      .at(-1)!.action

  it.each(modes)('bgshell_start == bash * en %s', (m) => {
    expect(bgshellToolAction(m)).toBe(bashStar(m))
    expect(bgshellToolAction(m, 'plan')).toBe(bashStar(m, 'plan'))
  })
  it('pregunta en todos los modos salvo «Todo sin preguntar»', () => {
    expect(modes.filter((m) => bgshellToolAction(m) === 'ask')).toEqual(['manual', 'acceptEdits', 'plan', 'auto'])
    expect(bgshellToolAction('bypass')).toBe('allow')
  })
  it('reglas de sesión: start como bash, el resto allow; van antes del bloque sin romper el reconocimiento del modo', () => {
    const rules = bgshellSessionRules('manual')
    expect(rules).toEqual([
      { permission: 'bgshell_start', pattern: '*', action: 'ask' },
      { permission: 'bgshell_status', pattern: '*', action: 'allow' },
      { permission: 'bgshell_read', pattern: '*', action: 'allow' },
      { permission: 'bgshell_stop', pattern: '*', action: 'allow' },
      { permission: 'bgshell_list', pattern: '*', action: 'allow' }
    ])
    expect(bgshellSessionRules('bypass')[0]!.action).toBe('allow')
    const sent = [...bgshellSessionRules('auto'), ...rulesetForMode('auto')]
    expect(endsWithRuleset(sent, rulesetForMode('auto'))).toBe(true)
    expect(approvalKindOf(sent)).toBe('auto')
  })
  it('suelo de la config: start pregunta, el resto pasa', () => {
    expect(bgshellConfigPermission()).toEqual({
      bgshell_start: 'ask',
      bgshell_status: 'allow',
      bgshell_read: 'allow',
      bgshell_stop: 'allow',
      bgshell_list: 'allow'
    })
  })
})

describe('prepareShellBgDirs', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'bgprep-'))
  })
  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  posix('crea raíz y work 0700 y el archivo de avisos 0600 vacío; segunda vez lo vacía', () => {
    const p = shellBgPaths(join(tmp, 'shell-bg', 'code'))
    prepareShellBgDirs(p)
    expect(statSync(p.root).mode & 0o777).toBe(0o700)
    expect(statSync(p.baseDir).mode & 0o777).toBe(0o700)
    expect(statSync(p.eventsFile).mode & 0o777).toBe(0o600)
    writeFileSync(p.eventsFile, '{"viejo":1}\n')
    prepareShellBgDirs(p)
    expect(readFileSync(p.eventsFile, 'utf8')).toBe('')
  })
  posix('rechaza una raíz relativa o un archivo de avisos que es un enlace', () => {
    expect(() => prepareShellBgDirs(shellBgPaths('relativa'))).toThrow()
    const p = shellBgPaths(join(tmp, 'r'))
    mkdirSync(p.root, { recursive: true })
    writeFileSync(join(tmp, 'otro'), 'x')
    symlinkSync(join(tmp, 'otro'), p.eventsFile)
    expect(() => prepareShellBgDirs(p)).toThrow()
    expect(readFileSync(join(tmp, 'otro'), 'utf8')).toBe('x')
  })
  it('events.jsonl queda fuera de work (la limpieza de restos solo mira work)', () => {
    const p = shellBgPaths('/x/y')
    expect(p.eventsFile.startsWith(p.baseDir)).toBe(false)
  })
})
