import { describe, expect, it } from 'vitest'
import { contrastRatio, estimateTextWidthIn, fitText, splitLabel, splitStatUnit, STYLES, THEMES } from './pptx-design'

describe('THEMES: contraste de cada par texto/fondo real, en los 5 temas (no "se ve bien a ojo")', () => {
  const themeNames = Object.keys(THEMES) as (keyof typeof THEMES)[]

  it('texto de cuerpo (ink/body) sobre bg y sobre surface: AA (≥4.5) en los 5 temas', () => {
    for (const name of themeNames) {
      const p = THEMES[name]
      expect(contrastRatio(p.ink, p.bg), `${name} ink/bg`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.body, p.bg), `${name} body/bg`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.ink, p.surface), `${name} ink/surface`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.body, p.surface), `${name} body/surface`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('pie/notas (muted/bg) y etiqueta (accent/bg): AA en los 5 temas', () => {
    for (const name of themeNames) {
      const p = THEMES[name]
      expect(contrastRatio(p.muted, p.bg), `${name} muted/bg`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.accent, p.bg), `${name} accent/bg`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('texto sobre fondo oscuro a toda página (onDark/onDarkBody sobre primary Y primary2): AA en los 5 temas', () => {
    for (const name of themeNames) {
      const p = THEMES[name]
      expect(contrastRatio(p.onDark, p.primary), `${name} onDark/primary`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.onDarkBody, p.primary), `${name} onDarkBody/primary`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.onDark, p.primary2), `${name} onDark/primary2`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.onDarkBody, p.primary2), `${name} onDarkBody/primary2`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('onDarkMuted alcanza AA sobre `primary` (ahí SÍ se usa, en la portada/cierre)', () => {
    for (const name of themeNames) {
      expect(contrastRatio(THEMES[name].onDarkMuted, THEMES[name].primary), name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('onDarkMuted NO alcanza AA sobre `primary2` en todos los temas — por eso el renderer nunca lo usa ahí (ver el comentario de `Palette.onDarkMuted`)', () => {
    const weak = themeNames.filter((name) => contrastRatio(THEMES[name].onDarkMuted, THEMES[name].primary2) < 4.5)
    expect(weak.length).toBeGreaterThan(0)
  })

  it('etiqueta sobre fondo oscuro (accentOnDark): AA sobre `primary`; sobre `primary2` alcanza al menos 3:1 (texto chico en negrita, no cuerpo largo — WCAG permite un umbral menor ahí)', () => {
    for (const name of themeNames) {
      const p = THEMES[name]
      expect(contrastRatio(p.accentOnDark, p.primary), `${name} accentOnDark/primary`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.accentOnDark, p.primary2), `${name} accentOnDark/primary2`).toBeGreaterThanOrEqual(3.5)
    }
  })

  it('cada tema trae exactamente 5 tonos de gráfico, y `chartHi`/`chartSoft` son hex válidos y distintos entre sí', () => {
    const hex6 = /^[0-9A-F]{6}$/
    for (const name of themeNames) {
      const p = THEMES[name]
      expect(p.chart).toHaveLength(5)
      expect(p.chartHi).toMatch(hex6)
      expect(p.chartSoft).toMatch(hex6)
      expect(p.chartHi).not.toBe(p.chartSoft)
    }
  })
})

describe('STYLES: los 4 estilos existen con valores válidos (F8-B134: eje de estilo, independiente del color)', () => {
  const styleNames = Object.keys(STYLES) as (keyof typeof STYLES)[]

  it('hay exactamente 4 estilos: classic/editorial/geometric/minimal', () => {
    expect(styleNames.sort()).toEqual(['classic', 'editorial', 'geometric', 'minimal'])
  })

  it('"classic" es el look de siempre: círculo, tarjeta redondeada con borde y relleno, números en círculo', () => {
    expect(STYLES.classic).toMatchObject({ bleedShape: 'circle', cardBorder: true, cardFill: true, numberBadge: 'circle' })
  })

  it('cada estilo tiene un cardRadius entre 0 y 1 (rango válido de `rectRadius` en pptxgenjs)', () => {
    for (const name of styleNames) expect(STYLES[name].cardRadius, name).toBeGreaterThanOrEqual(0)
    for (const name of styleNames) expect(STYLES[name].cardRadius, name).toBeLessThanOrEqual(1)
  })

  it('cada estilo con "bleedShape: none" o "numberBadge: none" no rompe el tipo (valores válidos en todo el set)', () => {
    const bleedShapes = ['circle', 'diagonal', 'rule', 'none']
    const badges = ['circle', 'none']
    for (const name of styleNames) {
      expect(bleedShapes).toContain(STYLES[name].bleedShape)
      expect(badges).toContain(STYLES[name].numberBadge)
    }
  })
})

describe('fitText', () => {
  it('un texto corto entra con el tamaño más grande de la escalera', () => {
    expect(fitText('80%', 8.8, 1.9, [120, 104, 88, 72], 'Georgia')).toBe(120)
  })

  it('un texto largo baja de tamaño hasta que entra (nunca uno que no esté en la lista)', () => {
    const size = fitText('Un título bastante más largo de lo normal para esta caja', 8.8, 0.75, [28, 24, 22], 'Georgia', { bold: true })
    expect([28, 24, 22]).toContain(size)
  })

  it('si ni el tamaño más chico entra, igual lo devuelve (nunca recorta el texto en silencio)', () => {
    const size = fitText('x'.repeat(500), 1, 0.2, [28, 24, 22], 'Georgia')
    expect(size).toBe(22)
  })

  it('estimateTextWidthIn: más largo o más grande el tamaño, más ancho', () => {
    expect(estimateTextWidthIn('hola', 20, 'Arial')).toBeGreaterThan(estimateTextWidthIn('hi', 20, 'Arial'))
    expect(estimateTextWidthIn('hola', 40, 'Arial')).toBeGreaterThan(estimateTextWidthIn('hola', 20, 'Arial'))
  })
})

describe('splitLabel', () => {
  it('"Etiqueta: resto" con la etiqueta de 40 caracteres o menos se separa', () => {
    expect(splitLabel('Soporte: disponible 24/7')).toEqual({ label: 'Soporte', rest: 'disponible 24/7' })
  })
  it('sin ": ", o con la etiqueta demasiado larga: null (no se fuerza una separación que no corresponde)', () => {
    expect(splitLabel('Soporte disponible 24/7')).toBeNull()
    expect(splitLabel(`${'x'.repeat(41)}: resto`)).toBeNull()
  })
})

describe('splitStatUnit', () => {
  it('un número con su unidad pegada (%, letras cortas) se separa', () => {
    expect(splitStatUnit('+27%')).toEqual({ number: '+27', unit: '%' })
    expect(splitStatUnit('3.2x')).toEqual({ number: '3.2', unit: 'x' })
    expect(splitStatUnit('-14%')).toEqual({ number: '-14', unit: '%' })
  })
  it('algo que no es "número + unidad corta": null (queda como un solo texto, no se fuerza)', () => {
    expect(splitStatUnit('Crecimiento sostenido')).toBeNull()
    expect(splitStatUnit('$1.2M')).toBeNull()
  })
})
