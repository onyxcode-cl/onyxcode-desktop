/**
 * F8-B238: `expect_app` compara la app en primer plano con la que el modelo ESPERA por identidad estable, no solo por texto.
 * Una app tiene varios nombres (visible/localizado «Bloc de notas», ejecutable «Notepad.exe», «Notas»/«Notes» y bundle id en macOS):
 * si el nombre dado se resuelve (mismo resolutor de la concesión) a la MISMA clave que la app al frente, es la misma app y se escribe.
 * Seguridad: otra app (aunque su nombre se parezca) o un nombre sin resolver se RECHAZAN y no se escribe nada.
 * Todo con el helper FALSO: ninguna app real del equipo participa.
 */
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FAKE_HELPER, bundleMcp, startMcp, startSideChannel, textOf, tmpWork, type McpProc, type SideChannel } from '../../test/cu-mcp-kit'
import { exeKey } from './policy/app-key'

vi.setConfig({ testTimeout: 30_000 })

const work = tmpWork('lzx-mcp-expect')
let bundle = ''
beforeAll(() => {
  bundle = bundleMcp(work.dir)
})
afterAll(() => work.cleanup())

const key = (path: string, pub: string): string => {
  const r = exeKey(path, pub)
  if (!r.ok) throw new Error(r.reason)
  return r.key
}
const NOTEPAD = key('C:\\Windows\\System32\\notepad.exe', 'Microsoft Windows')
const NOTEPADPP = key('C:\\Program Files\\Notepad++\\notepad++.exe', 'Notepad++ Team')

const MAC_NOTES = { name: 'Notas', bundleId: 'com.apple.Notes', pid: 100 }
const MAC_NOTABILITY = { name: 'Notability', bundleId: 'com.gingerlabs.Notability', pid: 101 }

