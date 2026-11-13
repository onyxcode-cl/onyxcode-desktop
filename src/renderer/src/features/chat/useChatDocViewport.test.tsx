// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { mount, type Mounted } from '../../../../test/dom-render'
import { useChatDocViewport } from './useChatDocViewport'
const h = vi.hoisted(() => ({ invoke: vi.fn(async () => undefined) }))
vi.mock('../../lib/extrasApi', () => ({ getExtras: () => ({ invoke: h.invoke }) }))
let mounted: Mounted | undefined
let menu: HTMLDivElement | undefined
function Probe(): React.JSX.Element {
  const { hostRef, shouldShowNative } = useChatDocViewport(true)
  return (
    <div role="dialog">
      <div ref={hostRef} data-visible={String(shouldShowNative)} />
    </div>
  )
}
afterEach(() => {
  mounted?.unmount()
  menu?.remove()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
it('muestra el visor dentro de su diálogo y lo oculta cuando otro overlay lo tapa', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    }
  )
  mounted = mount(<Probe />)
  await act(async () => undefined)
  expect(mounted.q('[data-visible]')?.getAttribute('data-visible')).toBe('true')
  expect(h.invoke).toHaveBeenLastCalledWith('extras:chatDoc:attach', expect.objectContaining({ visible: true }))
  menu = document.createElement('div')
  menu.setAttribute('role', 'menu')
  await act(async () => {
    document.body.appendChild(menu!)
    await Promise.resolve()
  })
  expect(mounted.q('[data-visible]')?.getAttribute('data-visible')).toBe('false')
  expect(h.invoke).toHaveBeenLastCalledWith('extras:chatDoc:attach', expect.objectContaining({ visible: false }))
  await act(async () => {
    menu!.remove()
    await Promise.resolve()
  })
  expect(mounted.q('[data-visible]')?.getAttribute('data-visible')).toBe('true')
})
