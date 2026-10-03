import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IPC_EVENT_CHANNELS, IPC_INVOKE_CHANNELS } from '@shared/ipc'
import { CODE_EVENTS, CODE_INVOKE_CHANNELS } from '@shared/ipc-code'
import { TASKS_EVENT_CHANNELS, TASKS_INVOKE_CHANNELS } from '@shared/ipc-tasks'
import { IPC_EXTRAS_EVENT_CHANNELS, IPC_EXTRAS_INVOKE_CHANNELS } from '@shared/ipc-extras'
import { BROWSER_EVENT_CHANNELS, BROWSER_INVOKE_CHANNELS } from '@shared/ipc-browser'
import { REMOTE_EVENT_CHANNELS, REMOTE_INVOKE_CHANNELS } from '@shared/ipc-remote'
import { IPC_SCHEMAS, missingSchemas } from '../ipc/schemas'
import {
  CELULAR_EVENTS,
  CELULAR_HTTP_POLICY,
  CELULAR_POLICY,
  CELULAR_SUMMARIES,
  decide,
  eventPolicy,
  sanitizeResult,
  type PolicyContext,
  type PolicyDecision,
  type PolicyRequest
} from './policy'

const ctx: PolicyContext = {
  allowedDirs: ['/work/proj', '/work/tasks/a'],
  chatDirs: ['/chat'],
  fullAccessDirs: ['/work/tasks/a'],
  knownModels: new Set(['opencode-go/deepseek-v4.1-flash', 'anthropic/sonnet']),
  permissionKind: (id) => ({ p_edit: 'edit', p_ext: 'external_directory', p_cu: 'computer_click' })[id],
  isDirectory: (p) => (p.endsWith('.txt') ? false : p.endsWith('/dir') ? true : undefined),
  home: '/Users/me'
}

