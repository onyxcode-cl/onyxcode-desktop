// @vitest-environment jsdom
// R4 (1.8.12): aviso visible cuando la conversación pasó por «Solo explorar» y ahora está en otro modo (los ayudantes heredan su deny).
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useLang } from '../../../lib/i18n'
import { rulesetForMode } from '@shared/permission-rules'
import { StalePlanNotice } from './StalePlanNotice'
import { useCode } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const SID = 's1'
const setSession = (permission: ReturnType<typeof rulesetForMode>, mode: 'plan' | 'auto' | 'manual', agent: 'build' | 'plan'): void =>
  useCode.setState({ sessions: { [SID]: { id: SID, permission } as never }, permissionMode: mode, agent } as never)
const render = (): Promise<void> => act(async () => root.render(createElement(StalePlanNotice, { sessionID: SID })))

beforeEach(() => {
  useLang.setState({ lang: 'es' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('StalePlanNotice', () => {
  it('plan → Automático en la misma conversación: dice por qué los ayudantes no podrán editar y que hay que abrir una conversación nueva', async () => {
    setSession([...rulesetForMode('plan'), ...rulesetForMode('auto')], 'auto', 'build')
    await render()
    const n = host.querySelector('[data-testid="stale-plan-notice"]')
    expect(n?.textContent).toMatch(/pasó por «Solo explorar»/)
    expect(n?.textContent).toMatch(/Abre una conversación nueva/)
  })
  it('conversación sin pasado en «Solo explorar», o ahora en «Solo explorar»: no aparece', async () => {
    setSession(rulesetForMode('auto'), 'auto', 'build')
    await render()
    expect(host.querySelector('[data-testid="stale-plan-notice"]')).toBeNull()
    setSession([...rulesetForMode('plan'), ...rulesetForMode('auto')], 'plan', 'plan')
    await render()
    expect(host.querySelector('[data-testid="stale-plan-notice"]')).toBeNull()
  })
})
