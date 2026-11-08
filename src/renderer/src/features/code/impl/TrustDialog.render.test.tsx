// @vitest-environment jsdom
// W-A2: «Confiar» no se puede pulsar justo al aparecer cada diálogo; con la cola, un doble clic no acepta también el siguiente.
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
const native = vi.hoisted(() => ({
  git: { status: () => undefined },
  dialog: { checkFolderAccess: vi.fn(() => Promise.resolve({ status: 'ok', canReset: false })) },
  project: {
    scan: vi.fn((_p: string) =>
      Promise.resolve({
        items: [{ id: 'm-nuevo', kind: 'mcp', name: 'nuevo', where: 'opencode.json', risky: true, mcpKey: 'nuevo_*', trustName: 'nuevo' }],
        huella: 'h-nueva',
        complete: true,
        instructionFiles: []
      })
    )
  }
}))
vi.mock('./client', async (orig) => ({ ...(await orig<typeof import('./client')>()), nativeCode: () => native, requireCode: () => native }))
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useLang } from '../../../lib/i18n'
import { TrustGate } from './ProjectPicker'
import { CONFIRM_DELAY_MS, isFolderVerified, verifyTrustedFolder } from './trust'
import { useCode } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const A = '/work/a'
const B = '/work/b'

const confirmBtn = (): HTMLButtonElement =>
  [...host.querySelectorAll('button')].find((b) => /Entendido, continuar/.test(b.textContent ?? ''))!
const advance = (ms: number): Promise<void> => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

beforeEach(async () => {
  vi.useFakeTimers()
  useLang.setState({ lang: 'es' })
  useCode.getState().trustFolder(A, { huella: 'vieja', ids: [] })
  useCode.getState().trustFolder(B, { huella: 'vieja', ids: [] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(TrustGate)))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
})

describe('TrustDialog: «Confiar» armado con retraso', () => {
  it('desarmado al aparecer cada diálogo: un doble clic acepta SOLO el primero y el siguiente de la cola empieza desarmado', async () => {
    let pa!: Promise<boolean>
    let pb!: Promise<boolean>
    await act(async () => {
      pa = verifyTrustedFolder(A)
      pb = verifyTrustedFolder(B)
    })
    await advance(10)
    expect(confirmBtn().disabled).toBe(true)
    await advance(CONFIRM_DELAY_MS - 50)
    expect(confirmBtn().disabled).toBe(true)
    await advance(100)
    expect(confirmBtn().disabled).toBe(false)

    // Doble clic: el primero acepta A; el segundo cae en el diálogo de B, que acaba de aparecer y sigue desarmado.
    await act(async () => {
      confirmBtn().click()
    })
    await expect(pa).resolves.toBe(true)
    await act(async () => {
      confirmBtn().click()
    })
    expect(isFolderVerified(B)).toBe(false)
    expect(confirmBtn().disabled).toBe(true)

    await advance(CONFIRM_DELAY_MS + 50)
    await act(async () => {
      confirmBtn().click()
    })
    await expect(pb).resolves.toBe(true)
    expect(isFolderVerified(B)).toBe(true)
  })
})
