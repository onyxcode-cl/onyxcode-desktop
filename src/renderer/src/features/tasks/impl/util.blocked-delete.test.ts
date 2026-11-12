/**
 * `looksLikeBlockedDelete` (F8-B194): la tarjeta «Permitir borrar, mover y renombrar» solo debe salir cuando la orden
 * que falló por el sandbox BORRA, MUEVE o RENOMBRA; una lectura denegada (`head ~/.zshrc`, claves del usuario) también
 * da «Operation not permitted» y esa tarjeta no la arregla.
 */
import { describe, expect, it } from 'vitest'
import type { ToolPart } from '@opencode-ai/sdk/v2'
import { looksLikeBlockedDelete } from './util'

const part = (command: string | undefined, output: string, status: 'completed' | 'error' = 'completed'): ToolPart =>
  ({
    id: 'p',
    sessionID: 's',
    messageID: 'm',
    type: 'tool',
    callID: 'c',
    tool: 'bash',
    state:
      status === 'completed'
        ? { status, input: command === undefined ? {} : { command }, output }
        : { status, input: command === undefined ? {} : { command }, error: output }
  }) as unknown as ToolPart

describe('looksLikeBlockedDelete', () => {
  it('borrar, mover o renombrar denegado SÍ ofrece la tarjeta (cualquier forma)', () => {
    for (const c of [
      'rm -rf viejo',
      'rmdir x',
      'unlink a',
      'mv a b',
      'cd x && mv a b',
      'git clean -fd',
      'git checkout -- .',
      'python3 -c \'import os; os.remove("a")\'',
      'node -e "fs.unlinkSync(1)"',
      'find . -name "*.tmp" -delete',
      'Remove-Item a'
    ]) {
      expect(looksLikeBlockedDelete(part(c, 'x: Operation not permitted')), c).toBe(true)
    }
    // Sin la orden (solo el texto del error con el nombre del programa)
    expect(looksLikeBlockedDelete(part(undefined, 'rm: a: Operation not permitted', 'error'))).toBe(true)
    expect(looksLikeBlockedDelete(part(undefined, 'mv: rename a to b: Operation not permitted'))).toBe(true)
  })

  it('una LECTURA o escritura denegada NO ofrece la tarjeta (no la arregla)', () => {
    for (const c of [
      'head ~/.zshrc',
      'cat ~/.claude.json',
      'ls ~/.config',
      'cat ~/.gitconfig | head',
      'echo x >> ~/.zshrc',
      'bash -c "echo hola"'
    ]) {
      expect(looksLikeBlockedDelete(part(c, 'head: /Users/x/.zshrc: Operation not permitted')), c).toBe(false)
    }
  })

  it('sin negación o en lectura sin operación de borrado, nunca', () => {
    expect(looksLikeBlockedDelete(part('rm a', 'ok'))).toBe(false)
    expect(looksLikeBlockedDelete({ ...part('rm a', 'x: Operation not permitted'), tool: 'read' } as ToolPart)).toBe(false)
  })
  it.each(['Operation not permitted', 'Permission denied', 'EPERM', 'EACCES', 'PermissionDenied: FileSystem.remove'])(
    'parche Delete File con %s ofrece permiso',
    (error) => {
      const p = { ...part(undefined, error, 'error'), tool: 'apply_patch' } as ToolPart
      p.state.input = { patchText: '*** Begin Patch\n*** Delete File: temporal.txt\n*** End Patch' }
      expect(looksLikeBlockedDelete(p, { folder: '/work' })).toBe(true)
    }
  )
  it('parche que solo edita: ni negación de escritura ni error de sintaxis ofrecen borrar', () => {
    for (const error of ['PermissionDenied: FileSystem.writeFile', 'Operation not permitted', 'Invalid patch']) {
      const p = { ...part(undefined, error, 'error'), tool: 'apply_patch' } as ToolPart
      p.state.input = { patchText: '*** Begin Patch\n*** Update File: a.txt\n@@\n-a\n+b\n*** End Patch' }
      expect(looksLikeBlockedDelete(p)).toBe(false)
    }
  })
  it.each(['edit', 'write', 'otra_herramienta'])('una operación real remove denegada se reconoce sin depender del nombre: %s', (tool) => {
    const p = { ...part(undefined, 'PermissionDenied: FileSystem.remove', 'error'), tool } as ToolPart
    p.state.input = { path: '/work/a.txt' }
    expect(looksLikeBlockedDelete(p, { folder: '/work' })).toBe(true)
    p.state.input = { path: '/fuera/a.txt' }
    expect(looksLikeBlockedDelete(p, { folder: '/work' })).toBe(false)
  })
  it.each(['mv a .papelera/a', 'find . -delete', 'unlink a', 'rmdir a', `python3 -c 'import os; os.remove("a")'`])(
    'WSL: %s también con Permission denied',
    (command) => {
      expect(looksLikeBlockedDelete(part(command, 'Permission denied'), { folder: '/win/c/work' })).toBe(true)
    }
  )
  it.each(['rm /fuera/a', `python3 -c 'import os; os.remove("/fuera/a")'`, 'rm ../a', 'rm .lazunox/memoria.md'])(
    'no ofrece el permiso de la carpeta para %s',
    (command) => {
      expect(looksLikeBlockedDelete(part(command, 'Permission denied'), { folder: '/work' })).toBe(false)
    }
  )
  it('no confunde texto del asistente, herramientas pendientes ni borrados sin bloqueo con una denegación', () => {
    const p = { ...part(undefined, 'Success', 'error'), tool: 'apply_patch' } as ToolPart
    p.state.input = { patchText: '*** Begin Patch\n*** Delete File: a.txt\n*** End Patch' }
    expect(looksLikeBlockedDelete(p)).toBe(false)
    p.state = { ...p.state, status: 'running' } as ToolPart['state']
    expect(looksLikeBlockedDelete(p)).toBe(false)
  })
  it('excluye carpetas adicionales Windows aunque el motor nombre rutas Linux', () => {
    const p = { ...part(undefined, 'PermissionDenied: FileSystem.remove', 'error'), tool: 'apply_patch' } as ToolPart
    p.state.input = { patchText: '*** Begin Patch\n*** Delete File: /win/c/work/extra/a.txt\n*** End Patch' }
    expect(looksLikeBlockedDelete(p, { folder: '/win/c/work', additional: ['C:\\work\\extra'] })).toBe(false)
  })
  it.each([
    ["EACCES: permission denied, unlink '/work/a.txt'", {}],
    ['PermissionDenied: FileSystem.remove (/work/a.txt)', {}],
    ['EACCES', { path: 'a.txt', operation: 'delete' }]
  ])('otras herramientas: %s', (error, input) => {
    const p = { ...part(undefined, error, 'error'), tool: 'otra_herramienta' } as ToolPart
    p.state.input = input
    expect(looksLikeBlockedDelete(p, { folder: '/work' })).toBe(true)
  })
  it('mover con un parche requiere el permiso del origen', () => {
    const p = { ...part(undefined, 'Permission denied', 'error'), tool: 'apply_patch' } as ToolPart
    p.state.input = { patchText: '*** Begin Patch\n*** Update File: a.txt\n*** Move to: b.txt\n*** End Patch' }
    expect(looksLikeBlockedDelete(p, { folder: '/work' })).toBe(true)
  })
  it('parche mixto que falla explícitamente en una lectura no ofrece borrar', () => {
    const p = { ...part(undefined, 'PermissionDenied: FileSystem.readFile', 'error'), tool: 'apply_patch' } as ToolPart
    p.state.input = { patchText: '*** Begin Patch\n*** Delete File: a.txt\n*** Update File: /fuera/b.txt\n*** End Patch' }
    expect(looksLikeBlockedDelete(p, { folder: '/work' })).toBe(false)
  })
  it('acepta la ruta Windows o WSL con distinta capitalización', () => {
    const p = { ...part(undefined, 'PermissionDenied: FileSystem.remove', 'error'), tool: 'write' } as ToolPart
    p.state.input = { path: 'C:\\work\\A.txt' }
    expect(looksLikeBlockedDelete(p, { folder: '/win/c/Work' })).toBe(true)
  })
})
