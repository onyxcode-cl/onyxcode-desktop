// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Terminal } from 'lucide-react'
import { PermActions, PermCardFrame, usePermGuard } from './PermissionShell'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('arma los botones visibles aunque el detalle sea más alto que la tarjeta; fuera de vista no aprueba', () => {
  vi.unstubAllGlobals()
  vi.useFakeTimers()
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  let visible = true
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const actions = this.hasAttribute('data-perm-actions')
    return {
      top: actions ? (visible ? 200 : 1200) : -2000,
      bottom: actions ? (visible ? 240 : 1240) : 240,
      height: actions ? 40 : 2240
    } as DOMRect
  })
  const reply = vi.fn()
  function Card(): React.JSX.Element {
    const guard = usePermGuard({ id: 'visible', reply, busy: false })
    return (
      <PermCardFrame
        id="visible"
        danger={false}
        armed={guard.armed}
        busy={false}
        icon={Terminal}
        title="Permiso"
        details={<pre>detalle</pre>}
        detailsOpen
        onKeyDown={guard.onKeyDown}
      >
        <PermActions
          armed={guard.armed}
          busy={false}
          actions={[{ label: 'Permitir', variant: 'primary', side: 'right', permit: true, act: 'once', onClick: () => reply('once') }]}
        />
      </PermCardFrame>
    )
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    act(() => root.render(<Card />))
    const button = host.querySelector<HTMLButtonElement>('[data-perm-act]')!
    expect(button.disabled).toBe(true)
    act(() => vi.advanceTimersByTime(1000))
    expect(button.disabled).toBe(false)
    act(() => button.click())
    expect(reply).toHaveBeenCalledOnce()
    visible = false
    act(() => vi.advanceTimersByTime(200))
    expect(button.disabled).toBe(true)
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