const ipc = (channel: string, payload?: unknown): PolicyRequest => ({ kind: 'ipc', channel, payload })
const http = (method: string, path: string, query?: Record<string, string>, body?: unknown): PolicyRequest => ({
  kind: 'http',
  method,
  path,
  query,
  body
})
const P = '/work/proj'
const dq = { directory: P }
const model = { providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' }

const allow = (d: PolicyDecision): string => ('allow' in d && d.allow ? d.class : 'allow' in d ? `deny:${d.reason}` : 'confirm')
const cls = (r: PolicyRequest, c: PolicyContext = ctx): string => allow(decide(r, c))

const ALL_INVOKE = [
  ...new Set<string>([
    ...IPC_INVOKE_CHANNELS,
    ...CODE_INVOKE_CHANNELS,
    ...TASKS_INVOKE_CHANNELS,
    ...IPC_EXTRAS_INVOKE_CHANNELS,
    ...BROWSER_INVOKE_CHANNELS,
    ...REMOTE_INVOKE_CHANNELS,
    ...missingSchemas(),
    ...Object.keys(IPC_SCHEMAS)
  ])
]
const ALL_EVENTS = [
  ...new Set<string>([
    ...IPC_EVENT_CHANNELS,
    ...Object.values(CODE_EVENTS),
    ...TASKS_EVENT_CHANNELS,
    ...IPC_EXTRAS_EVENT_CHANNELS,
    ...BROWSER_EVENT_CHANNELS,
    ...REMOTE_EVENT_CHANNELS
  ])
]
const ROUTES: string[] = (
  JSON.parse(readFileSync(join(__dirname, '../../../resources/opencode-bin/api-routes.json'), 'utf8')) as { routes: string[] }
).routes

describe('cobertura 100 %', () => {
  it('hay canales que clasificar y todos tienen entrada explícita', () => {
    expect(ALL_INVOKE.length).toBeGreaterThan(200)
    expect(ALL_INVOKE.filter((c) => !Object.hasOwn(CELULAR_POLICY, c))).toEqual([])
  })
  it('no quedan entradas de canales que ya no existen', () => {
    expect(Object.keys(CELULAR_POLICY).filter((c) => !ALL_INVOKE.includes(c))).toEqual([])
  })
  it('todos los eventos tienen política explícita y no hay sobrantes', () => {
    expect(ALL_EVENTS.filter((c) => !Object.hasOwn(CELULAR_EVENTS, c))).toEqual([])
    expect(Object.keys(CELULAR_EVENTS).filter((c) => !ALL_EVENTS.includes(c))).toEqual([])
  })
  it('todas las rutas del motor fijado tienen entrada explícita y no hay sobrantes', () => {
    expect(ROUTES.length).toBeGreaterThan(150)
    expect(ROUTES.filter((r) => !Object.hasOwn(CELULAR_HTTP_POLICY, r))).toEqual([])
    expect(Object.keys(CELULAR_HTTP_POLICY).filter((r) => !ROUTES.includes(r))).toEqual([])
  })
  it('cada acción que puede ser D tiene resumen es/en y todo D estático lo tiene', () => {
    for (const [k, v] of Object.entries({ ...CELULAR_POLICY, ...CELULAR_HTTP_POLICY }))
      if (v === 'D') expect(CELULAR_SUMMARIES[k], k).toBeTypeOf('function')
    for (const k of Object.keys(CELULAR_SUMMARIES))
      expect(Object.hasOwn(CELULAR_POLICY, k) || Object.hasOwn(CELULAR_HTTP_POLICY, k), k).toBe(true)
  })
})

describe('denegar por defecto', () => {
  it('canal desconocido, prototipo y formas raras', () => {
    expect(cls(ipc('nope:nada'))).toBe('deny:unknown-channel')
    expect(cls(ipc('__proto__'))).toBe('deny:unknown-channel')
    expect(cls(ipc('constructor'))).toBe('deny:unknown-channel')
    expect(cls(ipc('toString'))).toBe('deny:unknown-channel')
    expect(cls({ kind: 'zzz' } as unknown as PolicyRequest)).toBe('deny:unknown-request')
    expect(cls({ kind: 'ipc', channel: 5 } as unknown as PolicyRequest)).toBe('deny:forbidden')
  })
  it('no lanza con payloads basura', () => {
    for (const payload of [null, 'x', 5, [], [1], { cwd: 5 }, { cwd: {} }, { paths: 'no' }]) {
      for (const ch of Object.keys(CELULAR_POLICY)) expect(() => decide(ipc(ch, payload), ctx), ch).not.toThrow()
    }
  })
  it('ruta desconocida, método distinto y rutas con trucos', () => {
    expect(cls(http('GET', '/nope', dq))).toBe('deny:unknown-route')
    expect(cls(http('PUT', '/session', dq))).toBe('deny:unknown-route')
    expect(cls(http('GET', '/session/../config', dq))).toBe('deny:unknown-route')
    expect(cls(http('GET', '/session/%2e%2e/config', dq))).toBe('deny:unknown-route')
    expect(cls(http('GET', '//session', dq))).toBe('deny:unknown-route')
    expect(cls(http('GET', '/session?x=1', dq))).toBe('deny:unknown-route')
    expect(cls(http('GET', '/session/a b', dq))).toBe('deny:unknown-route')
    expect(cls(http('GET', 'session', dq))).toBe('deny:unknown-route')
  })
  it('el ámbito vacío o la raíz no abren nada', () => {
    expect(cls(ipc('git:status', { cwd: '/work/proj' }), { allowedDirs: [] })).toBe('deny:out-of-scope')
    expect(cls(ipc('git:status', { cwd: '/etc' }), { allowedDirs: ['/'] })).toBe('deny:out-of-scope')
    expect(cls(ipc('git:status', { cwd: '/work/proj-evil' }))).toBe('deny:out-of-scope')
    expect(cls(ipc('git:status', { cwd: '/work/proj/../../etc' }))).toBe('deny:out-of-scope')
    expect(cls(ipc('git:status', { cwd: 'relativo' }))).toBe('deny:out-of-scope')
  })
})

describe('X: una prueba por cada canal prohibido', () => {
  const xs = Object.entries(CELULAR_POLICY).filter(([, v]) => v === 'X')
  it('hay X', () => expect(xs.length).toBeGreaterThan(60))
  it.each(xs.map(([k]) => k))('%s se rechaza', (ch) => {
    expect(cls(ipc(ch, { cwd: P, folder: P, path: P }))).toBe('deny:forbidden')
    expect(cls(ipc(ch))).toBe('deny:forbidden')
  })
  it('todo remote:* se rechaza, esté o no listado', () => {
    for (const ch of [...REMOTE_INVOKE_CHANNELS, 'remote:confirmAction', 'remote:otro', 'remote:'])
      expect(cls(ipc(ch, { requestId: 'a', accept: true }))).toBe('deny:forbidden')
    expect(eventPolicy('remote:confirmRequest')).toBe('deny')
    expect(eventPolicy('remote:nuevo')).toBe('deny')
  })
  it('las rutas X del motor se rechazan', () => {
    const xr = Object.entries(CELULAR_HTTP_POLICY).filter(([, v]) => v === 'X')
    expect(xr.length).toBeGreaterThan(100)
    for (const [k] of xr) {
      const [m = '', tpl = ''] = k.split(' ')
      const path = tpl.replace(/\{[^}]+\}/g, 'x1').replace('*', 'a/b')
      expect(cls(http(m, path, dq, {})), k).toBe('deny:forbidden')
    }
  })
  it('motivos concretos: terminal, MCP, credenciales, configuración, TUI', () => {
    for (const [m, p] of [
      ['POST', '/session/ses_1/shell'],
      ['POST', '/pty'],
      ['PUT', '/auth/anthropic'],
      ['DELETE', '/auth/anthropic'],
      ['GET', '/provider/auth'],
      ['PATCH', '/config'],
      ['GET', '/config'],
      ['POST', '/global/dispose'],
      ['POST', '/tui/submit-prompt'],
      ['GET', '/mcp'],
      ['POST', '/mcp/x/connect']
    ] as const)
      expect(cls(http(m, p, dq, {})), `${m} ${p}`).toBe('deny:forbidden')
  })
})

