/**
 * Salidas típicas de un modelo GPT para los bloques de documento de Chat: el JSON "casi bien" que el esquema estricto rechazaba entero
 * por un solo campo (claves de más, textos largos, números donde va texto, subtítulos, notas del orador…). Tras `sanitizeDoc` deben pasar
 * el esquema compartido Y el IPC (ver `chat-doc-contract.test.ts` y `chat-doc-sanitize.test.ts`).
 */
export const LONG_BULLET = 'Este es un punto larguísimo que GPT escribe como un párrafo entero. '.repeat(12)

export const GPT_PPTX = {
  title: 'Plan comercial 2026', // clave que no existe a nivel de presentación
  theme: 'Blue', // mayúscula
  author: 'Equipo',
  slides: [
    { layout: 'title', title: 'Plan comercial 2026', subtitle: 'Primer semestre', notes: 'Saludar y presentar al equipo' },
    {
      title: 'Resumen ejecutivo',
      bullets: [LONG_BULLET, 'Segunda viñeta', 42],
      speaker_notes: 'Notas que no existen en el esquema',
      note: 'Cifras en millones de CLP, cierre al 30 de septiembre de 2026 según contabilidad interna',
      eyebrow: 'RESUMEN EJECUTIVO DEL PRIMER SEMESTRE DEL AÑO',
      image: '/etc/passwd'
    },
    {
      title: 'Indicadores',
      layout: 'kpis',
      kpis: [
        { label: 'Ventas', value: 1250000, delta: '+12%', icon: 'chart' },
        { label: 'Clientes', value: 3480 },
        { label: 'Margen', value: '1.234.567.890.123 CLP' }
      ]
    },
    {
      title: 'Ventas por mes',
      layout: 'chart',
      chart: {
        type: 'bar',
        categories: Array.from({ length: 15 }, (_, i) => `M${i + 1}`),
        values: Array.from({ length: 15 }, (_, i) => String(i * 10)),
        color: '#ff0000'
      }
    },
    {
      title: 'Tabla de planes',
      layout: 'table',
      table: {
        columns: ['Plan', 'Precio'],
        rows: [
          ['Básico', 9990],
          ['Pro', 29990, 'sobra']
        ],
        style: 'striped'
      }
    },
    { title: 'Gracias', layout: 'closing', bullets: [] }
  ]
}

export const GPT_DOCX = {
  title: 'Informe de ventas',
  subtitle: 'Primer semestre',
  language: 'es-CL',
  blocks: [
    { type: 'heading', level: '1', text: 'Resumen' },
    { type: 'paragraph', text: 'Las ventas crecieron **12,5%**.', style: 'Normal' },
    { type: 'quote', text: 'Una cita que GPT escribe como bloque propio' },
    { type: 'image', path: '/home/usuario/.ssh/clave' },
    { type: 'bullets', items: ['Norte', 7, ['sub 1', 'sub 2']] },
    {
      type: 'table',
      columns: ['Región', 'Ventas'],
      rows: [['Norte', 1234567], ['Sur'], ['Centro', true, 'extra']],
      borders: true
    }
  ]
}

export const GPT_XLSX = {
  workbook: 'Gastos',
  sheets: [
    {
      name: 'Gastos del mes de octubre con un nombre demasiado largo',
      description: 'campo que no existe',
      rows: [
        ['Fecha', 'Monto', 'Pagado'],
        ['2026-10-01', 85000, true],
        ['2026-10-02', undefined, null]
      ],
      columnFormats: ['text', 'currency', 'boolean'],
      charts: [
        { type: 'column', range: 'A1:B3', title: 'Gastos', position: 'F2' },
        { type: 'radar', range: 'A1:B3' }
      ]
    }
  ]
}
