import { describe, expect, it } from 'vitest'
import { viewFromEmulated } from './terminal-capture'

describe('viewFromEmulated: lo que ve la persona en la terminal (regresión del prompt real)', () => {
  const CMD = 'echo hola-desde-lazunox && sleep 2 && echo fin'
  // Prompts de forma distinta; varios terminan en letras del propio comando («e», «ec», «ech») para no servir de atajo al buscar el eco.
  const prompts = [
    'ben@MacBook-Pro-de-Benjamin-2 tienda-web %',
    'ben@MacBook-Pro-de-Benjamin-2 prueba-ejecutar %',
    'demo@server-prod-eu ~/code/site ❯',
    'user@host ~/e $',
    'user@host ~/ec $',
    '~/proyectos/mi-sitio-ech %',
    'C:\\Users\\ben\\code>'
  ]

  it.each(prompts)('prompt «%s»: termina, sin prompt y sin eco', (p) => {
    // el eco se parte donde sea (zsh fuerza un salto de línea o el ancho lo corta)
    const text = `${p} echo hola-desde-lazunox &&\nsleep 2 && echo fin\nhola-desde-lazunox\nfin\n${p}`
    // da igual lo que se haya «aprendido» antes de ejecutar (vacío, basura o el prompt real)
    for (const promptLine of ['', '%', p, 'otra cosa']) {
      const v = viewFromEmulated(text, promptLine, CMD)
      expect(v.text).toBe('hola-desde-lazunox\nfin')
      expect(v.promptReturned).toBe(true)
      expect(v.promptKnown).toBe(true)
    }
  })

  it('sin el prompt de regreso todavía: sigue en marcha con la salida parcial', () => {
    const p = 'ben@MacBook-Pro-de-Benjamin-2 tienda-web %'
    const v = viewFromEmulated(`${p} echo hola-desde-lazunox &&\nsleep 2 && echo fin\nhola-desde-lazunox`, '', CMD)
    expect(v.text).toBe('hola-desde-lazunox')
    expect(v.promptReturned).toBe(false)
  })
})
