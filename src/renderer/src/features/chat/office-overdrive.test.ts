// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { officeEditFiles, chatOfficeAvailable } from './office-overdrive'
import type { ChatAttachment } from '../../lib/attachments'
const env = vi.hoisted(() => ({ remote: false, tasks: true, bridge: true, cw: vi.fn() }))
vi.mock('../../lib/platform', () => ({ isRemoteSurface: () => env.remote, platformCaps: () => ({ tasks: env.tasks }) }))
vi.mock('../tasks/impl/bridge', () => ({ hasTasksBridge: () => env.bridge, cw: env.cw }))
const invoke = vi.fn()
beforeEach(() => {
  env.remote = false
  env.tasks = true
  env.bridge = true
  env.cw.mockReset().mockResolvedValue({ state: 'ready', backend: 'seatbelt', setup: null })
  invoke.mockReset().mockResolvedValue({ ok: true, data: { unifiedApps: true } })
  Object.assign(window, { api: { invoke } })
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})
export const word: ChatAttachment = {
  id: 'w',
  name: 'informe.docx',
  mime: 'text/plain',
  url: 'data:text/plain;base64,dGV4dG8=',
  originalDocx: 'UEsDBA=='
}
describe('oferta de edición Office', () => {
  it.each([
    ['docx', 'originalDocx'],
    ['xlsx', 'originalXlsx'],
    ['pptx', 'originalPptx']
  ])('%s: usa el original y solo admite una edición explícita', (ext, key) => {
    const f = { id: ext, name: `a.${ext}`, mime: 'text/plain', url: word.url, [key]: 'UEsDBA==' }
    expect(officeEditFiles('cambia el título', [f])).toEqual([{ name: `a.${ext}`, base64: 'UEsDBA==' }])
    expect(officeEditFiles('replace the title', [f])).not.toBeNull()
    for (const text of [
      'resume el contenido',
      'lee el archivo',
      'what does this say?',
      'resume sin cambiar el formato',
      'lee y explica cómo cambiar el título',
      'translate to English',
      'traduce al inglés'
    ])
      expect(officeEditFiles(text, [f])).toBeNull()
  })
  it('no pierde otros adjuntos: un lote mixto o sin original no ofrece un traslado parcial', () => {
    expect(officeEditFiles('edita esto', [word, { ...word, name: 'foto.png' }])).toBeNull()
    expect(officeEditFiles('edita esto', [{ ...word, originalDocx: undefined }])).toBeNull()
    expect(officeEditFiles('edita esto', [word, { ...word, id: 'w2' }])).toHaveLength(2)
    expect(officeEditFiles('edita esto', [])).toBeNull()
    expect(officeEditFiles('traduce y cambia al inglés', [word])).toBeNull()
  })
  it('comprueba disponibilidad efectiva y falla cerrado con política, entorno pendiente o error', async () => {
    expect(await chatOfficeAvailable()).toBe(true)
    expect(env.cw).toHaveBeenCalledWith('tasks:sandbox:status', { force: true })
    for (const state of ['unsupported', 'policyDisabled', 'needsSetup', 'broken']) {
      env.cw.mockResolvedValueOnce({ state, backend: 'wsl', setup: null })
      expect(await chatOfficeAvailable()).toBe(false)
    }
    env.cw.mockResolvedValueOnce({ state: 'ready', backend: 'wsl', setup: { running: true } })
    expect(await chatOfficeAvailable()).toBe(false)
    env.cw.mockRejectedValueOnce(new Error('no disponible'))
    expect(await chatOfficeAvailable()).toBe(false)
    invoke.mockResolvedValueOnce({ ok: true, data: { unifiedApps: false } })
    expect(await chatOfficeAvailable()).toBe(false)
    env.tasks = false
    expect(await chatOfficeAvailable()).toBe(false)
    env.tasks = true
    env.remote = true
    expect(await chatOfficeAvailable()).toBe(false)
    env.remote = false
    env.bridge = false
    expect(await chatOfficeAvailable()).toBe(false)
  })
})
