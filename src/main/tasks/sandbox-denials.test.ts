import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifySandboxDenial, MAX_SANDBOX_DENIALS, SandboxDenialMonitor } from './sandbox-denials'
import type { SandboxDenial } from '@shared/ipc-tasks'

const tag = 'lzx-denial-' + 'a'.repeat(32)
const message = (op = 'file-write-unlink', path = '/work/tarea/a.txt', label = tag): string =>
  `Sandbox: mv(123) deny(1) ${op} ${path}\n${label}`
const context = { folder: '/work/tarea' }
const line = (text = message(), processID = 0): string => JSON.stringify({ eventMessage: text, processID }) + '\n'

function fakeChild(): ChildProcess & { kill: ReturnType<typeof vi.fn>; stdout: PassThrough; stderr: PassThrough } {
  return Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) }) as never
}
afterEach(() => vi.useRealTimers())

describe('clasificador de negaciones etiquetadas', () => {
  it.each([
    ['file-write-unlink', '/work/tarea/a.txt', 'delete', true],
    ['file-write-create', '/otra/carpeta/secreto.txt', 'write', false],
    ['file-read-data', '/otra/.ssh/id', 'read', false],
    ['network-outbound', '8.8.8.8:80', 'network', false],
    ['file-write-data', '/work/tarea/.git/hooks/pre-commit', 'git-hooks', false],
    ['file-write-unlink', '/work/tarea/.git/hooks/pre-commit', 'git-hooks', false],
    ['process-exec', '/usr/bin/ejemplo', 'other', false]
  ])('%s → %s', (op, path, kind, canAllowDelete) => {
    const result = classifySandboxDenial(message(op, path), tag, context, 7)
    expect(result).toEqual({ kind, at: 7, canAllowDelete })
    expect(JSON.stringify(result)).not.toContain(path)
  })
  it.each(['/work/tarea', '/work/tarea/.lazunox', '/work/tarea/.lazunox/memoria.md', '/work/tarea-otra/a', '/otra/a', '<private>'])(
    'no ofrece permiso que no resuelve el bloqueo: %s',
    (path) => {
      expect(classifySandboxDenial(message('file-write-unlink', path), tag, context)?.canAllowDelete).toBe(false)
    }
  )
  it('respeta carpetas adicionales, solo lectura y permiso ya concedido', () => {
    const msg = message('file-write-unlink', '/work/tarea/solo-lectura/a')
    expect(
      classifySandboxDenial(msg, tag, { ...context, extraFolders: [{ path: '/work/tarea/solo-lectura', mode: 'ro' }] })?.canAllowDelete
    ).toBe(false)
    expect(classifySandboxDenial(message(), tag, { ...context, allowDelete: true })?.canAllowDelete).toBe(false)
  })
  it('rechaza EPERM, otra etiqueta, prefijos y etiquetas solo dentro de la ruta', () => {
    for (const msg of [
      'Operation not permitted',
      message('file-write-unlink', '/x', tag + 'b'),
      message('file-write-unlink', '/x', tag.replace(/a/g, 'b')),
      `Sandbox: mv(123) deny(1) file-write-unlink /tmp/${tag}`,
      tag
    ]) {
      expect(classifySandboxDenial(msg, tag, context)).toBeNull()
    }
    expect(classifySandboxDenial(message(), 'invalid', context)).toBeNull()
  })
})