describe('D: confirmación en el Mac', () => {
  const D_IPC: Array<[string, unknown]> = [
    ['app:updateDownload', undefined],
    ['app:updateInstall', undefined],
    ['account:signOut', undefined],
    ['opencode:restart', undefined],
    ['settings:set', { tasksGlobalInstructions: 'haz X' }],
    ['settings:set', { theme: 'dark', tasksGlobalInstructions: 'x' }],
    ['settings:addRecentFolder', { path: '/work/nueva' }],
    ['tasks:approveFolder', { folder: '/work/nueva' }],
    ['tasks:start', { folder: '/work/tasks/a', fullAccess: true }],
    ['tasks:grantFullAccess', { folder: '/work/tasks/a' }],
    ['tasks:fullAccess:consent', undefined],
    ['tasks:project:save', { folder: P, instructions: 'x' }],
    ['tasks:project:save', { folder: P, links: [] }],
    ['tasks:memory:save', { folder: P, content: 'x' }],
    ['tasks:memory:delete', { folder: P }],
    ['tasks:network:setToggle', { key: 'npmEnabled', value: true }],
    ['tasks:network:setHost', { host: 'a.com', decision: 'allow' }],
    ['tasks:network:allowOnce', { folder: P, host: 'a.com' }],
    ['tasks:deleteGrant:set', { folder: P, allowed: true }],
    ['tasks:deleteGrant:set', { folder: P, allowed: false }],
    ['routines:save', { name: 'r', folder: P, fullAccess: true }],
    ['routines:save', { name: 'r' }],
    ['routines:toggle', { id: 'a', enabled: true }],
    ['routines:runNow', { id: 'a' }],
    ['computer:resume', undefined],
    ['computer:setGrant', { bundleId: 'com.a', name: 'A', tier: 'full' }],
    ['computer:undenyApp', { bundleId: 'com.a' }],
    ['computer:respondAccess', { id: 'a', decisions: [{ bundleId: 'com.a', name: 'A', decision: 'click' }] }],
    ['computer:respondAccess', { id: 'a', decisions: [], approvePlan: true }],
    ['tasks:folders:link', { folder: P, path: '/otra', mode: 'rw' }],
    ['tasks:folders:unlink', { folder: P, path: '/otra' }],
    ['tasks:trusted:set', { path: '/otra', mode: 'ro' }],
    ['tasks:trusted:remove', { path: '/otra' }],
    ['tasks:prefs:set', { maxServers: 12 }],
    ['tasks:prefs:set', { autoArchiveDays: 1, notify: { done: true } }],
    ['tasks:storage:clean', { key: 'abc', scope: 'all' }],
    ['tasks:storage:cleanScreenshots', undefined],
    ['tasks:storage:cleanRestorePoints', undefined],
    ['tasks:restore:apply', { folder: P, pointId: 'ab' }],
    ['tasks:agentsMd:save', { folder: P, content: 'x' }],
    ['tasks:rules:add', { folder: P, permission: 'bash', patterns: ['*'] }],
    ['computer:prefs:set', { mode: 'full' }],
    ['tasks:auto:set', { enabled: true }],
    ['tasks:auto:clearLog', undefined],
    ['tasks:auto:consider', { folder: P, fullAccess: false, requestId: 'a' }],
    ['git:removeWorktree', { cwd: P, path: `${P}/wt` }],
    ['git:discard', { cwd: P, paths: [], scope: 'all' }],
    ['git:discard', { cwd: P, paths: Array.from({ length: 21 }, (_, i) => `f${i}`) }],
    ['files:rename', { cwd: P, path: 'dir', name: 'x' }],
    ['files:trash', { cwd: P, path: 'desconocido' }],
    ['browser:agent', { owner: { kind: 'code', directory: P }, action: 'resume' }],
    ['browser:respond', { id: 'ab', decision: 'always' }],
    ['browser:respond', { id: 'ab', decision: 'allow' }]
  ]
  it.each(D_IPC.map((c, i) => [i, c[0], c[1]] as const))('#%i %s pide confirmación con resumen es/en', (_i, ch, payload) => {
    const d = decide(ipc(ch, payload), ctx)
    expect('confirm' in d && d.confirm, JSON.stringify(d)).toBe(true)
    if ('confirm' in d) {
      expect(d.summary.es.length).toBeGreaterThan(5)
      expect(d.summary.en.length).toBeGreaterThan(5)
      expect(d.summary.es.startsWith('Acción sensible')).toBe(false)
      expect(d.channel).toBe(ch)
    }
  })
  it('cada canal con resumen está ejercitado como D arriba', () => {
    const covered = new Set(D_IPC.map((c) => c[0]))
    const httpKeys = new Set([
      'POST /permission/{requestID}/reply',
      'POST /session/{sessionID}/permissions/{permissionID}',
      'PATCH /session/{sessionID}',
      'POST /session'
    ])
    for (const k of Object.keys(CELULAR_SUMMARIES)) expect(covered.has(k) || httpKeys.has(k), k).toBe(true)
  })
  it('el detalle muestra rutas con ~ y nº de archivos', () => {
    const d = decide(ipc('git:discard', { cwd: '/Users/me/p', paths: Array.from({ length: 25 }, (_, i) => `f${i}`) }), {
      ...ctx,
      allowedDirs: ['/Users/me/p']
    })
    expect('confirm' in d && d.detail).toEqual(['~/p', '25'])
  })
  it('permission.reply de external_directory, de Control del Mac o de tipo desconocido es D; los normales M', () => {
    const rep = (id: string, body: unknown): string => cls(http('POST', `/permission/${id}/reply`, dq, body))
    expect(rep('p_ext', { reply: 'once' })).toBe('confirm')
    expect(rep('p_cu', { reply: 'once' })).toBe('confirm')
    expect(rep('p_desconocido', { reply: 'once' })).toBe('confirm')
    expect(rep('p_edit', { reply: 'once' })).toBe('M')
    expect(rep('p_ext', { reply: 'reject' })).toBe('M')
    expect(cls(http('POST', '/session/ses_1/permissions/p_edit', dq, { response: 'once' }))).toBe('M')
    expect(cls(http('POST', '/session/ses_1/permissions/p_ext', dq, { response: 'once' }))).toBe('confirm')
  })
  it('sesión con `permission` propio es D', () => {
    expect(cls(http('PATCH', '/session/ses_1', dq, { permission: [] }))).toBe('confirm')
    expect(cls(http('POST', '/session', dq, { permission: [], agent: 'build' }))).toBe('confirm')
  })
})

