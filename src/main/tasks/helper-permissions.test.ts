import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TASKS_BASE_PERMISSION } from './helper-permissions'
import { buildInlineConfig } from './inline-config'
import { readProjectHelpers } from './project-helpers'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('permisos de ayudantes aislados', () => {
  it('las reglas base coinciden con el agente empaquetado', () => {
    const text = readFileSync('resources/opencode/agents/tasks.md', 'utf8').split('---')[1]
    const permission: Record<string, unknown> = {}
    let parent = ''
    for (const line of text.split('permission:')[1].split('\n')) {
      const m = /^( +)("[^"]*"|[^:]+):\s*(allow|ask|deny)?\s*$/.exec(line)
      if (!m) continue
      const key = m[2].trim().replace(/^"|"$/g, '')
      if (m[1].length === 2) {
        parent = key
        permission[key] = m[3] ?? {}
      } else (permission[parent] as Record<string, string>)[key] = m[3]
    }
    expect(TASKS_BASE_PERMISSION).toEqual(permission)
  })
  it('archivo allow no amplía; se copian todas las contribuciones y solo se restan herramientas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzx-helper-'))
    try {
      mkdirSync(join(dir, '.opencode/agents'), { recursive: true })
      writeFileSync(join(dir, '.opencode/agents/amplio.md'), '---\npermission: allow\ndisallowed_tools: [write]\n---\nAyuda con el pedido.')
      writeFileSync(join(dir, '.opencode/agents/normal.md'), 'Ayuda con el pedido.')
      const helpers = readProjectHelpers(dir)
      const c = buildInlineConfig({
        fullAccess: false,
        extras: [{ path: '/extra' }],
        browserMcp: null,
        computerMcp: null,
        hostMcp: {},
        mcpContribution: { mcp: {}, permission: { 'crm_*': 'ask', 'computer_*': 'deny' } },
        rulesPermission: { bash: { 'npm test': 'allow' } },
        skills: {},
        projectText: { instructionFile: '/instrucciones', skillDirs: [], agents: helpers.agents }
      }) as any
      const p = c.agent.tasks.permission
      expect(c.agent.normal.permission).toEqual(p)
      expect(c.agent.amplio.permission).toEqual({ ...p, write: 'deny', edit: 'deny' })
      expect(p.bash).toMatchObject({ 'git push*': 'deny', 'rm *': 'ask', 'npm test': 'allow' })
      expect(p.external_directory['/extra/*']).toBe('allow')
      expect(p.task).toEqual({ '*': 'deny', 'lazunox-helper': 'allow', amplio: 'allow', normal: 'allow' })
      expect(p['equipo_*']).toBe('allow')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
