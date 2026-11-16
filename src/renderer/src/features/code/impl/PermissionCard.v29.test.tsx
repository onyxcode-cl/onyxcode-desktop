// @vitest-environment jsdom
/**
 * V29: la tarjeta de Código en todos los modos: el comando completo y las carpetas de fuera una sola vez; «Permitir»,
 * «Permitir y no volver a preguntar en este proyecto» (con las reglas de `subcommands`, oculto si no hay ninguna) y «No»
 * con el campo opcional «¿Qué hacer distinto?», que viaja como `message`.
 */
import { act } from 'react'
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingPermission } from './types'
const { alwaysList } = vi.hoisted(() => ({ alwaysList: vi.fn() }))
vi.mock('../../../lib/api', () => ({ call: alwaysList }))
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const command = 'cat /tmp/registro.log && npm test && rm -rf dist'
const request = (metadata: Record<string, unknown> = {}): PendingPermission => ({
  id: 'per_v29',
  sessionID: 'ses_1',
  permission: 'bash',
  patterns: [command],
  metadata: {
    command,
    shell: 'zsh',
    externalDirectories: ['/tmp'],
    subcommands: [
      { command: 'cat /tmp/registro.log', rule: 'cat *' },
      { command: 'npm test', rule: 'npm test *' },
      { command: 'rm -rf dist', rule: null }
    ],
    ...metadata
  },
  always: ['cat *'],
  api: 'v1'
})

const ordinary = (metadata: Record<string, unknown> = {}): PendingPermission =>
  request({
    command: 'cat notas.txt && npm test',
    externalDirectories: [],
    subcommands: [
      { command: 'cat notas.txt', rule: 'cat *' },
      { command: 'npm test', rule: 'npm test *' }
    ],
    ...metadata
  })

let host: HTMLDivElement
let root: Root
let createRoot: (typeof import('react-dom/client'))['createRoot']
let PermissionCardDesk: (typeof import('./PermissionCardDesk'))['PermissionCardDesk']
let useCode: (typeof import('./store'))['useCode']
const reply = vi.fn(() => Promise.resolve())
beforeAll(async () => {
  // El arranque de pruebas deja un `document` de mentira: react-dom se carga después, ya con el de jsdom.
  vi.unstubAllGlobals()
  Object.defineProperty(window.navigator, 'language', { value: 'es', configurable: true })
  Object.defineProperty(window.navigator, 'languages', { value: ['es'], configurable: true })
  vi.resetModules()
  ;({ createRoot } = await import('react-dom/client'))
  ;({ PermissionCardDesk } = await import('./PermissionCardDesk'))
  ;({ useCode } = await import('./store'))
  ;(await import('@shared/i18n')).setLang('es')
})
afterAll(() => vi.unstubAllGlobals())
beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  alwaysList.mockReset().mockResolvedValue({ available: false })
  reply.mockClear()
  useCode.setState({ replyPermission: reply as never, reviewNotes: {}, messages: {} })
})
afterEach(async () => {
  await act(async () => {})
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const mount = (r: PendingPermission): void => {
  act(() => root.render(<PermissionCardDesk request={r} root="/proyecto" />))
  // Sin IntersectionObserver la tarjeta se arma por tiempo.
  act(() => vi.advanceTimersByTime(700))
}
const button = (label: string): HTMLButtonElement =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.replace(/⌘↵|Ctrl\+↵|Esc/g, '').trim() === label) as HTMLButtonElement

describe('V29: tarjeta de permiso de Código', () => {
  it('muestra una vez el comando completo y las carpetas de fuera', () => {
    mount(request())
    expect(host.textContent!.split(command)).toHaveLength(2)
    expect(host.textContent).toContain('Fuera del proyecto: /tmp')
    expect(button('Permitir')).toBeTruthy()
    expect(button('No')).toBeTruthy()
    expect(host.querySelector('input[data-perm-note]')?.getAttribute('placeholder')).toBe('¿Qué hacer distinto? (opcional)')
  })

  it('«Permitir y no volver a preguntar en este proyecto» manda las reglas no nulas', () => {
    mount(ordinary())
    const always = button('Permitir y no volver a preguntar en este proyecto')
    expect(always.title).toBe('No volverá a preguntar por: cat *, npm test *')
    act(() => always.click())
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ id: 'per_v29' }), 'always', false, { rules: ['cat *', 'npm test *'] })
  })

  it('sin ninguna regla sugerida no aparece', () => {
    mount(request({ subcommands: [{ command: 'rm -rf dist', rule: null }] }))
    expect(button('Permitir y no volver a preguntar en este proyecto')).toBeUndefined()
    expect(button('Permitir')).toBeTruthy()
  })

  it('motor viejo (sin `subcommands`): se conserva el «no volver a preguntar» de antes', () => {
    mount(ordinary({ subcommands: undefined }))
    act(() => button('Permitir y no volver a preguntar en este proyecto').click())
    expect(reply).toHaveBeenCalledWith(expect.anything(), 'always', false, undefined)
  })

  it('«No» con comentario lo manda como `message`; sin comentario, un «No» simple', async () => {
    mount(request())
    await act(async () => button('No').click())
    expect(reply).toHaveBeenLastCalledWith(expect.anything(), 'reject', false, undefined)
    const input = host.querySelector('input[data-perm-note]') as HTMLInputElement
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, 'usa una carpeta del proyecto')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(reply).toHaveBeenLastCalledWith(expect.anything(), 'reject', false, { message: 'usa una carpeta del proyecto' })
  })

  it('con el tope de bloqueos, el motivo del revisor queda a la vista', () => {
    useCode.setState({ reviewNotes: { per_v29: 'la persona no pidió borrar dist' } })
    mount(request())
    expect(host.textContent).toContain('Revisión automática: la persona no pidió borrar dist')
  })

  it('motor viejo: la salida exterior con comando muestra el comando y la carpeta', () => {
    mount({ ...request(), permission: 'external_directory', patterns: ['/tmp/*'], metadata: { command } })
    expect(host.textContent).toContain('Fuera del proyecto: /tmp')
    expect(host.textContent!.split(command)).toHaveLength(2)
  })
})

