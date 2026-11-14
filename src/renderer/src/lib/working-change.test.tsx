// @vitest-environment jsdom
import { vi } from 'vitest'
vi.hoisted(() => vi.unstubAllGlobals())
vi.mock('@xterm/xterm', () => ({ Terminal: class {} }))
vi.mock('./notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setLang } from '@shared/i18n'
import { ConfirmDialogHost } from '../components/ConfirmDialog'
import { useCode } from '../features/code/impl/store'
import { ModelPicker } from '../components/ModelPicker'
import { useProviders } from '../stores/providers'
import { AccessChip } from '../features/tasks/impl/AccessChip'
import { PermissionChip } from '../features/code/impl/ComposerControls'
import { setChatModel } from '../features/chat/actions'
import { useChat } from '../features/chat/store'
import { setTaskModel, setTaskVariant, useTasks } from '../features/tasks/impl/store'
import * as taskActions from '../features/tasks/impl/actions'
import { AutoModeChip } from '../features/tasks/impl/AutoModeChip'
import { useUnified } from '../features/tasks/impl/unified'
import { useExtrasPrefs } from '../features/settings/impl/extras'
import { useServer } from '../stores/server'
import { useSessions } from '../stores/sessions'
import { useUi } from '../stores/ui'
import { handleKeydown } from '../keybindings/dispatch'
import { handlerFor } from '../keybindings/runtime'
import { deferWorkingChange } from './working-change'

Element.prototype.scrollIntoView = () => undefined
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const first = { providerID: 'test', modelID: 'first' }
const next = { providerID: 'test', modelID: 'next' }
let root: Root
let host: HTMLDivElement
const abort = vi.fn(async () => ({ data: true }))
const update = vi.fn(async (args: { sessionID: string; permission?: unknown }) => ({
  data: { id: args.sessionID, permission: args.permission }
}))
const originalAbort = useCode.getState().abort
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}
const dialog = (): HTMLElement | null => host.querySelector('[role="alertdialog"]')
const click = async (text: string): Promise<void> => {
  await act(async () => {
    const button = Array.from(dialog()!.querySelectorAll('button')).find((b) => b.textContent === text)
    expect(button).toBeDefined()
    button!.click()
  })
}
const idle = (): void => {
  useCode.setState({ runState: { code: 'idle' } })
  useSessions.setState({ status: { chat: 'idle', task: 'idle' } })
}

