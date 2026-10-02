/**
 * Terminal integrada en Windows (ConPTY de node-pty): carga de los prebuilds win32, arranque real de la shell
 * por defecto y salida. Solo Windows (en macOS/Linux la shell depende del usuario y de su .zshrc: no determinista);
 * la elección de la shell se prueba en todas las plataformas en `shell.test.ts`.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { winOnly } from '../../test/platform'

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }))

const prebuilds = join(process.cwd(), 'node_modules', 'node-pty', 'prebuilds', `win32-${process.arch}`)

describe.skipIf(!winOnly)('node-pty en Windows', () => {
  it('trae los binarios de ConPTY (conpty.node, conpty.dll, OpenConsole.exe)', () => {
    expect(existsSync(join(prebuilds, 'conpty.node'))).toBe(true)
    expect(existsSync(join(prebuilds, 'conpty', 'conpty.dll'))).toBe(true)
    expect(existsSync(join(prebuilds, 'conpty', 'OpenConsole.exe'))).toBe(true)
  })

  it('electron-builder desempaqueta node-pty entero (OpenConsole.exe y conpty.dll fuera del asar)', () => {
    const cfg = createRequire(join(process.cwd(), 'package.json'))('./electron-builder.js') as { asarUnpack?: string[] }
    const unpack = cfg.asarUnpack ?? []
    expect(unpack).toContain('node_modules/node-pty/**')
  })

  it('abre la shell por defecto, ejecuta un comando y sale', async () => {
    const { PtyService } = await import('./service')
    const chunks: string[] = []
    let exited: number | null = null
    const svc = new PtyService({
      onData: (_id, d) => chunks.push(d),
      onExit: (_id, code) => {
        exited = code
      }
    })
    expect(svc.availability()).toEqual({ available: true })
    const info = svc.create({ cwd: process.cwd(), cols: 100, rows: 30 })
    try {
      svc.write(info.id, 'Write-Output ("onyx-pty-" + "ok")\r')
      const deadline = Date.now() + 20_000
      while (!chunks.join('').includes('onyx-pty-ok') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
      expect(chunks.join('')).toContain('onyx-pty-ok')
      svc.write(info.id, 'exit\r')
      const deadline2 = Date.now() + 15_000
      while (exited === null && Date.now() < deadline2) await new Promise((r) => setTimeout(r, 100))
      expect(exited).not.toBeNull()
    } finally {
      svc.killAll()
    }
  }, 60_000)
})
