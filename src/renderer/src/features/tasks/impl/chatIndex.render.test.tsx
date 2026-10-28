/** Modo unificado: barra lateral con la lista de todos los chats y el menú de carpetas con nombres distintos. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const o = vi.hoisted(() => ({
  unified: false,
  patch: {} as Record<string, unknown>,
  idx: { entries: [] as unknown[], opening: null as unknown, error: null as string | null }
}))
vi.mock('./unified', async (orig) => {
  const mod = await orig<typeof import('./unified')>()
  return { ...mod, useUnifiedApps: () => o.unified }
})
vi.mock('./store', async (orig) => {
  const mod = await orig<typeof import('./store')>()
  const useTasks = Object.assign((sel: (s: unknown) => unknown) => sel({ ...mod.useTasks.getState(), ...o.patch }), mod.useTasks)
  return { ...mod, useTasks }
})
vi.mock('./chatIndex', async (orig) => {
  const mod = await orig<typeof import('./chatIndex')>()
  const useChatIndex = Object.assign((sel: (s: unknown) => unknown) => sel(o.idx), mod.useChatIndex)
  return { ...mod, useChatIndex }
})

import { t as tt } from '@shared/i18n'
import { FolderMenu } from './FolderMenu'
import { chatFolderLabel } from './unified'
import { TaskList } from './TaskList'

afterEach(() => {
  o.unified = false
  o.patch = {}
  o.idx = { entries: [], opening: null, error: null }
})

const NOW = Date.now()
const e = (sessionId: string, title: string, folder: string, ago: number) => ({ folder, sessionId, title, updatedAt: NOW - ago })

describe('barra lateral unificada', () => {
  it('sin la bandera no muestra chats del índice ni mensajes', () => {
    o.idx = { entries: [e('s1', 'Chat de otra carpeta', '/x/y', 1000)], opening: null, error: 'No se pudo abrir ese chat' }
    const html = renderToStaticMarkup(<TaskList />)
    expect(html).not.toContain('Chat de otra carpeta')
    expect(html).not.toContain('index-open-error')
  })
  it('con la bandera lista todos los chats, el más reciente primero, con título y fecha relativa; nunca el id de la carpeta', () => {
    o.unified = true
    o.idx = {
      entries: [
        e('s1', 'Viejo', '/Users/x/Lazunox/Chats/20261020-aaaaaa', 3 * 86_400_000),
        e('s2', 'Reciente', '/Users/x/Lazunox/Chats/20261027-bbbbbb', 60_000),
        e('s3', '', '/Users/x/Lazunox/Chats/20261026-cccccc', 5 * 60_000)
      ],
      opening: null,
      error: null
    }
    const html = renderToStaticMarkup(<TaskList />)
    expect(html.indexOf('Reciente')).toBeGreaterThan(-1)
    expect(html.indexOf('Reciente')).toBeLessThan(html.indexOf('Chat sin título · '))
    expect(html.indexOf('Chat sin título · ')).toBeLessThan(html.indexOf('Viejo'))
    expect(html).toContain('Hoy')
    expect(html).toContain('hace 3')
    expect(html).not.toMatch(/2026102\d-[a-f]{6}/)
    expect(html.match(/data-testid="index-row"/g)).toHaveLength(3)
  })
  it('un chat en carga muestra «Abriendo el chat…» y un error se dice en llano sin vaciar la lista', () => {
    o.unified = true
    o.idx = {
      entries: [e('s1', 'Uno', '/a/b', 1000), e('s2', 'Dos', '/a/c', 2000)],
      opening: { folder: '/a/b', sessionId: 's1' },
      error: null
    }
    let html = renderToStaticMarkup(<TaskList />)
    expect(html).toContain('Abriendo el chat…')
    o.idx = { ...o.idx, opening: null, error: 'No se pudo abrir ese chat. Revisa que su carpeta siga en su lugar e inténtalo de nuevo.' }
    html = renderToStaticMarkup(<TaskList />)
    expect(html).toContain('data-testid="index-open-error"')
    expect(html).toContain('Uno')
    expect(html).toContain('Dos')
  })
})

describe('menú de carpetas', () => {
  it('cada carpeta de chat se nombra con su propia fecha (distintas entre sí) y nunca con su id', () => {
    const tr = (key: string, vars?: Record<string, string>): string => tt(key as never, vars)
    const a = chatFolderLabel('/Users/x/Lazunox/Chats/20261027-aaaaaa', tr as never)
    const b = chatFolderLabel('/Users/x/Lazunox/Chats/20261015-bbbbbb', tr as never)
    expect(a).toMatch(/^Chat sin carpeta · /)
    expect(b).toMatch(/^Chat sin carpeta · /)
    expect(a).not.toBe(b)
    expect(a + b).not.toMatch(/aaaaaa|bbbbbb/)
    expect(chatFolderLabel('/Users/x/Lazunox/Chats/raro', tr as never)).toBe('Chat sin carpeta')
  })
  it('el botón lateral conserva el nombre de la carpeta del usuario', () => {
    o.unified = true
    o.patch = { folders: [{ path: '/Users/x/Proyectos/tienda', name: 'tienda' }], folder: '/Users/x/Proyectos/tienda' }
    expect(renderToStaticMarkup(<FolderMenu variant="block" />)).toContain('tienda')
  })
})