describe('permission.reply: nunca «siempre»', () => {
  it.each([
    ['POST', '/permission/p_edit/reply', { reply: 'always' }],
    ['POST', '/session/ses_1/permissions/p_edit', { response: 'always' }],
    ['POST', '/permission/p_edit/reply', { reply: 'once', remember: true }],
    ['POST', '/permission/p_edit/reply', { reply: 'siempre' }],
    ['POST', '/permission/p_edit/reply', {}]
  ])('%s %s %j', (m, p, body) => {
    expect(cls(http(m, p, dq, body)).startsWith('deny:')).toBe(true)
  })
  it('el motivo es permission-always', () => {
    expect(cls(http('POST', '/permission/p_edit/reply', dq, { reply: 'always' }))).toBe('deny:permission-always')
  })
})

describe('ámbito de directory y de sesión', () => {
  it('directory fuera del ámbito, ausente o de otra raíz → rechazo', () => {
    expect(cls(http('GET', '/session', { directory: '/etc' }))).toBe('deny:out-of-scope')
    expect(cls(http('GET', '/session', { directory: '/work/proj-evil' }))).toBe('deny:out-of-scope')
    expect(cls(http('GET', '/session', { directory: '/work/proj/../../etc' }))).toBe('deny:out-of-scope')
    expect(cls(http('GET', '/session', { directory: '/' }))).toBe('deny:out-of-scope')
    expect(cls(http('GET', '/session', {}))).toBe('deny:directory-required')
    expect(cls(http('POST', '/session/ses_1/abort', { directory: '/etc' }))).toBe('deny:out-of-scope')
    expect(cls(http('GET', '/file', { directory: '/etc', path: '' }))).toBe('deny:out-of-scope')
  })
  it('dentro del ámbito, Chat y Code', () => {
    expect(cls(http('GET', '/session', dq))).toBe('R')
    expect(cls(http('GET', '/session', { directory: '/chat' }))).toBe('R')
    expect(cls(http('GET', '/session', { directory: `${P}/sub` }))).toBe('R')
    expect(cls(http('GET', '/session/status', dq))).toBe('R')
    expect(cls(http('GET', '/session/ses_1/message', dq))).toBe('R')
  })
  it('la sesión debe ser conocida y de ese directorio', () => {
    const c: PolicyContext = { ...ctx, sessionDir: (id) => ({ ses_a: P, ses_b: '/work/tasks/a' })[id] }
    expect(cls(http('GET', '/session/ses_a/message', dq), c)).toBe('R')
    expect(cls(http('GET', '/session/ses_b/message', dq), c)).toBe('deny:out-of-scope')
    expect(cls(http('GET', '/session/ses_x/message', dq), c)).toBe('deny:session-unknown')
    expect(cls(http('POST', '/session/ses_b/abort', dq), c)).toBe('deny:out-of-scope')
  })
  it('`workspace` y claves raras en la query se rechazan', () => {
    expect(cls(http('GET', '/session', { ...dq, workspace: 'w' }))).toBe('deny:query-forbidden')
    expect(cls(http('GET', '/session', { ...dq, 'a b': '1' }))).toBe('deny:query-forbidden')
  })
  it('lectura de archivos no escapa del directorio', () => {
    expect(cls(http('GET', '/file', { ...dq, path: 'src' }))).toBe('R')
    expect(cls(http('GET', '/file/content', { ...dq, path: 'src/a.ts' }))).toBe('R')
    expect(cls(http('GET', '/file/content', { ...dq, path: '../../etc/passwd' }))).toBe('deny:path-escape')
    expect(cls(http('GET', '/file/content', { ...dq, path: '/etc/passwd' }))).toBe('deny:path-escape')
    expect(cls(http('GET', '/file/status', dq))).toBe('R')
    expect(cls(http('GET', '/find', { ...dq, pattern: 'x' }))).toBe('R')
  })
  it('rutas absolutas IPC fuera del ámbito → rechazo', () => {
    for (const [ch, p] of [
      ['git:status', { cwd: '/etc' }],
      ['git:commit', { cwd: '/etc', message: 'x' }],
      ['files:watch', { folder: '/etc', subId: 'abcdefgh' }],
      ['tasks:deliverables', { folder: '/etc', since: 0 }],
      ['tasks:previewFile', { path: '/etc/passwd' }],
      ['tasks:start', { folder: '/etc' }],
      ['tasks:removeFolder', { folder: '/etc' }],
      ['tasks:folders:check', { path: '/etc' }],
      ['git:removeWorktree', { cwd: P, path: '/etc' }],
      ['routines:save', { name: 'x', folder: '/etc' }],
      ['tasks:rules:list', { folder: '/etc' }],
      ['tasks:viewing', { folder: '/etc' }],
      ['browser:state', { owner: { kind: 'code', directory: '/etc' } }],
      ['browser:navigate', { owner: { kind: 'tasks', folder: '/etc' }, tabId: 't12345678', input: 'x' }],
      ['files:setDirs', { subId: 'abcdefgh', dirs: ['/etc'] }]
    ] as const)
      expect(cls(ipc(ch, p)), ch).toBe('deny:out-of-scope')
  })
  it('subrutas con .. se rechazan', () => {
    expect(cls(ipc('git:diff', { cwd: P, path: '../x' }))).toBe('deny:path-escape')
    expect(cls(ipc('git:discardHunk', { cwd: P, path: '../../x', index: 0, hunk: 'h' }))).toBe('deny:path-escape')
    expect(cls(ipc('git:discard', { cwd: P, paths: ['../x'] }))).toBe('deny:path-escape')
    expect(cls(ipc('files:create', { cwd: P, parent: '../x', name: 'a', kind: 'file' }))).toBe('deny:path-escape')
    expect(cls(ipc('files:create', { cwd: P, parent: '', name: '../a', kind: 'file' }))).toBe('deny:name-invalid')
    expect(cls(ipc('files:rename', { cwd: P, path: 'a.txt', name: 'b/c' }))).toBe('deny:name-invalid')
    expect(cls(ipc('files:trash', { cwd: P, path: '../x.txt' }))).toBe('deny:path-escape')
    expect(cls(ipc('files:setDirs', { subId: 'abcdefgh', dirs: ['../x'] }))).toBe('deny:out-of-scope')
  })
})

