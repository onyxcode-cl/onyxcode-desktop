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

  it('sin «Operation not permitted» o en otra herramienta, nunca', () => {
    expect(looksLikeBlockedDelete(part('rm a', 'ok'))).toBe(false)
    expect(looksLikeBlockedDelete({ ...part('rm a', 'x: Operation not permitted'), tool: 'read' } as ToolPart)).toBe(false)
  })
})
