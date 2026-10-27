// @vitest-environment jsdom
/** Plan cuyas apps quedan todas bloqueadas (apps vacías): se muestra la tarjeta de plan sin apps y no se aprueba solo. */
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
const respondAccessRequest = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('./actions', () => ({ respondAccessRequest, dismissAccessRequest: vi.fn(), switchPlanToFolderMode: vi.fn() }))
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { setLang } from '@shared/i18n'
import type { AccessRequest } from '@shared/ipc-tasks'
import { useLang } from '../../../lib/i18n'
import { useTasks } from './store'
import { PlanAccessCard } from './AppAccessCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('PlanAccessCard con apps todas bloqueadas', () => {
  it('muestra PlanDetailCard (sin filas de apps) y no aprueba por sí sola', () => {
    ;(window as unknown as { api: unknown }).api = { platform: 'darwin', capsFlags: {} }
    setLang('es')
    useLang.setState({ lang: 'es' })
    useTasks.setState({ accessRequest: { id: 'p1', reason: 'x', apps: [], plan: ['Paso uno'] } as AccessRequest })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(createElement(PlanAccessCard)))
    expect(host.querySelector('#tasks-plan-access-title')).not.toBeNull()
    expect(host.querySelector('[data-testid="app-access-notices"]')).toBeNull()
    expect(host.querySelector('[role="radiogroup"]')).toBeNull()
    expect(respondAccessRequest).not.toHaveBeenCalled()
    act(() => root.unmount())
    host.remove()
  })
})
