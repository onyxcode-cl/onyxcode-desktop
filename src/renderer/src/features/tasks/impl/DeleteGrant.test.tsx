// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import { mount, type Mounted } from '../../../../../test/dom-render'
import { assistantMessage, textPart, toolPart, userMessage } from '../../../../../test/fixtures/events'
import type { MessageEntry } from '../../../stores/sessions'

const m = vi.hoisted(() => ({ state: {} as Record<string, unknown>, enable: vi.fn(), reply: vi.fn(), grant: vi.fn() }))
vi.mock('./store', () => ({
  rootTaskId: (id: string) => id,
  useTasks: Object.assign((sel: (s: unknown) => unknown) => sel(m.state), { setState: (s: unknown) => Object.assign(m.state, s) })
}))
vi.mock('./actions', () => ({ replyPermission: m.reply, setDeleteGrantAllowed: m.grant }))
vi.mock('./delete-grant-retry', () => ({ enableDeleteAndRetry: m.enable }))
import { DeleteGrantHintCard } from './DeleteGrant'

let mounted: Mounted | undefined
beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  m.state = { folder: '/work', conn: { folder: '/work', fullAccess: false }, deleteGrant: false, deleteGrantBusy: false }
})

describe.each(['mac', 'wsl'])('vigencia de la oferta posterior al fallo (%s)', (platform) => {
  beforeEach(() => {
    if (platform === 'wsl') m.state = { ...m.state, folder: 'C:\\work', conn: { folder: 'C:\\work', directory: '/win/c/work' } }
  })
  const blocked = (): MessageEntry => ({
    info: assistantMessage('m1', 's', { time: { created: 1000, completed: 2000 }, finish: 'tool-calls' }),
    parts: [
      toolPart('p1', 'm1', 's', 'bash', {
        status: 'completed',
        input: { command: 'mv temporal.xlsx ventas-v2.xlsx' },
        output: 'Permission denied',
        metadata: { exit: 1 }
      })
    ]
  })
  const show = (entries: MessageEntry[]): void => {
    if (mounted) mounted.rerender(<DeleteGrantHintCard entries={entries} />)
    else mounted = mount(<DeleteGrantHintCard entries={entries} />)
  }
  beforeEach(() => {
    mounted = undefined
  })

  it.each([
    'rm nuevo; cat restringido',
    'rm borrador.txt && ls -la; echo listo',
    'test -e borrador.txt && rm borrador.txt; test -e borrador.txt && echo "todavía existe" || echo "borrado"',
    'rm informe.docx'
  ])('borrado propio confirmado sin tarjeta, tampoco al recargar: %s', (command) => {
    const e = blocked()
    const p = e.parts[0] as ToolPart
    p.state = {
      ...p.state,
      input: { command },
      output: 'cat: Permission denied',
      metadata: { exit: 1, lazunoxOwnDelete: true }
    } as ToolPart['state']
    show([e])
    expect(mounted!.host.textContent).toBe('')
    mounted!.unmount()
    mounted = undefined
    show([e])
    expect(mounted!.host.textContent).toBe('')
    expect(m.grant).not.toHaveBeenCalled()
    expect(m.enable).not.toHaveBeenCalled()
  })
  it.each([
    'rm borrador.txt && ls -la; echo listo',
    'test -e borrador.txt && rm borrador.txt; test -e borrador.txt && echo "todavía existe" || echo "borrado"',
    'test -e otro.txt && rm borrador.txt',
    'rm informe.docx'
  ])('borrado previo o guardia distinta conserva la tarjeta sin confirmación de main: %s', (command) => {
    const e = blocked()
    const p = e.parts[0] as ToolPart
    p.state = { ...p.state, input: { command } } as ToolPart['state']
    show([e])
    expect(mounted!.host.textContent).toContain('Activar permiso y reintentar')
    expect(m.grant).not.toHaveBeenCalled()
    expect(m.enable).not.toHaveBeenCalled()
  })

  it('un movimiento exitoso con un error recuperado en la salida no ofrece permiso', () => {
    const e = blocked()
    const p = e.parts[0] as ToolPart
    p.state = { ...p.state, metadata: { exit: 0 } } as ToolPart['state']
    show([e])
    expect(mounted!.host.textContent).toBe('')
    expect(m.grant).not.toHaveBeenCalled()
  })

  it('un intento bloqueado vigente mantiene la oferta aunque el mensaje de herramientas haya completado', () => {
    show([blocked()])
    expect(mounted!.host.textContent).toContain('Activar permiso y reintentar')
    expect(m.grant).not.toHaveBeenCalled()
    expect(m.enable).not.toHaveBeenCalled()
  })

  it('se retira al empezar otra vía y no reaparece al terminar ni al recargar el historial', () => {
    const first = blocked()
    show([first])
    expect(mounted!.host.textContent).toContain('Activar permiso y reintentar')
    const next: MessageEntry = {
      info: assistantMessage('m2', 's'),
      parts: [toolPart('p2', 'm2', 's', 'bash', { status: 'running', input: { command: 'python3 crear_copia.py' } })]
    }
    show([first, next])
    expect(mounted!.host.textContent).toBe('')
    next.parts = [toolPart('p2', 'm2', 's', 'bash', { status: 'completed', input: {}, output: 'OK', metadata: { exit: 0 } })]
    const final: MessageEntry = {
      info: assistantMessage('m3', 's', { time: { created: 3000, completed: 4000 }, finish: 'stop' }),
      parts: [textPart('p3', 'm3', 's', 'Archivo listo.')]
    }
    show([first, next, final])
    expect(mounted!.host.textContent).toBe('')
    mounted!.unmount()
    mounted = undefined
    show([first, next, final])
    expect(mounted!.host.textContent).toBe('')
  })

  it.each(['stop', undefined])(
    'bloqueado en la última tanda y respuesta final (%s): la tarjeta sigue al recargar y permite reintentar',
    async (finish) => {
      const first = blocked()
      show([first])
      const final: MessageEntry = {
        info: assistantMessage('m2', 's', { time: { created: 3000, completed: 4000 }, finish }),
        parts: [textPart('p2', 'm2', 's', 'No pude mover el archivo por falta de permiso.')]
      }
      show([first, final])
      expect(mounted!.host.textContent).toContain('Activar permiso y reintentar')
      mounted!.unmount()
      mounted = undefined
      show([first, final])
      expect(mounted!.host.textContent).toContain('Activar permiso y reintentar')
      expect(m.enable).not.toHaveBeenCalled()
      await act(async () => mounted!.qa<HTMLButtonElement>('button')[1].click())
      expect(m.enable).toHaveBeenCalledExactlyOnceWith(first.parts[0], { folder: m.state.folder, conn: m.state.conn })
    }
  )

  it('conserva el bloqueo si la respuesta final completa el mismo mensaje que la herramienta', () => {
    const first = blocked()
    first.info = assistantMessage('m1', 's', { time: { created: 1000, completed: 2000 }, finish: 'stop' })
    first.parts.push(textPart('final', 'm1', 's', 'No pude mover el archivo.'))
    show([first])
    expect(mounted!.host.textContent).toContain('Activar permiso y reintentar')
  })

  it('un error del modelo conserva el bloqueo de la última tanda', () => {
    show([blocked(), { info: assistantMessage('m2', 's', { error: { name: 'UnknownError', data: { message: 'Error' } } }), parts: [] }])
    expect(mounted!.host.textContent).toContain('Activar permiso y reintentar')
  })

  it.each(['nuevo pedido', 'cancelación del turno'])('se retira con %s y no revive al recargar', (reason) => {
    const first = blocked()
    show([first])
    expect(mounted!.host.textContent).toContain('Activar permiso y reintentar')
    const entries: MessageEntry[] = [
      first,
      {
        info:
          reason === 'nuevo pedido'
            ? userMessage('u2', 's')
            : assistantMessage('m2', 's', { error: { name: 'MessageAbortedError', data: { message: 'Aborted' } } }),
        parts: []
      }
    ]
    show(entries)
    expect(mounted!.host.textContent).toBe('')
    mounted!.unmount()
    mounted = undefined
    show(entries)
    expect(mounted!.host.textContent).toBe('')
  })

  it('un fallo nuevo conserva su propia oferta, sin rescatar el antiguo al cancelarla', async () => {
    const first = blocked()
    const next = blocked()
    next.info = assistantMessage('m2', 's')
    next.parts = [toolPart('p2', 'm2', 's', 'bash', { status: 'error', input: { command: 'rm nuevo.txt' }, error: 'Permission denied' })]
    const final: MessageEntry = {
      info: assistantMessage('m3', 's', { time: { created: 3000, completed: 4000 }, finish: 'stop' }),
      parts: [textPart('final', 'm3', 's', 'No pude borrar el archivo.')]
    }
    const entries = [first, next, final]
    show(entries)
    expect(mounted!.host.textContent).toContain('rm nuevo.txt')
    expect(mounted!.host.textContent).not.toContain('mv temporal.xlsx')
    await act(async () => mounted!.qa<HTMLButtonElement>('button')[0].click())
    expect(mounted!.host.textContent).toBe('')
    show(entries)
    expect(mounted!.host.textContent).toBe('')
    mounted!.unmount()
    mounted = undefined
    show(entries)
    expect(mounted!.host.textContent).toBe('')
    expect(m.grant).not.toHaveBeenCalled()
  })

  it('un éxito paralelo en la misma tanda no oculta un borrado todavía bloqueado', () => {
    const first = blocked()
    first.parts.push(toolPart('parallel', 'm1', 's', 'read', { status: 'completed', input: {}, output: 'OK', metadata: {} }))
    show([first])
    expect(mounted!.host.textContent).toContain('Activar permiso y reintentar')
  })
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
    expect(m.enable).toHaveBeenCalledExactlyOnceWith(p, { folder: m.state.folder, conn: m.state.conn })
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
