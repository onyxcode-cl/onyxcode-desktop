import { describe, expect, it } from 'vitest'
import { explainRenderError, parseRenderError, RENDER_CODES, VideoRenderError } from './render-errors'
describe('errores de composición', () => {
  it.each(RENDER_CODES)('%s tiene una explicación con el cambio necesario', (code) => {
    const error = parseRenderError({ error: { code, data: { width: 1920, height: 1080, duration: 9, time: 12 } } })!
    const message = explainRenderError(error, 'vertical', 1080, 1920, 15)
    expect(message).not.toContain('aislamiento')
    if (!['tiempo_agotado', 'fallo_render', 'audio_invalido'].includes(code)) {
      expect(message).toContain('data-width="1080" data-height="1920" data-duration="15"')
      expect(message).toContain('gsap.timeline({paused:true})')
    }
  })
  it('no acepta códigos arbitrarios y recorta el primer error de consola', () => {
    expect(parseRenderError({ error: { code: 'arbitrario' } })).toBeNull()
    const parsed = parseRenderError({ error: { code: 'no_inicializa', data: { console: 'x'.repeat(900), token: 'ignored' } } })!
    expect(parsed.data.console).toHaveLength(240)
    expect(parsed.data).not.toHaveProperty('token')
    expect(explainRenderError(parsed, 'cuadrado', 1080, 1080)).toContain('Primer error de la página (diagnóstico)')
  })
  it('explica ambos tamaños y duraciones', () => {
    expect(
      explainRenderError(new VideoRenderError('formato_no_coincide', { width: 1920, height: 1080 }), 'vertical', 1080, 1920)
    ).toContain('1920×1080, pero pediste vertical (1080×1920)')
    expect(explainRenderError(new VideoRenderError('duracion_no_coincide', { duration: 9 }), 'vertical', 1080, 1920, 15)).toContain(
      '9 s, pero pediste 15 s'
    )
  })
})

it('el fallo de audio explica el recorte sin añadir un esqueleto HTML ajeno al problema', () => {
  const error = parseRenderError({ error: { code: 'audio_invalido', data: { console: 'El recorte termina fuera del audio.' } } })!
  const message = explainRenderError(error, 'vertical', 1080, 1920, 9)
  expect(message).toContain('recorte')
  expect(message).toContain('termina fuera')
  expect(message).not.toContain('Esqueleto')
})