let seq = 0
async function boot(
  platform: 'darwin' | 'win32',
  front: unknown,
  resolve: unknown
): Promise<{ mcp: McpProc; side: SideChannel; done: () => Promise<void> }> {
  const side = await startSideChannel({ tier: () => 'full' })
  const win = platform === 'win32'
  const mcp = await startMcp({
    bundle,
    helper: FAKE_HELPER,
    dir: join(work.dir, `w${++seq}`),
    platform,
    events: side,
    script: {
      responses: {
        ...(win
          ? {
              version: { out: { protocol: 1, helper: 'fake-1.0.0', platform: 'win32' } },
              session: { out: { interactive: true, secureDesktop: false, elevatedTarget: false } }
            }
          : {}),
        frontmost: { out: front },
        'app-at': { out: front },
        'resolve-app': { out: resolve }
      }
    },
    env: { ...(win ? { COMPUTER_BACKEND: 'win32', CU_HELPER_ARGV0: 'node' } : {}), COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1' }
  })
  return {
    mcp,
    side,
    done: async () => {
      await mcp.stop()
      await side.close()
    }
  }
}

const typed = (m: McpProc): boolean => m.calls().some((c) => c.cmd === 'type' || c.cmd === 'type-text')
async function tryType(m: McpProc, expectApp: string): Promise<{ ok: boolean; text: string }> {
  const r = await m.call('type_text', { text: 'hola', expect_app: expectApp })
  return { ok: !r.isError, text: textOf(r) }
}

describe('expect_app: identidad de la app, no solo el texto', () => {
  it('Windows: nombre visible «Bloc de notas» y al frente «Notepad.exe» con la MISMA clave ⇒ escribe', async () => {
    const { mcp, done } = await boot(
      'win32',
      { name: 'Notepad.exe', bundleId: NOTEPAD, pid: 2 },
      { name: 'Bloc de notas', bundleId: NOTEPAD, found: true }
    )
    try {
      const r = await tryType(mcp, 'Bloc de notas')
      expect(r.text).not.toContain('Esperabas escribir')
      expect(r.ok, r.text).toBe(true)
      expect(typed(mcp)).toBe(true)
    } finally {
      await done()
    }
  })

  it('Windows: una app DISTINTA de nombre parecido (Notepad++) ⇒ rechazo y no se escribe', async () => {
    const { mcp, done } = await boot(
      'win32',
      { name: 'Notepad++', bundleId: NOTEPADPP, pid: 3 },
      { name: 'Bloc de notas', bundleId: NOTEPAD, found: true } // «Bloc de notas» resuelve a OTRA clave
    )
    try {
      const r = await tryType(mcp, 'Bloc de notas')
      expect(r.ok).toBe(false)
      expect(r.text).toContain('Esperabas escribir en «Bloc de notas»')
      expect(typed(mcp)).toBe(false)
    } finally {
      await done()
    }
  })

  it('Windows: nombre que no se resuelve (sin alias conocido) ⇒ comportamiento de siempre: rechazo', async () => {
    const { mcp, done } = await boot('win32', { name: 'Notepad.exe', bundleId: NOTEPAD, pid: 2 }, { name: 'x', bundleId: '', found: false })
    try {
      const r = await tryType(mcp, 'Bloc de notas')
      expect(r.ok).toBe(false)
      expect(typed(mcp)).toBe(false)
    } finally {
      await done()
    }
  })

  it('Windows: el resolutor devuelve found sin clave, o falla ⇒ rechazo (falla cerrado)', async () => {
    for (const resolve of [
      { name: 'Bloc de notas', bundleId: '', found: true },
      { exit: 1, stderr: 'boom' }
    ]) {
      const { mcp, done } = await boot('win32', { name: 'Notepad.exe', bundleId: NOTEPAD, pid: 2 }, resolve)
      try {
        const r = await tryType(mcp, 'Bloc de notas')
        expect(r.ok).toBe(false)
        expect(typed(mcp)).toBe(false)
      } finally {
        await done()
      }
    }
  })

  it('Windows: la app al frente sin clave (no identificada) ⇒ nunca se da por la misma', async () => {
    const { mcp, done } = await boot(
      'win32',
      { name: 'Notepad.exe', bundleId: '', pid: 2 },
      { name: 'Bloc de notas', bundleId: NOTEPAD, found: true }
    )
    try {
      const r = await tryType(mcp, 'Bloc de notas')
      expect(r.ok).toBe(false)
      expect(typed(mcp)).toBe(false)
    } finally {
      await done()
    }
  })

  it('macOS: «Notes» (inglés) con la app localizada «Notas» al frente y mismo bundle id ⇒ escribe', async () => {
    const { mcp, done } = await boot('darwin', MAC_NOTES, { name: 'Notas', bundleId: 'com.apple.Notes', found: true })
    try {
      const r = await tryType(mcp, 'Notes')
      expect(r.text).not.toContain('Esperabas escribir')
      expect(r.ok, r.text).toBe(true)
      expect(typed(mcp)).toBe(true)
    } finally {
      await done()
    }
  })

  it('macOS: otra app de nombre parecido (Notability) al frente ⇒ rechazo y no se escribe', async () => {
    const { mcp, done } = await boot('darwin', MAC_NOTABILITY, { name: 'Notas', bundleId: 'com.apple.Notes', found: true })
    try {
      const r = await tryType(mcp, 'Notes')
      expect(r.ok).toBe(false)
      expect(r.text).toContain('Esperabas escribir en «Notes»')
      expect(typed(mcp)).toBe(false)
    } finally {
      await done()
    }
  })

  it('macOS: lo que ya coincidía por texto sigue igual (sin consultar al resolutor)', async () => {
    const { mcp, done } = await boot('darwin', MAC_NOTES, { name: 'Otra', bundleId: 'com.otra.App', found: true })
    try {
      const r = await tryType(mcp, 'com.apple.notes')
      expect(r.ok, r.text).toBe(true)
      expect(mcp.calls().some((c) => c.cmd === 'resolve-app')).toBe(false)
    } finally {
      await done()
    }
  })
})
