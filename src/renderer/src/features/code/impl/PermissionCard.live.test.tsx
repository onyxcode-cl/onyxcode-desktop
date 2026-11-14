// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { PermissionCardDesk } from './PermissionCardDesk'
import { useCode } from './store'
import { toolPart, userMessage } from '../../../../../test/fixtures/events'
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => vi.unstubAllGlobals())

it.each(['/project/web', 'C:\\project\\web'])(
  'bgshell espera la entrada tardía y muestra comando y carpeta reales una sola vez: %s',
  (cwd) => {
    vi.unstubAllGlobals()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const command = 'python -m http.server 8133'
    useCode.setState({ messages: {} })
    try {
      act(() =>
        root.render(
          <PermissionCardDesk
            root="/project"
            request={{
              id: 'bg',
              sessionID: 'ses_1',
              permission: 'bgshell_start',
              patterns: ['*'],
              metadata: {},
              always: [],
              api: 'v1',
              tool: { messageID: 'm1', callID: 'call' }
            }}
          />
        )
      )
      act(() =>
        useCode.setState({
          messages: {
            ses_1: [
              {
                info: userMessage('m1', 'ses_1'),
                parts: [
                  toolPart(
                    'part',
                    'm1',
                    'ses_1',
                    'bgshell_start',
                    { status: 'running', input: { command, cwd }, time: { start: 1 } },
                    'call'
                  )
                ]
              }
            ]
          }
        } as never)
      )
      expect(host.textContent).toContain('correr un comando en segundo plano')
      expect(host.textContent?.match(/python -m http.server 8133/g)).toHaveLength(1)
      expect(host.textContent).toContain(`Carpeta de trabajo · ${cwd}`)
      expect(host.textContent).not.toContain('Sin límite de carpeta')
    } finally {
      act(() => root.unmount())
      host.remove()
    }
  }
)