it('explica lo excluido fuera del desplegable y anuncia el límite de cinco', () => {
  mount(
    request({
      subcommands: [
        { command: 'rm notas.txt', rule: null },
        ...Array.from({ length: 6 }, (_, i) => ({ command: `git status ${i}`, rule: `git status ${i} *` }))
      ]
    })
  )
  const visible = [...host.querySelectorAll('p')].find((p) => p.textContent?.includes('No se guardará permiso'))
  expect(host.textContent).toContain('No se guardará permiso para estas partes')
  expect(host.textContent).not.toContain('El límite es de 5 reglas')
  expect(host.textContent).not.toContain('git status 4 *')
  expect(host.textContent).not.toContain('git status 5 *')
  expect(visible?.closest('[hidden]')).toBeFalsy()
})

it('sin subcommands ni reglas guardables tampoco ofrece siempre', () => {
  mount({ ...request({ subcommands: undefined }), always: [] })
  expect(button('Permitir y no volver a preguntar en este proyecto')).toBeUndefined()
})

it('R7: una tarjeta sin siempre explica solo el archivo sensible, sin incluir lecturas normales', () => {
  mount(
    request({
      command: 'cat .env; echo listo; git ls-files',
      subcommands: [
        { command: 'cat .env', rule: null },
        { command: 'echo listo', rule: null },
        { command: 'git ls-files', rule: null }
      ]
    })
  )
  const notes = [...host.querySelectorAll('p')].filter((p) => p.textContent?.includes('No se guardará permiso'))
  expect(notes).toHaveLength(1)
  expect(notes[0].textContent).toContain('cat .env (toca un archivo sensible)')
  expect(notes[0].textContent).not.toMatch(/echo|ls-files|borra/)
})