describe('settings:set y setters por campos', () => {
  it('settings:set{opencodeBin} rechazado (y cualquier mezcla con él)', () => {
    expect(cls(ipc('settings:set', { opencodeBin: '/tmp/evil' }))).toBe('deny:field-forbidden:opencodeBin')
    expect(cls(ipc('settings:set', { theme: 'dark', opencodeBin: '/tmp/evil' }))).toBe('deny:field-forbidden:opencodeBin')
    for (const f of ['checkUpdates', 'recentFolders', 'onboarded', 'routinesTermsAcknowledged', 'otro'])
      expect(cls(ipc('settings:set', { [f]: true })), f).toBe(`deny:field-forbidden:${f}`)
    expect(cls(ipc('settings:set', {}))).toBe('deny:empty-payload')
  })
  it('settings:set solo defaultModel/theme/language son M', () => {
    expect(cls(ipc('settings:set', { theme: 'dark' }))).toBe('M')
    expect(cls(ipc('settings:set', { defaultModel: model, language: 'en' }))).toBe('M')
  })
  it('extras:setPrefs por campos', () => {
    expect(cls(ipc('extras:setPrefs', { soundEnabled: false, showTray: true }))).toBe('M')
    expect(cls(ipc('extras:setPrefs', { quickEntryShortcut: 'Alt+X' }))).toBe('deny:field-forbidden:quickEntryShortcut')
    expect(cls(ipc('extras:setPrefs', { soundEnabled: true, keybindings: {} }))).toBe('deny:field-forbidden:keybindings')
  })
  it('tasks:prefs:set y computer:prefs:set por campos', () => {
    expect(cls(ipc('tasks:prefs:set', { notify: { done: true }, stallWarnMinutes: 5 }))).toBe('M')
    expect(cls(ipc('tasks:prefs:set', { zzz: 1 }))).toBe('deny:field-forbidden:zzz')
    expect(cls(ipc('computer:prefs:set', { hideOtherApps: true }))).toBe('M')
    expect(cls(ipc('computer:prefs:set', { zzz: true }))).toBe('deny:field-forbidden:zzz')
  })
})