beforeEach(() => {
  setLang('es')
  Object.defineProperty(window, 'api', {
    value: {
      platform: 'darwin',
      extras: { invoke: vi.fn(async () => ({ prefs: useExtrasPrefs.getState().prefs })) },
      tasks: { invoke: vi.fn(async () => ({ ok: true, data: { workspace: '/work/task', consentAt: null } })) }
    },
    configurable: true
  })
  abort.mockClear()
  update.mockClear()
  const client = { session: { abort, update } } as never
  useServer.setState({ client, connection: { chatDirectory: '/work/chat' } as never })
  useCode.setState({
    directory: '/work/code',
    activeSessionID: 'code',
    runState: { code: 'busy' },
    sessions: {},
    messages: {},
    errors: {},
    permissions: {},
    questions: {},
    elicitations: {},
    model: first,
    agent: 'build',
    permissionMode: 'manual',
    roleModels: {},
    variant: null,
    abort: originalAbort,
    globalError: null
  })
  useChat.setState({ activeSessionId: 'chat', elicitations: {} })
  useSessions.setState({ status: { chat: 'busy', task: 'busy' }, sessions: {}, messages: {}, errors: {} })
  useExtrasPrefs.setState({ prefs: { ...useExtrasPrefs.getState().prefs, modelsByMode: { chat: first } } })
  useUnified.setState({ on: false, loaded: true, wantAuto: false })
  useTasks.setState({
    activeTaskId: 'task',
    folder: '/work/task',
    conn: { fullAccess: false } as never,
    client,
    phase: 'ready',
    pendingFullAccess: null,
    fullAccessInfo: null,
    taskModel: first,
    taskVariant: null,
    error: null,
    permissions: {},
    questions: {}
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<ConfirmDialogHost />))
})
afterEach(async () => {
  if (dialog()) await click('Esperar a que termine')
  act(idle)
  await flush()
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const changes = [
  { name: 'Código: modelo', change: () => useCode.getState().setModel(next), read: () => useCode.getState().model, expected: next },
  {
    name: 'Código: Hacer/Planear y atajo',
    change: () => handlerFor('code.togglePlanBuild')!.run(),
    read: () => useCode.getState().agent,
    expected: 'plan'
  },
  {
    name: 'Código: permisos',
    change: () => useCode.getState().setPermissionMode('auto'),
    read: () => useCode.getState().permissionMode,
    expected: 'auto'
  },
  {
    name: 'Código: modelo de Planear',
    change: () => useCode.getState().setRoleModel('plan', next),
    read: () => useCode.getState().roleModels.code?.plan,
    expected: next
  },
  {
    name: 'Código: esfuerzo',
    change: () => useCode.getState().setVariant('high'),
    read: () => useCode.getState().variant,
    expected: 'high'
  },
  { name: 'Chat: modelo', change: () => setChatModel(next), read: () => useExtrasPrefs.getState().prefs.modelsByMode.chat, expected: next },
  { name: 'Overdrive: modelo', change: () => setTaskModel(next), read: () => useTasks.getState().taskModel, expected: next },
  { name: 'Overdrive: esfuerzo', change: () => setTaskVariant('high'), read: () => useTasks.getState().taskVariant, expected: 'high' },
  {
    name: 'Overdrive: alcance',
    change: () => taskActions.setAccessMode(true),
    read: () => useTasks.getState().pendingFullAccess,
    expected: '/work/task'
  },
  {
    name: 'Código: Solo explorar',
    change: () => useCode.getState().setPermissionMode('plan'),
    read: () => [useCode.getState().permissionMode, useCode.getState().agent],
    expected: ['plan', 'plan']
  }
]

describe.each(changes)('$name', ({ change, read, expected }) => {
  it('trabajando: avisa, no cambia y Esperar conserva el valor sin detener', async () => {
    const before = read()
    act(() => {
      void change()
    })
    expect(read()).toEqual(before)
    expect(dialog()?.textContent).toContain('Todavía está trabajando')
    expect(document.activeElement?.textContent).toBe('Esperar a que termine')
    await click('Esperar a que termine')
    expect(read()).toEqual(before)
    expect(abort).not.toHaveBeenCalled()
    act(idle)
    await flush()
    expect(read()).toEqual(before)
  })

  it('Detener y cambiar: llama a Detener y espera el estado idle antes de aplicar', async () => {
    const before = read()
    act(() => {
      void change()
    })
    await click('Detener y cambiar')
    expect(abort).toHaveBeenCalled()
    expect(read()).toEqual(before)
    act(idle)
    await flush()
    expect(read()).toEqual(expected)
  })

  it('sin trabajo cambia directamente', async () => {
    act(idle)
    await act(async () => {
      await change()
    })
    expect(dialog()).toBeNull()
    expect(read()).toEqual(expected)
    expect(abort).not.toHaveBeenCalled()
  })
})

it('el chip de permisos abre el aviso sin el mensaje anterior; Esc cancela', async () => {
  act(() =>
    root.render(
      <>
        <PermissionChip />
        <ConfirmDialogHost />
      </>
    )
  )
  act(() => host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click())
  act(() => host.querySelector<HTMLButtonElement>('[data-option="auto"]')!.click())
  expect(useCode.getState().permissionMode).toBe('manual')
  expect(dialog()).not.toBeNull()
  expect(host.textContent).not.toContain('El cambio vale desde el próximo mensaje')
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })
  expect(dialog()).toBeNull()
  expect(useCode.getState().permissionMode).toBe('manual')
  expect(abort).not.toHaveBeenCalled()
})

it('Enter en la opción por defecto espera, y Tab queda dentro del diálogo', async () => {
  act(() => setChatModel(next))
  const buttons = dialog()!.querySelectorAll('button')
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
  })
  expect(document.activeElement).toBe(buttons[1])
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  })
  expect(document.activeElement).toBe(buttons[0])
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
  expect(dialog()).toBeNull()
  expect(abort).not.toHaveBeenCalled()
})