it('R7: muestra solo reglas nuevas y conserva el botón al llegar las guardadas', async () => {
  let resolve!: (value: unknown) => void
  alwaysList.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r
      })
  )
  mount(
    request({
      command: 'git branch -vv; git log -5; echo listo',
      externalDirectories: [],
      subcommands: [
        { command: 'git branch -vv', rule: 'git branch *' },
        { command: 'git log -5', rule: 'git log *' },
        { command: 'echo listo', rule: 'echo *' }
      ]
    })
  )
  const always = button('Permitir y no volver a preguntar en este proyecto')
  expect(always.disabled).toBe(false)
  await act(async () =>
    resolve({
      available: true,
      active: true,
      rules: [
        { permission: 'bash', pattern: 'git branch *' },
        { permission: 'bash', pattern: 'git log *' }
      ]
    })
  )
  expect(button('Permitir y no volver a preguntar en este proyecto')).toBe(always)
  expect(always.title).toBe('No volverá a preguntar por: echo *')
  expect(host.textContent).toContain('No volverá a preguntar por: echo *')
  expect(host.textContent).not.toContain('No volverá a preguntar por: git branch')
  await act(async () => always.click())
  expect(reply).toHaveBeenCalledTimes(1)
})

it('R7: el clic siempre responde aunque la carga de reglas no termine y vuelve a estar disponible', async () => {
  alwaysList.mockImplementation(() => new Promise(() => {}))
  // El store real captura errores y conserva la tarjeta; su promesa termina resuelta.
  reply.mockImplementation(() => Promise.resolve())
  mount(ordinary())
  const always = button('Permitir y no volver a preguntar en este proyecto')
  await act(async () => always.click())
  expect(reply).toHaveBeenCalledTimes(1)
  expect(always.disabled).toBe(false)
  await act(async () => always.click())
  expect(reply).toHaveBeenCalledTimes(2)
})

it('R7: el motivo del borrado del proyecto se ve en la tarjeta', () => {
  mount(
    request({
      command: 'find . -mindepth 1 ! -name .git -exec rm -rf {} +',
      subcommands: [{ command: 'find . -mindepth 1 ! -name .git -exec rm -rf {} +', rule: null }]
    })
  )
  expect(host.textContent).toContain('Este comando borra la raíz, la carpeta personal o el proyecto entero.')
})

describe('R8: las acciones que siempre preguntan no ofrecen guardar', () => {
  it.each(['rm notas.txt && git status', 'cp notas.txt /tmp/notas.txt', 'npm install -g cowsay', 'pip install --user requests'])(
    '%s, incluso con reglas sugeridas',
    (command) => {
      mount(ordinary({ command }))
      expect(button('Permitir y no volver a preguntar en este proyecto')).toBeUndefined()
      expect(host.textContent).not.toContain('No volverá a preguntar por:')
      expect(button('Permitir')).toBeTruthy()
      expect(button('No')).toBeTruthy()
      expect(host.querySelector('input[data-perm-note]')).toBeTruthy()
      const notice = [...host.querySelectorAll('[role="note"]')].find((n) =>
        /Instala para|borra archivos|escribe fuera/.test(n.textContent ?? '')
      )
      expect(notice).toBeTruthy()
      expect(notice?.closest('[hidden]')).toBeNull()
    }
  )
  it('una tarjeta repetida con externalDirectories tampoco ofrece siempre', async () => {
    alwaysList.mockResolvedValue({ available: true, active: true, rules: [{ permission: 'bash', pattern: 'cat *' }] })
    mount(ordinary({ externalDirectories: ['/tmp'] }))
    await act(async () => {})
    expect(button('Permitir y no volver a preguntar en este proyecto')).toBeUndefined()
  })
  it('external_directory sin comando tampoco ofrece siempre', () => {
    mount({ ...ordinary({ command: undefined }), permission: 'external_directory' })
    expect(button('Permitir y no volver a preguntar en este proyecto')).toBeUndefined()
  })
  it('un comando dudoso normal conserva la opción', () => {
    mount(ordinary({ command: 'git push', subcommands: [{ command: 'git push', rule: 'git push *' }] }))
    expect(button('Permitir y no volver a preguntar en este proyecto')).toBeTruthy()
  })
})