describe('monitor con lector simulado', () => {
  function setup(): {
    child: ReturnType<typeof fakeChild>
    changed: ReturnType<typeof vi.fn>
    unavailable: ReturnType<typeof vi.fn>
    reader: ReturnType<typeof vi.fn>
    monitor: SandboxDenialMonitor
  } {
    const child = fakeChild()
    const changed = vi.fn()
    const unavailable = vi.fn()
    const reader = vi.fn(() => child)
    const monitor = new SandboxDenialMonitor(tag, context.folder, changed, reader, {}, unavailable)
    monitor.start()
    return { child, changed, unavailable, reader, monitor }
  }
  it('reúne JSON/UTF8 fragmentado, ignora basura y eventos ajenos', async () => {
    const { child, changed, monitor } = setup()
    const data = Buffer.from(line(message('file-write-unlink', '/work/tarea/café.txt')))
    const cut = data.indexOf(Buffer.from('é')) + 1
    child.stdout.write(data.subarray(0, cut))
    expect(changed).not.toHaveBeenCalled()
    child.stdout.write(data.subarray(cut))
    child.stdout.write('invalid\n' + line(message('file-write-data', '/private/secret', tag + 'a')) + line(message(), 42) + 'null\n')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed.mock.calls[0][0]).toEqual([{ kind: 'delete', at: expect.any(Number), canAllowDelete: true }])
    const stopped = monitor.stop()
    child.emit('close', 0)
    await stopped
  })
  it('conserva las últimas N sin rutas ni mutación desde el consumidor', async () => {
    const { child, changed, monitor } = setup()
    for (let i = 0; i < MAX_SANDBOX_DENIALS + 5; i++) child.stdout.write(line())
    const events = changed.mock.lastCall![0] as SandboxDenial[]
    expect(events).toHaveLength(MAX_SANDBOX_DENIALS)
    events[0].kind = 'network'
    child.stdout.write(line())
    expect((changed.mock.lastCall![0] as SandboxDenial[]).every((e) => e.kind === 'delete')).toBe(true)
    expect(JSON.stringify(changed.mock.calls)).not.toContain('/work')
    const stopped = monitor.stop()
    child.emit('close', 0)
    await stopped
  })
  it('descarta un registro excesivo y recupera el siguiente', async () => {
    const { child, changed, monitor } = setup()
    child.stdout.write('x'.repeat(40_000))
    child.stdout.write('x'.repeat(40_000) + '\n' + line())
    expect(changed).toHaveBeenCalledTimes(1)
    const stopped = monitor.stop()
    child.emit('close', 0)
    await stopped
  })
  it('start idempotente, stop espera close y fuerza KILL tras un segundo', async () => {
    vi.useFakeTimers()
    const { child, changed, reader, monitor } = setup()
    monitor.start()
    expect(reader).toHaveBeenCalledTimes(1)
    let closed = false
    const stopped = monitor.stop().then(() => {
      closed = true
    })
    child.stdout.write(line())
    expect(changed).not.toHaveBeenCalled()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(closed).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    child.emit('close', null)
    await stopped
    expect(closed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('apagar y encender durante cierre vuelve a abrir sin recuperar avisos antiguos', async () => {
    const { child, changed, reader, monitor } = setup()
    child.stdout.write(line())
    const second = fakeChild()
    reader.mockReturnValueOnce(second)
    const stopped = monitor.stop()
    monitor.start()
    child.emit('close', 0)
    await stopped
    expect(reader).toHaveBeenCalledTimes(2)
    second.stdout.write(line())
    expect(changed.mock.lastCall![0]).toHaveLength(1)
    const stoppedAgain = monitor.stop()
    second.emit('close', 0)
    await stoppedAgain
  })
  it('error/fin inesperado del lector se informa; nunca inventa negaciones', async () => {
    const { child, changed, unavailable, monitor } = setup()
    child.emit('error', new Error('sin acceso'))
    expect(unavailable).toHaveBeenCalledTimes(1)
    const stopped = monitor.stop()
    child.emit('close', 64)
    await stopped
    expect(changed).not.toHaveBeenCalled()
    const other = fakeChild()
    const lost = vi.fn()
    const m = new SandboxDenialMonitor(tag, '/work', vi.fn(), () => other, {}, lost)
    m.start()
    other.emit('close', 64)
    expect(lost).toHaveBeenCalledTimes(1)
    await m.stop()
  })
  it('captura fallo síncrono y rechaza etiquetas no generadas por main', async () => {
    const unavailable = vi.fn()
    const m = new SandboxDenialMonitor(
      tag,
      '/work',
      vi.fn(),
      () => {
        throw new Error('no log')
      },
      {},
      unavailable
    )
    m.start()
    expect(unavailable).toHaveBeenCalledTimes(1)
    await m.stop()
    expect(() => new SandboxDenialMonitor('" OR true', '/work', vi.fn())).toThrow()
  })
  it('la salida síncrona mata solo el lector propio y no lo vuelve a abrir', async () => {
    vi.useFakeTimers()
    const { child, reader, monitor } = setup()
    const stopped = monitor.stop()
    monitor.start()
    monitor.killSync()
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    expect(vi.getTimerCount()).toBe(0)
    child.emit('close', 0)
    await stopped
    expect(reader).toHaveBeenCalledTimes(1)
  })
})
