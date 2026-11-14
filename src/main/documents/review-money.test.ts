import { describe, expect, it } from 'vitest'
import { moneyWithoutNumbers } from './review-checks'

describe('cifras de presentaciones: regresión de la prueba solar de V26', () => {
  it('acepta los dos campos con importes que el modelo añadió tras el primer rechazo', () => {
    const slide = {
      layout: 'cards',
      eyebrow: 'Solución',
      title: 'Energía solar a precio fijo, sin inversión inicial',
      bullets: [
        'Construimos: Plantas solares y baterías en el sitio, US$ 1,1 M por MW (ejemplo)',
        'Vendemos: Energía a US$ 62/MWh fijos por 15 años, 18 % bajo la red',
        'Operamos: Mantención y monitoreo remoto incluidos',
        'Financiamos: Nosotros ponemos el capital, el cliente no invierte'
      ],
      note: 'Cifras de ejemplo, no reales'
    }
    expect(moneyWithoutNumbers('pptx', { slides: [slide] })).toEqual([])
  })

  it.each([
    { layout: 'bullets', bullets: ['Tarifa: US$ 62/MWh (ejemplo)'] },
    { layout: 'kpis', kpis: [{ label: 'Tarifa', value: 'US$ 62/MWh' }] },
    { layout: 'table', table: { columns: ['Servicio', 'Precio'], rows: [['Energía', '$62']] } },
    { layout: 'chart', chart: { type: 'bar', categories: ['Energía'], values: [62] } },
    { layout: 'two-col', columns: [{ bullets: ['Tarifa: $62'] }, { bullets: ['Mantención incluida'] }] },
    { layout: 'free', elements: [{ type: 'text', text: 'Tarifa: $62', x: 40, y: 100, w: 300, h: 50 }] }
  ])('una cifra visible basta en $layout', (body) => {
    expect(moneyWithoutNumbers('pptx', { slides: [{ title: 'Precio de energía', ...body }] })).toEqual([])
  })

  it('no permite eludir la revisión con un año de título, diseño o contenido no visible', () => {
    expect(
      moneyWithoutNumbers('pptx', {
        slides: [
          {
            title: 'Presupuesto 2027',
            layout: 'free',
            background: '#121212',
            speaker_notes: 'Presupuesto $100',
            image: { path: 'foto123.jpg', alt: 'Año 2027' },
            elements: [{ type: 'text', text: 'Personal y tecnología', x: 40, y: 100, w: 300, h: 50 }]
          }
        ]
      })
    ).toEqual(['lámina 1 «Presupuesto 2027»'])
  })

  it('conserva el rechazo sin cifras y la regla de tablas de Word', () => {
    expect(moneyWithoutNumbers('pptx', { slides: [{ title: 'Inversión', bullets: ['Equipo', 'Mantención'] }] })).toHaveLength(1)
    const table = { type: 'table', columns: ['Servicio', 'Precio'], rows: [['Equipo', 'Sin importe']] }
    expect(moneyWithoutNumbers('docx', { blocks: [table] })).toHaveLength(1)
    expect(moneyWithoutNumbers('docx', { blocks: [{ ...table, rows: [['Equipo', 100]] }] })).toEqual([])
  })
})
