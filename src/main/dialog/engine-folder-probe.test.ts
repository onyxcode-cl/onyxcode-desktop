// Sonda de acceso a una carpeta con la identidad del motor (bug: Lazunox lee la carpeta, el motor recibe EPERM).
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { classifyEngineProbe, probeFolderAsEngine, type EngineProbeDeps, type RunResult } from './engine-folder-probe'

const err = (code: string | number, extra: Record<string, unknown> = {}): RunResult['error'] =>
  Object.assign(new Error(String(code)), { code, ...extra }) as RunResult['error']

function deps(r: RunResult, over: Partial<EngineProbeDeps> = {}): EngineProbeDeps & { run: ReturnType<typeof vi.fn> } {
  return {
    binary: () => '/app/Contents/Resources/opencode/opencode',
    wrap: (c, a) => ({ command: '/app/launcher/lazunox-disclaim', args: [c, ...a] }),
    run: vi.fn(async () => r),
    timeoutMs: 1000,
    ...over
  } as EngineProbeDeps & { run: ReturnType<typeof vi.fn> }
}

describe('probeFolderAsEngine (execFile simulado)', () => {
  it('ok: lanza el binario del motor envuelto, cwd = carpeta, entorno mínimo con HOME temporal', async () => {
    const d = deps({ error: null, stdout: '[{"path":"EPERM.txt"}]', stderr: '' })
    expect(await probeFolderAsEngine('/Users/yo/Documents/Andes Re', d)).toBe('ok')
    const [file, args, opts] = d.run.mock.calls[0]!
    expect(file).toBe('/app/launcher/lazunox-disclaim')
    expect(args).toEqual(['/app/Contents/Resources/opencode/opencode', 'debug', 'file', 'list', '--pure', '.'])
    expect(opts.cwd).toBe('/Users/yo/Documents/Andes Re')
    expect(opts.env.HOME).toMatch(/lazunox-probe-/)
    expect(opts.env.HOME).not.toBe(process.env.HOME)
    expect(Object.keys(opts.env)).not.toContain('OPENAI_API_KEY')
    expect(existsSync(opts.env.HOME)).toBe(false)
  })
  it('denied: EPERM del motor (TCC) en stderr', async () => {
    const stderr = "Error: Unexpected error\n\nEPERM: operation not permitted, lstat '/Users/yo/Documents/Andes Re'"
    expect(await probeFolderAsEngine('/x', deps({ error: err(1), stdout: '', stderr }))).toBe('denied')
  })
  it('timeout: el aviso de macOS puede estar esperando; nunca «denied»', async () => {
    expect(await probeFolderAsEngine('/x', deps({ error: err('X', { killed: true, signal: 'SIGKILL' }), stdout: '', stderr: '' }))).toBe(
      'timeout'
    )
  })
  it('ENOENT (binario ausente) o sin binario: unavailable (no bloquea)', async () => {
    expect(await probeFolderAsEngine('/x', deps({ error: err('ENOENT'), stdout: '', stderr: '' }))).toBe('unavailable')
    const d = deps({ error: null, stdout: '', stderr: '' }, { binary: () => null })
    expect(await probeFolderAsEngine('/x', d)).toBe('unavailable')
    expect(d.run).not.toHaveBeenCalled()
  })
  it('otros fallos no bloquean; un nombre de archivo en stdout no cuenta como denegado', () => {
    expect(classifyEngineProbe({ error: err(1), stdout: '', stderr: 'Unknown command' })).toBe('ok')
    expect(classifyEngineProbe({ error: err('ERR_CHILD_PROCESS_STDIO_MAXBUFFER', { killed: true }), stdout: '', stderr: '' })).toBe('ok')
    expect(classifyEngineProbe({ error: null, stdout: 'operation not permitted', stderr: '' })).toBe('ok')
    expect(classifyEngineProbe({ error: err('EACCES'), stdout: '', stderr: '' })).toBe('denied')
  })
})

// Prueba real con el binario de desarrollo (sin lanzador: el permiso de archivo basta para comprobar la clasificación).
const bin = resolve(__dirname, '../../../resources/opencode-bin/bin/opencode')
const real = process.platform === 'darwin' && existsSync(bin) && process.getuid?.() !== 0
describe.skipIf(!real)('probeFolderAsEngine con el motor real', () => {
  const realDeps = (): EngineProbeDeps => ({
    binary: () => bin,
    wrap: (c, a) => ({ command: c, args: a }),
    timeoutMs: 30_000,
    run: (file, args, o) =>
      new Promise((res) =>
        execFile(file, args, { cwd: o.cwd, env: o.env, timeout: o.timeoutMs, killSignal: 'SIGKILL' }, (error, stdout, stderr) =>
          res({ error, stdout: String(stdout), stderr: String(stderr) })
        )
      )
  })
  it('ok en una carpeta legible y denied con chmod 311 / 000', async () => {
    const t = mkdtempSync(join(tmpdir(), 'lzx-probe-real-'))
    try {
      mkdirSync(join(t, 'ok'))
      writeFileSync(join(t, 'ok', 'a.txt'), 'x')
      mkdirSync(join(t, 'noread'))
      mkdirSync(join(t, 'none'))
      chmodSync(join(t, 'noread'), 0o311)
      chmodSync(join(t, 'none'), 0o000)
      expect(await probeFolderAsEngine(join(t, 'ok'), realDeps())).toBe('ok')
      expect(await probeFolderAsEngine(join(t, 'noread'), realDeps())).toBe('denied')
      expect(await probeFolderAsEngine(join(t, 'none'), realDeps())).toBe('denied')
    } finally {
      chmodSync(join(t, 'noread'), 0o755)
      chmodSync(join(t, 'none'), 0o755)
      rmSync(t, { recursive: true, force: true })
    }
  }, 60_000)
})
