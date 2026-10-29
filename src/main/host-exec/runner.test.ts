import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { posixOnly } from '../../test/platform'
import {
  backgroundCount,
  runHostCommand,
  shellInvocation,
  startBackground,
  stopAllBackground,
  stopBackground,
  stopEveryBackground
} from './runner'

afterEach(() => {
  stopEveryBackground()
})

describe('shellInvocation', () => {
  it('Windows: PowerShell sin perfil ni interacción y con salida UTF-8', () => {
    const [file, args] = shellInvocation('win32', 'Get-Date')
    expect(file).toBe('powershell.exe')
    expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command'])
    expect(args[3]).toContain('UTF8')
    expect(args[3]).toContain('Get-Date')
  })
  it('macOS: zsh si existe; si no, sh', () => {
    expect(shellInvocation('darwin', 'ls', () => true)).toEqual(['/bin/zsh', ['-c', 'ls']])
    expect(shellInvocation('darwin', 'ls', () => false)).toEqual(['/bin/sh', ['-c', 'ls']])
  })
})

describe.skipIf(!posixOnly)('runHostCommand (comandos reales)', () => {
  it('devuelve salida, código y carpeta de trabajo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzx-exec-'))
    try {
      const r = await runHostCommand('echo hola && pwd', { cwd: dir })
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain('hola')
      expect(r.stdout.trim().split('\n').pop()!.endsWith(dir.split('/').pop()!)).toBe(true)
      expect(r.timedOut).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('suma las variables de la Bóveda pero no puede pisar PATH ni HOME', async () => {
    const r = await runHostCommand('echo "k=$MI_CLAVE"; echo "p=$PATH"', { extraEnv: { MI_CLAVE: 'abc123', PATH: '/tmp/falso' } })
    expect(r.stdout).toContain('k=abc123')
    expect(r.stdout).not.toContain('/tmp/falso')
  })

  it('un comando que falla devuelve su código y su stderr', async () => {
    const r = await runHostCommand('echo malo 1>&2; exit 3')
    expect(r.exitCode).toBe(3)
    expect(r.stderr).toContain('malo')
  })

  it('corta por tiempo y mata el árbol', async () => {
    const t0 = Date.now()
    const r = await runHostCommand('sleep 30', { timeoutMs: 1_000 })
    expect(r.timedOut).toBe(true)
    expect(Date.now() - t0).toBeLessThan(8_000)
  })

  it('recorta la salida al tope y avisa', async () => {
    const r = await runHostCommand('yes x | head -c 200000', { maxOutputBytes: 1_000 })
    expect(r.stdout.length).toBeLessThanOrEqual(1_000)
    expect(r.truncated).toBe(true)
  })

  it('el entorno es mínimo: no hereda secretos ni variables internas de la app', async () => {
    process.env.LAZUNOX_SECRETO_PRUEBA = 'no-debe-verse'
    process.env.OPENCODE_SERVER_PASSWORD = 'tampoco'
    process.env.GITHUB_TOKEN = 'ni-esto'
    try {
      const r = await runHostCommand('env')
      expect(r.stdout).not.toContain('no-debe-verse')
      expect(r.stdout).not.toContain('tampoco')
      expect(r.stdout).not.toContain('ni-esto')
      expect(r.stdout).toContain('PATH=')
    } finally {
      delete process.env.LAZUNOX_SECRETO_PRUEBA
      delete process.env.OPENCODE_SERVER_PASSWORD
      delete process.env.GITHUB_TOKEN
    }
  })
})

describe.skipIf(!posixOnly)('segundo plano', () => {
  it('deja el proceso corriendo, devuelve el arranque y se puede detener', async () => {
    const r = await startBackground('echo arrancó; sleep 60', 'tarea-1', { graceMs: 400 })
    expect(r.running).toBe(true)
    expect(r.stdout).toContain('arrancó')
    expect(r.pid).toBeGreaterThan(0)
    expect(backgroundCount('tarea-1')).toBe(1)
    expect(stopBackground(r.pid, 'otra-tarea')).toBe(false) // no es suyo
    expect(backgroundCount('tarea-1')).toBe(1)
    expect(stopBackground(r.pid, 'tarea-1')).toBe(true)
    await new Promise((res) => setTimeout(res, 300))
    expect(() => process.kill(r.pid, 0)).toThrow()
  })

  it('si el proceso termina rápido, running=false y su salida vuelve', async () => {
    const r = await startBackground('echo listo', 'tarea-2', { graceMs: 400 })
    expect(r.running).toBe(false)
    expect(r.stdout).toContain('listo')
    expect(r.exitCode).toBe(0)
    expect(backgroundCount('tarea-2')).toBe(0)
  })

  it('stopAllBackground mata solo los de esa tarea', async () => {
    const a = await startBackground('sleep 60', 'A', { graceMs: 200 })
    const b = await startBackground('sleep 60', 'B', { graceMs: 200 })
    expect(stopAllBackground('A')).toBe(1)
    await new Promise((res) => setTimeout(res, 300))
    expect(() => process.kill(a.pid, 0)).toThrow()
    expect(() => process.kill(b.pid, 0)).not.toThrow()
    expect(stopAllBackground('B')).toBe(1)
  })
})
