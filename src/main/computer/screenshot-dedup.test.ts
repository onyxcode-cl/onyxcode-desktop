import { describe, expect, it } from 'vitest'
import { DEDUP_NOTICE, hashImage, ScreenshotDedup } from './screenshot-dedup'

const A = Buffer.from('imagen-A')
const B = Buffer.from('imagen-B')

describe('ScreenshotDedup', () => {
  it('la primera captura se envía; una idéntica sin acciones entre medias se omite', () => {
    const d = new ScreenshotDedup()
    expect(d.check('s', 'app#0', A).duplicate).toBe(false)
    expect(d.check('s', 'app#0', A)).toEqual({ duplicate: true, skips: 1 })
  })

  it('una captura distinta se envía y pasa a ser la de referencia', () => {
    const d = new ScreenshotDedup()
    d.check('s', 'app#0', A)
    expect(d.check('s', 'app#0', B).duplicate).toBe(false)
    expect(d.check('s', 'app#0', B).duplicate).toBe(true)
    expect(d.check('s', 'app#0', A).duplicate).toBe(false)
  })

  it('tras una acción de la sesión la imagen idéntica SE ENVÍA (no se oculta un «no pasó nada»)', () => {
    const d = new ScreenshotDedup()
    d.check('s', 'app#0', A)
    d.noteAction('s')
    expect(d.check('s', 'app#0', A).duplicate).toBe(false)
    // y vuelve a poder omitirse mientras no haya otra acción
    expect(d.check('s', 'app#0', A).duplicate).toBe(true)
  })

  it('force siempre devuelve la imagen y reinicia la cuenta', () => {
    const d = new ScreenshotDedup()
    d.check('s', 'app#0', A)
    expect(d.check('s', 'app#0', A, { force: true }).duplicate).toBe(false)
    expect(d.check('s', 'app#0', A).duplicate).toBe(true)
  })

  it('tope de omisiones seguidas: a la tercera se reenvía', () => {
    const d = new ScreenshotDedup({ maxConsecutiveSkips: 2 })
    d.check('s', 'app#0', A)
    expect(d.check('s', 'app#0', A).duplicate).toBe(true)
    expect(d.check('s', 'app#0', A).duplicate).toBe(true)
    expect(d.check('s', 'app#0', A).duplicate).toBe(false)
    expect(d.check('s', 'app#0', A).duplicate).toBe(true)
  })

  it('caduca: pasado el ttl se reenvía', () => {
    let t = 0
    const d = new ScreenshotDedup({ ttlMs: 1000, now: () => t })
    d.check('s', 'app#0', A)
    t = 999
    expect(d.check('s', 'app#0', A).duplicate).toBe(true)
    t = 5000
    expect(d.check('s', 'app#0', A).duplicate).toBe(false)
  })

  it('cada sesión y cada ventana tienen su propia referencia', () => {
    const d = new ScreenshotDedup()
    d.check('s1', 'app#0', A)
    expect(d.check('s2', 'app#0', A).duplicate).toBe(false)
    expect(d.check('s1', 'app#1', A).duplicate).toBe(false)
    // una acción de s2 no afecta a s1
    d.noteAction('s2')
    expect(d.check('s1', 'app#0', A).duplicate).toBe(true)
  })

  it('acepta base64 y bytes con el mismo hash; reset olvida', () => {
    expect(hashImage(A.toString('base64'))).toBe(hashImage(A))
    const d = new ScreenshotDedup()
    d.check('s', 't', A.toString('base64'))
    expect(d.check('s', 't', A).duplicate).toBe(true)
    d.reset('s')
    expect(d.check('s', 't', A).duplicate).toBe(false)
  })

  it('tope de sesiones recordadas', () => {
    const d = new ScreenshotDedup({ maxSessions: 2 })
    d.check('a', 't', A)
    d.check('b', 't', A)
    d.check('c', 't', A)
    expect(d.check('a', 't', A).duplicate).toBe(false)
  })

  it('el aviso nombra cómo forzar la imagen', () => {
    expect(DEDUP_NOTICE).toContain('sin cambios desde la captura anterior')
    expect(DEDUP_NOTICE).toContain('fresh: true')
  })
})