describe('prompts', () => {
  const prompt = (body: unknown, query: Record<string, string> = dq): string =>
    cls(http('POST', '/session/ses_1/prompt_async', query, body))
  const text = { type: 'text', text: 'hola' }
  it('Code: texto, data: y file:// bajo el directorio', () => {
    expect(prompt({ agent: 'build', model, parts: [text] })).toBe('M')
    expect(
      prompt({ agent: 'plan', parts: [text, { type: 'file', mime: 'image/png', filename: 'a.png', url: 'data:image/png;base64,AAAA' }] })
    ).toBe('M')
    expect(
      prompt({
        agent: 'build',
        parts: [
          {
            type: 'file',
            mime: 'text/plain',
            filename: 'a',
            url: `file://${P}/src/a.ts`,
            source: { type: 'file', path: `${P}/src/a.ts`, text: {} }
          }
        ]
      })
    ).toBe('M')
  })
  it('file:// fuera del directorio de la sesión → rechazo', () => {
    const f = (url: string): string => prompt({ agent: 'build', parts: [{ type: 'file', mime: 'text/plain', filename: 'a', url }] })
    expect(f('file:///etc/passwd')).toBe('deny:file-url-out-of-scope')
    expect(f(`file://${P}/../../etc/passwd`)).toBe('deny:file-url-out-of-scope')
    expect(f('file:///work/proj-evil/a')).toBe('deny:file-url-out-of-scope')
    expect(f(`file://${P}/%2e%2e/x`)).toBe('deny:file-url-out-of-scope')
    expect(f('file://host/etc/passwd')).toBe('deny:part-url-invalid')
    expect(f('file:///work/tasks/a/x')).toBe('deny:file-url-out-of-scope') // otra carpeta permitida, no la de la sesión
  })
  it('file:// source.path fuera del directorio → rechazo', () => {
    expect(
      prompt({ agent: 'build', parts: [{ type: 'file', mime: 'a/b', url: 'data:a/b;base64,AA', source: { path: '/etc/passwd' } }] })
    ).toBe('deny:file-url-out-of-scope')
  })
  it('Chat: nunca file://; sí data:', () => {
    const chat = { directory: '/chat' }
    expect(prompt({ agent: 'chat', parts: [text] }, chat)).toBe('M')
    expect(prompt({ agent: 'chat', parts: [{ type: 'file', mime: 'a/b', filename: 'a', url: 'data:a/b;base64,AA' }] }, chat)).toBe('M')
    expect(prompt({ agent: 'chat', parts: [{ type: 'file', mime: 'a/b', filename: 'a', url: 'file:///chat/x' }] }, chat)).toBe(
      'deny:file-url-chat'
    )
    expect(prompt({ agent: 'chat', parts: [{ type: 'file', mime: 'a/b', filename: 'a', url: `file://${P}/x` }] })).toBe(
      'deny:file-url-chat'
    )
  })
  it('esquemas de URL y tipos de parte no permitidos', () => {
    const f = (url: string): string => prompt({ agent: 'build', parts: [{ type: 'file', mime: 'a/b', url }] })
    expect(f('https://evil.com/x')).toBe('deny:part-url-scheme')
    expect(f('javascript:alert(1)')).toBe('deny:part-url-scheme')
    expect(f('data:text/html,<b>')).toBe('deny:part-url-invalid')
    expect(prompt({ agent: 'build', parts: [{ type: 'subtask', prompt: 'x' }] })).toBe('deny:part-type')
    expect(prompt({ agent: 'build', parts: [] })).toBe('deny:parts-invalid')
    expect(prompt({ agent: 'build', parts: [{ type: 'text', text: 'a', synthetic: true }] })).toBe('deny:parts-invalid')
  })
  it('el agente y el cuerpo están acotados', () => {
    expect(prompt({ parts: [text] })).toBe('deny:agent-forbidden')
    expect(prompt({ agent: 'general', parts: [text] })).toBe('deny:agent-forbidden')
    expect(prompt({ agent: 'build', parts: [text] }, { directory: '/chat' })).toBe('deny:agent-not-chat')
    expect(prompt({ agent: 'build', parts: [text], tools: { bash: true } })).toBe('deny:body-field-forbidden')
    expect(prompt({ agent: 'build', parts: [text], system: 'x' })).toBe('deny:body-field-forbidden')
  })
  it('el modelo debe estar en provider.list', () => {
    expect(prompt({ agent: 'build', model: { providerID: 'x', modelID: 'y' }, parts: [text] })).toBe('deny:model-unknown')
    expect(prompt({ agent: 'build', model: 'no-es-objeto', parts: [text] })).toBe('deny:model-invalid')
    expect(
      cls(http('POST', '/session/ses_1/prompt_async', dq, { agent: 'build', model, parts: [text] }), { ...ctx, knownModels: undefined })
    ).toBe('deny:model-unknown')
    expect(cls(http('POST', '/session/ses_1/command', dq, { command: 'init', agent: 'build', model: 'x/y' }))).toBe('deny:model-unknown')
    expect(cls(http('POST', '/session/ses_1/command', dq, { command: 'init', agent: 'build', model: 'anthropic/sonnet' }))).toBe('M')
    expect(cls(http('POST', '/session/ses_1/summarize', dq, { providerID: 'x', modelID: 'y' }))).toBe('deny:model-unknown')
    expect(cls(http('POST', '/session/ses_1/summarize', dq, { providerID: 'anthropic', modelID: 'sonnet' }))).toBe('M')
  })
  it('el agente computer solo en carpetas con control total confirmado', () => {
    const body = { agent: 'computer', parts: [text] }
    expect(prompt(body, { directory: '/work/tasks/a' })).toBe('M')
    expect(prompt(body)).toBe('deny:computer-agent-unconfirmed')
  })
})