it.each(['darwin', 'win32'])('Overdrive Manual/Automático en %s usa el mismo aviso y la misma parada', async (platform) => {
  Object.assign(window.api, { platform })
  useUnified.setState({ on: true })
  const settings = { enabled: true, folders: [], tasks: [], viewApps: [] }
  useTasks.setState({ autoMode: { settings } as never })
  const stop = vi.spyOn(taskActions, 'stopIsolatedTask').mockResolvedValue()
  const api = window.api as unknown as { tasks?: unknown }
  const invoke = vi.fn(async () => ({ ok: true, data: { settings: { ...settings, folders: ['/work/task'] } } }))
  api.tasks = { invoke }
  act(() =>
    root.render(
      <>
        <AutoModeChip />
        <ConfirmDialogHost />
      </>
    )
  )
  act(() => host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click())
  act(() => host.querySelector<HTMLButtonElement>('[data-option="auto"]')!.click())
  expect(useTasks.getState().autoMode?.settings.folders).toEqual([])
  expect(invoke).not.toHaveBeenCalled()
  await click('Detener y cambiar')
  expect(stop).toHaveBeenCalledOnce()
  expect(invoke).not.toHaveBeenCalled()
  act(idle)
  await flush()
  expect(useTasks.getState().autoMode?.settings.folders).toEqual(['/work/task'])
  expect(invoke).toHaveBeenCalledWith('tasks:auto:set', { enabled: true, folder: { path: '/work/task', on: true } })
})

it('Overdrive Control total usa el kill-switch del botón Detener', async () => {
  useTasks.setState({ conn: { fullAccess: true } as never })
  const stop = vi.spyOn(taskActions, 'stopComputerControl').mockResolvedValue()
  act(() => setTaskModel(next))
  await click('Detener y cambiar')
  expect(stop).toHaveBeenCalledOnce()
  expect(useTasks.getState().taskModel).toEqual(first)
  act(idle)
  await flush()
  expect(useTasks.getState().taskModel).toEqual(next)
})

it('si termina mientras el aviso está abierto, confirmar aplica sin llamar a Detener', async () => {
  act(() => setChatModel(next))
  act(idle)
  await click('Detener y cambiar')
  expect(abort).not.toHaveBeenCalled()
  expect(useExtrasPrefs.getState().prefs.modelsByMode.chat).toEqual(next)
})

it('al cambiar de conversación descarta la elección pendiente', async () => {
  act(() => setChatModel(next))
  act(() => useChat.setState({ activeSessionId: 'other' }))
  await click('Detener y cambiar')
  expect(abort).not.toHaveBeenCalled()
  expect(useExtrasPrefs.getState().prefs.modelsByMode.chat).toEqual(first)
})

it('no cambia tras un fallo al detener', async () => {
  abort.mockRejectedValueOnce(new Error('offline'))
  act(() => setChatModel(next))
  await click('Detener y cambiar')
  expect(useExtrasPrefs.getState().prefs.modelsByMode.chat).toEqual(first)
  expect(useSessions.getState().errors.chat).toContain('El cambio no se aplicó')
})

it('sin confirmación de idle, agota la espera sin aplicar ni dejar un cambio para después', async () => {
  vi.useFakeTimers()
  act(() => setTaskModel(next))
  await click('Detener y cambiar')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000)
  })
  expect(useTasks.getState().taskModel).toEqual(first)
  expect(useTasks.getState().error).toContain('El cambio no se aplicó')
  act(idle)
  await flush()
  expect(useTasks.getState().taskModel).toEqual(first)
})

it('los intentos repetidos conservan la primera elección', async () => {
  act(() => {
    useCode.getState().setAgent('plan')
    useCode.getState().setModel(next)
  })
  await click('Detener y cambiar')
  act(idle)
  await flush()
  expect(useCode.getState().agent).toBe('plan')
  expect(useCode.getState().model).toEqual(first)
})

it('espera también la promesa de Detener aunque idle llegue primero', async () => {
  let stopped!: () => void
  const stop = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        stopped = resolve
      })
  )
  const apply = vi.fn()
  let busy = true
  act(() => {
    deferWorkingChange({ busy: () => busy, current: () => true, stop, subscribe: () => () => undefined, onError: vi.fn() }, apply)
  })
  await click('Detener y cambiar')
  busy = false
  await flush()
  expect(apply).not.toHaveBeenCalled()
  await act(async () => stopped())
  expect(apply).toHaveBeenCalledOnce()
})

