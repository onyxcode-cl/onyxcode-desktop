// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'
import { mount, type Mounted } from '../../../../../test/dom-render'
import { setLang } from '@shared/i18n'
const m = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  enable: vi.fn(),
  reply: vi.fn(),
  input: null as Record<string, unknown> | null,
  remote: false
}))
vi.mock('./store', () => ({
  useTasks: Object.assign((sel: (s: unknown) => unknown) => sel(m.state), { setState: (s: unknown) => Object.assign(m.state, s) })
}))
vi.mock('./actions', () => ({ replyPermission: m.reply, replyPermissionAlways: vi.fn() }))
vi.mock('./delete-grant-retry', () => ({ enableDeleteAndRetry: m.enable }))
vi.mock('./PermissionCardDesk', () => ({ PermissionCardDesk: () => <div>normal</div>, ApprovalBarDesk: () => <div>barra normal</div> }))
vi.mock('./FolderRequestCard', () => ({ FolderRequestCard: () => <div>otra carpeta</div> }))
vi.mock('./subagent-of-request', () => ({ useTaskSubagentOfRequest: () => ({ child: false }) }))
vi.mock('../../../stores/sessions', () => ({
  useSessions: (sel: (s: unknown) => unknown) =>
    sel({ messages: { s: [{ parts: [{ type: 'tool', callID: 'call', state: { input: m.input } }] }] } })
}))
vi.mock('../../../lib/platform', () => ({ isRemoteSurface: () => m.remote }))
vi.mock('../../../lib/i18n', async () => {
  const { t } = await import('@shared/i18n')
  return { useT: () => t }
})
import { PermissionCard, ApprovalBar } from './PermissionPrompt'
let mounted: Mounted | undefined
const req = (command = 'rm viejo.txt'): PermissionRequest => ({
  id: 'p',
  sessionID: 's',
  permission: 'bash',
  patterns: [command],
  metadata: { command },
  always: [],
  tool: { callID: 'call', messageID: 'msg' }
})
beforeEach(() => {
  setLang('es')
  vi.resetAllMocks()
  m.input = null
  m.remote = false
  m.state = { folder: '/fixture', conn: { fullAccess: false }, deleteGrant: false, deleteGrantBusy: false, autoPending: {} }
})
afterEach(() => {
  mounted?.unmount()
  mounted = undefined
  setLang('es')
})
const render = (command = 'rm viejo.txt'): void => {
  mounted = mount(<PermissionCard request={req(command)} />)
}
describe('tarjeta de borrado antes del comando', () => {
  it.each([
    'rm viejo.txt',
    'mv a b',
    'rename a b',
    '/bin/rm a',
    'python3 -c \'import os; os.rename("a","b")\'',
    `python3 -c 'from pathlib import Path; Path("a").unlink()'`,
    'Remove-Item a',
    'Move-Item a b',
    'Rename-Item a b',
    'find . -delete'
  ])('%s ofrece activar o cancelar, sin una vez ni siempre', (command) => {
    render(command)
    expect(mounted!.host.textContent).toContain(command)
    expect(mounted!.qa('button').map((b) => b.textContent)).toEqual(['Cancelar', 'Activar permiso y reintentar'])
    expect(mounted!.host.textContent).toContain('toda esta carpeta')
    expect(mounted!.host.textContent).toContain('se interrumpen sus tareas')
  })
  it('activar usa el flujo real una sola vez; cancelar solo rechaza', async () => {
    render()
    await act(async () => {
      mounted!.qa<HTMLButtonElement>('button')[1].click()
      mounted!.qa<HTMLButtonElement>('button')[1].click()
    })
    expect(m.enable).toHaveBeenCalledTimes(1)
    expect(m.reply).not.toHaveBeenCalled()
    mounted!.unmount()
    mounted = undefined
    render()
    await act(async () => mounted!.qa<HTMLButtonElement>('button')[0].click())
    expect(m.reply).toHaveBeenCalledWith('p', 'reject')
  })
  it('muestra el error y deja el aviso global si falla después del reinicio', async () => {
    m.enable.mockRejectedValue(new Error('fallo simulado'))
    render()
    await act(async () => mounted!.qa<HTMLButtonElement>('button')[1].click())
    expect(mounted!.q('[role="alert"]')?.textContent).toBe('fallo simulado')
    expect(m.state.error).toBe('fallo simulado')
  })
  it('permiso aún sin cargar: no permite activarlo ni ofrece una vez', () => {
    m.state.deleteGrant = null
    render()
    expect(mounted!.qa<HTMLButtonElement>('button')[1].disabled).toBe(true)
  })
  it.each(['cat archivo.txt', 'echo hola'])('lectura o comando corriente conserva la tarjeta normal: %s', (command) => {
    render(command)
    expect(mounted!.host.textContent).toBe('normal')
  })
  it.each([true, false])('Control total o permiso concedido conservan aprobación normal (%s)', (full) => {
    m.state.conn = { fullAccess: full }
    m.state.deleteGrant = !full
    render()
    expect(mounted!.host.textContent).toBe('normal')
  })
  it('sin metadata usa argumentos de la llamada, antes que patrones incompletos', () => {
    m.input = { command: 'mv a b' }
    const r = { ...req('bash *'), metadata: {} }
    mounted = mount(<PermissionCard request={r} />)
    expect(mounted.host.textContent).toContain('Activar permiso y reintentar')
    expect(mounted.host.textContent).toContain('mv a b')
  })
  it.each([false, true])('barra fija y celular tampoco ofrecen una vez (celular=%s)', (remote) => {
    m.remote = remote
    mounted = mount(<ApprovalBar requests={[req()]} />)
    expect(mounted.host.textContent).toContain('Activar permiso y reintentar')
    expect(mounted.qa('button')).toHaveLength(2)
    expect(mounted.q('#perm-p')).toBeNull()
    expect(mounted.q('#delete-bar-p')).not.toBeNull()
  })
  it('advierte de caracteres ocultos sin quitar el comando literal', () => {
    render('rm a\u200B')
    expect(mounted!.host.textContent).toContain('Contiene caracteres de control')
  })
  it('inglés traduce la consecuencia, activación y cancelación', () => {
    setLang('en')
    m.remote = true
    render()
    expect(mounted!.host.textContent).toContain('The folder’s server will restart')
    expect(mounted!.qa('button').map((b) => b.textContent)).toEqual(['Cancel', 'Enable permission and retry'])
  })
})
