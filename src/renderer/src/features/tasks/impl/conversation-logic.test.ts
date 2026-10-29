import { describe, expect, it } from 'vitest'
import { commandWrites } from './conversation-logic'

describe('commandWrites (modo por defecto de la tarjeta de carpeta fuera de la tarea)', () => {
  it.each([
    'mkdir "/Users/ben/Desktop/prueba final"',
    'mkdir -p ~/Desktop/x && ls ~/Desktop',
    'cp a.pdf ~/Desktop/a.pdf',
    'mv x.txt ~/Documents/',
    'touch ~/Desktop/nuevo.txt',
    'echo hola > ~/Desktop/hola.txt',
    'echo hola >> ~/Desktop/hola.txt',
    'ls && mkdir ~/Desktop/a',
    'cat x | tee ~/Desktop/y.txt'
  ])('escribe: %s', (c) => expect(commandWrites(c)).toBe(true))

  it.each([
    '',
    'ls ~/Desktop',
    'cat ~/Desktop/a.txt',
    'ls ~/Desktop 2>&1',
    'ls ~/Desktop 2>/dev/null',
    'find ~/Desktop -name "*.pdf"',
    'head -5 ~/Desktop/a.txt | wc -l',
    'grep -r comparar ~/Documents'
  ])('solo lee: %j', (c) => expect(commandWrites(c)).toBe(false))
})
