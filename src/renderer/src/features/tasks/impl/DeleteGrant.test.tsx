// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import { mount, type Mounted } from '../../../../../test/dom-render'
import { assistantMessage, toolPart } from '../../../../../test/fixtures/events'
import type { MessageEntry } from '../../../stores/sessions'

const m = vi.hoisted(() => ({ state: {} as Record<string, unknown>, enable: vi.fn(), reply: vi.fn(), grant: vi.fn() }))
vi.mock('./store', () => ({
  useTasks: Object.assign((sel: (s: unknown) => unknown) => sel(m.state), { setState: (s: unknown) => Object.assign(m.state, s) })
}))
vi.mock('./actions', () => ({ replyPermission: m.reply, setDeleteGrantAllowed: m.grant }))
vi.mock('./delete-grant-retry', () => ({ enableDeleteAndRetry: m.enable }))
import { DeleteGrantHintCard } from './DeleteGrant'

let mounted: Mounted | undefined
beforeEach(() => {
  vi.resetAllMocks()
  m.state = { folder: '/work', conn: { folder: '/work', fullAccess: false }, deleteGrant: false, deleteGrantBusy: false }
})
afterEach(() => mounted?.unmount())
function render(input: Record<string, unknown>, error = 'PermissionDenied: FileSystem.remove', tool = 'apply_patch'): ToolPart {
  const p = toolPart('p', 'm', 's', tool, { status: 'error', input, error }) as ToolPart
  const entries: MessageEntry[] = [{ info: assistantMessage('m', 's'), parts: [p] }]
  mounted = mount(<DeleteGrantHintCard entries={entries} />)
  return p
}
const patchText = '*** Begin Patch\n*** Delete File: temporal.txt\n*** End Patch'
describe('tarjeta tras un borrado denegado', () => {
  it.each(['mac', 'wsl'])('parche denegado en %s: misma tarjeta y reintento, solo al hacer clic', async (platform) => {
    if (platform === 'wsl') m.state = { ...m.state, folder: 'C:\\work', conn: { folder: 'C:\\work', directory: '/win/c/work' } }
    const p = render({ patchText })
    expect(mounted!.host.textContent).toContain('Activar permiso y reintentar')
    expect(mounted!.host.textContent).toContain('toda esta carpeta')
    expect(m.enable).not.toHaveBeenCalled()
    expect(m.grant).not.toHaveBeenCalled()
    await act(async () => mounted!.qa<HTMLButtonElement>('button')[1].click())
    expect(m.enable).toHaveBeenCalledExactlyOnceWith(p)
    expect(m.reply).not.toHaveBeenCalled()
  })
  it('parche que solo edita y falla al escribir no ofrece permiso', () => {
    render({ patchText: '*** Begin Patch\n*** Update File: a.txt\n@@\n-a\n+b\n*** End Patch' }, 'PermissionDenied: FileSystem.writeFile')
    expect(mounted!.host.textContent).toBe('')
  })
  it.each(['Operation not permitted', 'Permission denied', 'EPERM', 'EACCES'])('rm sigue ofreciendo el reintento: %s', (error) => {
    render({ command: 'rm temporal.txt' }, error, 'bash')
    expect(mounted!.host.textContent).toContain('Activar permiso y reintentar')
  })
  it('cancelar oculta la tarjeta sin conceder ni responder a un permiso inexistente', async () => {
    render({ patchText })
    await act(async () => mounted!.qa<HTMLButtonElement>('button')[0].click())
    expect(mounted!.host.textContent).toBe('')
    expect(m.enable).not.toHaveBeenCalled()
    expect(m.reply).not.toHaveBeenCalled()
    expect(m.grant).not.toHaveBeenCalled()
  })
  it.each(['../fuera/a.txt', '/otra/a.txt', '.lazunox/memoria.md', '.git/hooks/pre-commit', 'extra/a.txt'])(
    'no ofrece ampliar una ruta excluida: %s',
    (path) => {
      m.state.folderSet = { linked: [{ path: '/work/extra' }], trusted: [] }
      render({ patchText: `*** Begin Patch\n*** Delete File: ${path}\n*** End Patch` })
      expect(mounted!.host.textContent).toBe('')
    }
  )
  it.each([true, false])('con permiso o Control total no ofrece la tarjeta (%s)', (fullAccess) => {
    m.state.conn = { folder: '/work', fullAccess }
    m.state.deleteGrant = !fullAccess
    render({ patchText })
    expect(mounted!.host.textContent).toBe('')
  })
  it('permiso sin cargar: muestra la consecuencia, pero no permite activar', () => {
    m.state.deleteGrant = null
    render({ patchText })
    expect(mounted!.qa<HTMLButtonElement>('button')[1].disabled).toBe(true)
  })
})
