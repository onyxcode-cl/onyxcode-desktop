import { describe, expect, it } from 'vitest'
import { buildShareMessage, detectInputPrompt, endsWithPrompt, mostlySecret, outputView, plainOutput } from './terminal-capture'

const texts = { intro: 'Ejecuté el comando y esto salió:', clippedNote: 'RECORTE', runningNote: 'SIGUE', waitingNote: 'ESPERA' }

describe('detectInputPrompt', () => {
  it.each([
    ['[sudo] contraseña para ben: ', 'password'],
    ['[sudo] password for ben:', 'password'],
    ['Password:', 'password'],
    ['Enter passphrase for key /x/id: ', 'password'],
    ['Do you want to continue? (y/n) ', 'answer'],
    ['Proceed [Y/n]', 'answer'],
    ['Continue? ', 'answer'],
    ['¿Continuar? [s/n]', 'answer']
  ])('%s -> %s', (line, kind) => {
    expect(detectInputPrompt('algo\n' + line)).toBe(kind)
  })
  it('texto normal no espera', () => {
    expect(detectInputPrompt('compilado\nlisto en 2s')).toBeNull()
    expect(detectInputPrompt('')).toBeNull()
  })
})

describe('plainOutput / outputView', () => {
  it('quita ANSI y colapsa retornos de carro', () => {
    expect(plainOutput('\u001b[31mmal\u001b[0m\r\n1\r2\r3\r\n')).toBe('mal\n3')
  })
  it('endsWithPrompt exige más de una línea y el mismo final de prompt', () => {
    expect(endsWithPrompt('ls\nREADME\ndemo@tienda %', 'demo@tienda % ')).toBe(true)
    expect(endsWithPrompt('demo@tienda %', 'demo@tienda % ')).toBe(false)
    expect(endsWithPrompt('ls\nREADME', 'demo@tienda % ')).toBe(false)
  })
  it('tope: recorta por el principio y avisa; la vista son las últimas líneas', () => {
    const raw = Array.from({ length: 3000 }, (_, i) => `linea ${i} zzzzzzzzzz`).join('\r\n')
    const v = outputView(raw)
    expect(v.clipped).toBe(true)
    expect(v.text.length).toBeLessThanOrEqual(8000)
    expect(v.lines.length).toBe(40)
    expect(v.lines[39]).toBe('linea 2999 zzzzzzzzzz')
    expect(v.lineCount).toBe(3000)
  })
})

describe('mostlySecret', () => {
  it('una clave sola = casi todo secreto; una línea con contexto no', () => {
    const key = 'sk-' + 'a1b2c3d4e5f6g7h8i9j0k1l2m3'
    expect(outputView(key).mostlySecret).toBe(true)
    expect(outputView('Error en la petición a la API: token inválido\nAPI_KEY=abcdef123456').mostlySecret).toBe(false)
    expect(mostlySecret('', '')).toBe(false)
  })
})

describe('buildShareMessage', () => {
  it('arma intro + bloque text', () => {
    const m = buildShareMessage(outputView('ok\r\n3 passed'), 'done', texts)
    expect(m).toBe('Ejecuté el comando y esto salió:\n\n```text\nok\n3 passed\n```\n')
  })
  it('notas de sigue/espera/recorte y salida vacía = null', () => {
    expect(buildShareMessage(outputView('x'), 'running', texts)).toContain('SIGUE')
    expect(buildShareMessage(outputView('x'), 'waiting', texts)).toContain('ESPERA')
    expect(buildShareMessage(outputView(''), 'done', texts)).toBeNull()
    const big = Array.from({ length: 3000 }, (_, i) => `l${i} yyyyyyyyyy`).join('\n')
    expect(buildShareMessage(outputView(big), 'done', texts)).toContain('RECORTE')
  })
})