describe('Chat y Code por HTTP (clases de la tabla)', () => {
  it('lecturas R', () => {
    for (const [p, q] of [
      ['/session', dq],
      ['/session/status', dq],
      ['/session/ses_1', dq],
      ['/session/ses_1/message', dq],
      ['/session/ses_1/todo', dq],
      ['/experimental/session', {}],
      ['/provider', {}],
      ['/config/providers', {}],
      ['/file', { ...dq, path: '.' }],
      ['/file/status', dq],
      ['/find/file', { ...dq, query: 'a' }],
      ['/global/event', {}]
    ] as const)
      expect(cls(http('GET', p, q)), p).toBe('R')
  })
  it('mutaciones M', () => {
    expect(cls(http('POST', '/session', { directory: '/chat' }, { agent: 'chat', metadata: { mode: 'chat' } }))).toBe('M')
    expect(cls(http('POST', '/session', dq, { title: 't' }))).toBe('M')
    expect(cls(http('PATCH', '/session/ses_1', dq, { title: 'nuevo' }))).toBe('M')
    expect(cls(http('PATCH', '/session/ses_1', dq, { time: { archived: 1 } }))).toBe('M')
    expect(cls(http('DELETE', '/session/ses_1', dq))).toBe('M')
    expect(cls(http('POST', '/session/ses_1/abort', dq))).toBe('M')
    expect(cls(http('POST', '/session/ses_1/revert', dq, { messageID: 'm' }))).toBe('M')
    expect(cls(http('POST', '/session/ses_1/unrevert', dq))).toBe('M')
    expect(cls(http('POST', '/session/ses_1/fork', dq, { messageID: 'm' }))).toBe('M')
    expect(cls(http('POST', '/question/q1/reply', dq, { answers: [['a']] }))).toBe('M')
    expect(cls(http('POST', '/question/q1/reject', dq))).toBe('M')
  })
  it('cuerpos con campos ajenos se rechazan', () => {
    expect(cls(http('PATCH', '/session/ses_1', dq, { share: true }))).toBe('deny:body-field-forbidden')
    expect(cls(http('PATCH', '/session/ses_1', dq, { time: { archived: 1, x: 1 } }))).toBe('deny:body-field-forbidden')
    expect(cls(http('POST', '/session', dq, { workspaceID: 'w', agent: 'build' }))).toBe('deny:body-field-forbidden')
    expect(cls(http('POST', '/session/ses_1/revert', dq, { x: 1 }))).toBe('deny:body-field-forbidden')
  })
})

