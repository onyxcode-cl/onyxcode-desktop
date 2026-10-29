// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectProfileView } from '@shared/project-profile'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let profile: ProjectProfileView
const calls: Array<[string, unknown]> = []
vi.mock('../../lib/api', () => ({
  call: async (channel: string, req: Record<string, unknown>) => {
    calls.push([channel, req])
    if (channel === 'project:setAccess') profile = { ...profile, access: req.access as ProjectProfileView['access'] }
    if (channel === 'project:vaultSet') {
      profile = { ...profile, vaultNames: [...profile.vaultNames, 'NUEVA'] }
      return { ok: true, saved: ['NUEVA'], problems: [], profile }
    }
    if (channel === 'project:vaultDelete') profile = { ...profile, vaultNames: profile.vaultNames.filter((n) => n !== req.name) }
    return profile
  }
}))

import { ProjectCard } from './ProjectCard'
import { useProjectProfile } from './store'

let host: HTMLDivElement
let root: Root
const FOLDER = '/Users/ben/Documents/prueba'

beforeEach(() => {
  vi.unstubAllGlobals()
  calls.length = 0
  profile = { name: '', access: 'comandos', vaultNames: ['API_KEY', 'CONFIG'], secure: true }
  useProjectProfile.setState({ byFolder: {} })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.querySelectorAll('[role="dialog"]').forEach((d) => d.parentElement?.remove())
})

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
}
const render = async (props: Record<string, unknown> = {}): Promise<void> => {
  act(() => root.render(createElement(ProjectCard, { folder: FOLDER, full: false, onPickFull: vi.fn(), ...props })))
  await flush()
}
const click = (el: Element | null): void => act(() => (el as HTMLElement).click())

describe('Ficha del proyecto', () => {
  it('la tarjeta muestra nombre de carpeta, nivel y cuántas variables hay, sin ningún valor', async () => {
    await render()
    const card = host.querySelector('[data-testid="project-card"]') as HTMLElement
    expect(card.textContent).toContain('Ficha del proyecto')
    expect(card.textContent).toContain('prueba')
    expect(card.textContent).toContain('Con comandos aprobados')
    expect(card.textContent).toContain('2 variables')
  })

  it('con Control total activo el sello dice Control total', async () => {
    await render({ full: true })
    expect(host.textContent).toContain('Control total')
  })

  it('el engranaje abre el diálogo; Aislado se guarda por main', async () => {
    await render()
    click(host.querySelector('button[aria-label="Editar la ficha del proyecto"]'))
    const dlg = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dlg).not.toBeNull()
    const aislado = [...dlg.querySelectorAll('[role="radio"]')].find((b) => b.textContent?.includes('Aislado'))
    click(aislado ?? null)
    await flush()
    expect(calls).toContainEqual(['project:setAccess', { folder: FOLDER, access: 'aislado' }])
  })

  it('«Total» pide el Control total existente; «Comandos» desde Control total lo apaga', async () => {
    const onPickFull = vi.fn()
    await render({ onPickFull })
    click(host.querySelector('button[aria-label="Editar la ficha del proyecto"]'))
    const total = [...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent?.includes('Total'))
    click(total ?? null)
    expect(onPickFull).toHaveBeenCalledWith(true)
  })

  it('sin onPickFull (Code) el nivel Total no se ofrece', async () => {
    await render({ onPickFull: undefined })
    click(host.querySelector('button[aria-label="Editar la ficha del proyecto"]'))
    const total = [...document.querySelectorAll('[role="radio"]')].find((b) => b.textContent?.includes('Total')) as HTMLButtonElement
    expect(total.disabled).toBe(true)
  })

  it('la Bóveda lista solo nombres con puntos; agregar y quitar pasan por main', async () => {
    await render()
    click(host.querySelector('button[aria-label="Editar la ficha del proyecto"]'))
    click([...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.includes('Bóveda de variables')) ?? null)
    const dlg = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dlg.textContent).toContain('API_KEY')
    expect(dlg.textContent).toContain('••••')
    expect((dlg.querySelector('textarea') as HTMLTextAreaElement).value).toBe('')
    await act(async () => {
      await useProjectProfile.getState().vaultSet(FOLDER, 'NUEVA=valor-123456')
    })
    expect(calls).toContainEqual(['project:vaultSet', { folder: FOLDER, text: 'NUEVA=valor-123456' }])
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('NUEVA')
    expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain('valor-123456')
    click(document.querySelector('button[aria-label="Quitar API_KEY"]'))
    await flush()
    expect(calls).toContainEqual(['project:vaultDelete', { folder: FOLDER, name: 'API_KEY' }])
  })
})