it.each(['darwin', 'win32'])('Shift+Tab real en %s no salta el bloqueo', async (platform) => {
  Object.assign(window.api, { platform })
  useUi.setState({ mode: 'code', settingsOpen: false })
  const textarea = document.createElement('textarea')
  textarea.setAttribute('data-kb-composer', '')
  host.append(textarea)
  const off = (): void => window.removeEventListener('keydown', handleKeydown)
  window.addEventListener('keydown', handleKeydown)
  try {
    act(() =>
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    )
    expect(dialog()).not.toBeNull()
    expect(useCode.getState().agent).toBe('build')
    await click('Esperar a que termine')
    expect(useCode.getState().agent).toBe('build')
  } finally {
    off()
  }
})

it('una petición Detener que no responde también tiene límite y nunca aplica tarde', async () => {
  vi.useFakeTimers()
  let stopped!: () => void
  const stop = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        stopped = resolve
      })
  )
  const apply = vi.fn()
  const onError = vi.fn()
  let busy = true
  act(() => {
    deferWorkingChange({ busy: () => busy, current: () => true, stop, subscribe: () => () => undefined, onError }, apply)
  })
  await click('Detener y cambiar')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000)
  })
  expect(onError).toHaveBeenCalledOnce()
  busy = false
  await act(async () => stopped())
  expect(apply).not.toHaveBeenCalled()
})

it('selector real de Chat: elegir una IA abre el aviso y no persiste el modelo al esperar', async () => {
  useProviders.setState({
    loaded: true,
    providers: [
      {
        id: 'test',
        name: 'Test',
        models: {
          first: { id: 'first', name: 'First', capabilities: { reasoning: false } },
          next: { id: 'next', name: 'Next', capabilities: { reasoning: false } }
        }
      }
    ] as never
  })
  useServer.setState({ client: null }) // No cargar proveedores reales: esta prueba ya los sembró.
  act(() =>
    root.render(
      <>
        <ModelPicker value={first} onChange={setChatModel} />
        <ConfirmDialogHost />
      </>
    )
  )
  act(() => host.querySelector<HTMLButtonElement>('button')!.click())
  const item = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.getAttribute('role') === 'option' && b.textContent?.includes('Next')
  )
  expect(item).toBeDefined()
  act(() => item!.click())
  expect(dialog()).not.toBeNull()
  expect(useExtrasPrefs.getState().prefs.modelsByMode.chat).toEqual(first)
  await click('Esperar a que termine')
  expect(useExtrasPrefs.getState().prefs.modelsByMode.chat).toEqual(first)
})

it('selector real de alcance en Overdrive pide detener antes del consentimiento de Control total', async () => {
  act(() =>
    root.render(
      <>
        <AccessChip />
        <ConfirmDialogHost />
      </>
    )
  )
  act(() => host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click())
  act(() => host.querySelector<HTMLButtonElement>('[data-option="full"]')!.click())
  expect(dialog()).not.toBeNull()
  expect(useTasks.getState().pendingFullAccess).toBeNull()
  await click('Detener y cambiar')
  expect(useTasks.getState().pendingFullAccess).toBeNull()
  act(idle)
  await flush()
  expect(useTasks.getState().pendingFullAccess).toBe('/work/task')
})

it('la aplicación de un cambio anterior no libera el aviso de otro cambio posterior', async () => {
  let busy = true
  let applied!: () => void
  const context = {
    busy: () => busy,
    current: () => true,
    stop: async () => {
      busy = false
    },
    subscribe: () => () => undefined,
    onError: vi.fn()
  }
  act(() => {
    deferWorkingChange(
      context,
      () =>
        new Promise<void>((resolve) => {
          applied = resolve
        })
    )
  })
  await click('Detener y cambiar')
  busy = true
  const second = vi.fn()
  const third = vi.fn()
  act(() => {
    deferWorkingChange(context, second)
  })
  await act(async () => applied())
  act(() => {
    expect(deferWorkingChange(context, third)).toBe(true)
  })
  await click('Detener y cambiar')
  expect(second).toHaveBeenCalledOnce()
  expect(third).not.toHaveBeenCalled()
})