describe('git, archivos, navegador y Tareas', () => {
  it('git: lecturas R y mutaciones M', () => {
    for (const ch of ['git:isRepo', 'git:status', 'git:branches', 'git:currentBranch', 'git:worktrees', 'git:log'])
      expect(cls(ipc(ch, { cwd: P })), ch).toBe('R')
    expect(cls(ipc('git:diff', { cwd: P, path: 'a.ts' }))).toBe('R')
    for (const [ch, p] of [
      ['git:commit', { cwd: P, message: 'm' }],
      ['git:createWorktree', { cwd: P, branch: 'b' }],
      ['git:discardUndo', { cwd: P, undoId: 'x' }],
      ['git:discardHunk', { cwd: P, path: 'a', index: 0, hunk: 'h' }]
    ] as const)
      expect(cls(ipc(ch, p)), ch).toBe('M')
  })
  it('git:discard: ≤20 archivos M, 21 o scope all D', () => {
    const paths = (n: number): string[] => Array.from({ length: n }, (_, i) => `f${i}`)
    expect(cls(ipc('git:discard', { cwd: P, paths: paths(20) }))).toBe('M')
    expect(cls(ipc('git:discard', { cwd: P, paths: paths(20), scope: 'unstaged' }))).toBe('M')
    expect(cls(ipc('git:discard', { cwd: P, paths: paths(21) }))).toBe('confirm')
    expect(cls(ipc('git:discard', { cwd: P, paths: paths(1), scope: 'all' }))).toBe('confirm')
  })
  it('archivos: crear, renombrar y papelera de un archivo M; carpeta o desconocido D', () => {
    expect(cls(ipc('files:create', { cwd: P, parent: 'src', name: 'a.ts', kind: 'file' }))).toBe('M')
    expect(cls(ipc('files:rename', { cwd: P, path: 'src/a.txt', name: 'b.txt' }))).toBe('M')
    expect(cls(ipc('files:trash', { cwd: P, path: 'src/a.txt' }))).toBe('M')
    expect(cls(ipc('files:rename', { cwd: P, path: 'src/dir', name: 'x' }))).toBe('confirm')
    expect(cls(ipc('files:trash', { cwd: P, path: 'src/dir' }))).toBe('confirm')
    expect(cls(ipc('files:trash', { cwd: P, path: 'src/a.txt' }), { ...ctx, isDirectory: undefined })).toBe('confirm')
    expect(cls(ipc('files:watch', { folder: P, subId: 'abcdefgh' }))).toBe('R')
    expect(cls(ipc('files:setDirs', { subId: 'abcdefgh', dirs: [P, 'src'] }))).toBe('R')
    expect(cls(ipc('files:unwatch', { subId: 'abcdefgh' }))).toBe('R')
  })
  it('navegador: leer/cerrar M, reanudar D, denegar M', () => {
    const owner = { kind: 'code', directory: P }
    expect(cls(ipc('browser:state', { owner }))).toBe('R')
    expect(cls(ipc('browser:capture', { owner, tabId: 't12345678' }))).toBe('R')
    expect(cls(ipc('browser:navigate', { owner, tabId: 't12345678', input: 'localhost:3000' }))).toBe('M')
    expect(cls(ipc('browser:agent', { owner, action: 'stop' }))).toBe('M')
    expect(cls(ipc('browser:respond', { id: 'ab', decision: 'deny' }))).toBe('M')
  })
  it('Tareas: iniciar sin control total M, con él D; revocar M', () => {
    expect(cls(ipc('tasks:start', { folder: '/work/tasks/a' }))).toBe('M')
    expect(cls(ipc('tasks:start', { folder: '/work/tasks/a', fullAccess: false }))).toBe('M')
    expect(cls(ipc('tasks:revokeFullAccess', { folder: '/work/tasks/a' }))).toBe('M')
    expect(cls(ipc('computer:stop'))).toBe('M')
    expect(cls(ipc('computer:respondAccess', { id: 'a', decisions: [{ bundleId: 'x', name: 'X', decision: 'deny' }] }))).toBe('M')
    expect(cls(ipc('routines:toggle', { id: 'a', enabled: false }))).toBe('M')
    expect(cls(ipc('tasks:previewFile', { path: `${P}/a.png`, maxBytes: 9 * 1024 * 1024 }))).toBe('deny:too-large')
  })
})

describe('eventos y resultados', () => {
  it('denegar por defecto', () => {
    expect(eventPolicy('algo:nuevo')).toBe('deny')
    expect(eventPolicy('__proto__')).toBe('deny')
    expect(eventPolicy('opencode:status')).toBe('allow')
    expect(eventPolicy('opencode:connection')).toBe('sanitize')
    expect(eventPolicy('pty:data')).toBe('deny')
  })
  it('app:info pierde userDataPath', () => {
    const src = { name: 'x', userDataPath: '/Users/me/Library', chatDirectory: '/chat' }
    expect(sanitizeResult('app:info', src)).toEqual({ name: 'x', chatDirectory: '/chat' })
    expect(src.userDataPath).toBe('/Users/me/Library')
    expect(sanitizeResult('settings:get', src)).toBe(src)
  })
})
