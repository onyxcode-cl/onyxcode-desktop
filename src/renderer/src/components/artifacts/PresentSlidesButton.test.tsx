// @vitest-environment jsdom
import { act, createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { click, mount, type Mounted } from '../../../../test/dom-render'
const mock = vi.hoisted(() => ({ present: vi.fn() }))
vi.mock('../../lib/extrasApi', () => ({ getExtras: () => ({ presentSlides: mock.present }) }))
import { PresentSlidesButton } from './ArtifactButton'

let view: Mounted | undefined
afterEach(() => {
  view?.unmount()
  vi.clearAllMocks()
})

it('cancelar el selector libera Presentar, quita el giro y permite intentarlo otra vez', async () => {
  let cancel!: () => void
  mock.present.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        cancel = resolve
      })
  )
  view = mount(createElement(PresentSlidesButton, { html: '<section class="slide">A</section>', title: 'Deck' }))
  const button = view.host.querySelector('button')!
  click(button)
  expect(button.disabled).toBe(true)
  expect(button.querySelector('.animate-spin')).not.toBeNull()
  await act(async () => cancel())
  expect(button.disabled).toBe(false)
  expect(button.querySelector('.animate-spin')).toBeNull()
  expect(button.textContent).not.toContain('Error')
  click(button)
  expect(mock.present).toHaveBeenCalledTimes(2)
  await act(async () => cancel())
})
