import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { allEntries, assistantFull, userWithFile } from '../../../../../test/fixtures/entries'

// NO se importa el store real de Cowork (suscribe a useSessions al cargar): se sustituye por un
// stub mínimo para los módulos que lo arrastran (PermissionPrompt/actions/ProgressPanel/…).
vi.mock('./store', () => ({
  useCowork: Object.assign(() => undefined, { getState: () => ({}), setState: () => undefined, subscribe: () => () => undefined })
}))
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

import { TaskConversation } from './TaskConversation'

describe('TaskConversation (render estático)', () => {
  it('conversación completa', () => {
    expect(renderToStaticMarkup(<TaskConversation entries={allEntries} busy={false} permissions={[]} />)).toMatchSnapshot()
  })
  it('ocupado con error y footer', () => {
    const html = renderToStaticMarkup(
      <TaskConversation entries={[userWithFile, assistantFull]} busy error="Fallo" permissions={[]} footer={<p>pie</p>} taskId="t1" />
    )
    expect(html).toContain('pie')
    expect(html).toMatchSnapshot()
  })
})
