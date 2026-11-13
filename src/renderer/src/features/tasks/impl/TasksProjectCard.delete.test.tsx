// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type Mounted } from '../../../../../test/dom-render'
const m = vi.hoisted(() => ({ state: {} as Record<string, unknown>, full: false, allow: vi.fn() }))
vi.mock('./store', () => ({ useTasks: (sel: (s: unknown) => unknown) => sel(m.state) }))
vi.mock('./ScopePicker', () => ({ useScope: () => ({ full: m.full, canFull: false }) }))
vi.mock('./unified', () => ({ useUnifiedApps: () => false, isChatFolderForDisplay: () => false }))
vi.mock('./bridge', () => ({ cw: vi.fn() }))
vi.mock('./actions', () => ({ setDeleteGrantAllowed: m.allow, applyAccessChange: vi.fn(), linkFolder: vi.fn(), unlinkFolder: vi.fn() }))
vi.mock('../../../lib/api', () => ({ call: async () => ({ name: '', access: 'aislado', vaultNames: [], secure: true, linked: [] }) }))
import { TasksFichaDialog, TasksProjectCard, TasksProjectSeal } from './TasksProjectCard'
let mounted: Mounted | undefined
beforeEach(() => {
  m.full = false
  m.allow.mockReset()
  m.state = { folder: '/fixture', deleteGrant: false, deleteGrantBusy: false }
})
afterEach(() => {
  mounted?.unmount()
  mounted = undefined
})
describe('permiso alcanzable en Ficha del proyecto de Tareas', () => {
  it.each(['menu', 'tarjeta', 'sello'])(
    'entrada %s muestra el interruptor real bajo Carpetas y llama la acción existente',
    async (entry) => {
      mounted = mount(
        entry === 'menu' ? (
          <TasksFichaDialog busy={false} onClose={() => {}} />
        ) : entry === 'tarjeta' ? (
          <TasksProjectCard busy={false} />
        ) : (
          <TasksProjectSeal busy={false} />
        )
      )
      await act(async () => {})
      if (entry !== 'menu') await act(async () => mounted!.q<HTMLButtonElement>('button')!.click())
      const dialog = mounted!.q('[role="dialog"]')!
      expect(dialog.textContent).toContain('Carpetas')
      const toggle = dialog.querySelector<HTMLButtonElement>('[role="switch"]')!
      expect(toggle.getAttribute('aria-label')).toBe('Permitir borrar, mover y renombrar')
      await act(async () => toggle.click())
      expect(m.allow).toHaveBeenCalledWith(true, { folder: '/fixture', conn: m.state.conn })
    }
  )
  it('Control total no ofrece un permiso de aislamiento que no se aplica', async () => {
    m.full = true
    mounted = mount(<TasksFichaDialog busy={false} onClose={() => {}} />)
    await act(async () => {})
    expect(mounted.q('[role="switch"]')).toBeNull()
  })
})
