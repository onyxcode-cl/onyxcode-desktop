import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXPORT_OPTIONS,
  EXPORT_CSP,
  buildConversationHtml,
  buildConversationMarkdown,
  markdownToSafeHtml,
  redactForExport,
  sanitizeExportFileName,
  type ExportDoc
} from './conversation-export'

// Claves FALSAS de prueba (no son reales).
const FAKE_KEY = 'sk-ant-api03-FALSA1234567890abcdefXYZ'
const FAKE_GH = 'ghp_FALSA0123456789abcdefghijklmnopqrstu'

const T0 = new Date(2026, 9, 16, 14, 5).getTime()

function sample(): ExportDoc {
  return {
    title: 'Ordenar una lista <b>en</b> Python',
    createdAt: T0,
    model: 'claude-sonnet-5-5',
    turns: [
      {
        role: 'user',
        at: T0,
        parts: [{ kind: 'text', text: `Ordena esta lista. Mi clave es ${FAKE_KEY} y el archivo está en /Users/ana/proyectos/app/main.py` }],
        files: ['datos.csv', 'foto.png']
      },
      {
        role: 'assistant',
        at: T0 + 60_000,
        parts: [
          { kind: 'reasoning', text: 'Pienso en sorted() y en key=.' },
          { kind: 'tool', tool: 'read', detail: '/Users/ana/proyectos/app/main.py' },
          { kind: 'tool', tool: 'bash', detail: 'python3 main.py' },
          {
            kind: 'text',
            text: [
              '## Solución',
              '',
              'Usa **sorted** con `key`:',
              '',
              '```python',
              'def f(xs):',
              '    return sorted(xs, key=lambda x: x[0])  # <script>alert(1)</script>',
              '```',
              '',
              '| Método | Costo |',
              '| :-- | --: |',
              '| sorted | O(n log n) |',
              '| sort | O(n log n) |',
              '',
              '- uno',
              '  - anidado',
              '- dos',
              '',
              `Token de ejemplo: ${FAKE_GH}`,
              '',
              '<img src=x onerror=alert(1)> [enlace](https://ejemplo.org/a) [malo](javascript:alert(1))'
            ].join('\n')
          }
        ],
        files: []
      },
      { role: 'assistant', at: T0 + 90_000, parts: [{ kind: 'text', text: 'Segundo mensaje seguido del asistente.' }], files: [] }
    ]
  }
}

describe('buildConversationMarkdown', () => {
  const md = buildConversationMarkdown(sample(), DEFAULT_EXPORT_OPTIONS)

  it('lleva título, fecha y modelo en la cabecera', () => {
    expect(md.content).toMatch(/^# Ordenar una lista/)
    expect(md.content).toContain('- Fecha: 2026-10-16 14:05')
    expect(md.content).toContain('- Modelo: claude-sonnet-5-5')
  })

  it('usa un título por turno y junta los mensajes seguidos del mismo rol', () => {
    expect(md.content.match(/^## /gm)).toHaveLength(3) // Tú, Asistente y «Solución» (dentro del texto)
    expect(md.content).toContain('## Tú · 2026-10-16 14:05')
    expect(md.content.match(/^## Asistente/gm)).toHaveLength(1)
    expect(md.content).toContain('Segundo mensaje seguido')
  })

  it('conserva los bloques de código con su lenguaje y las tablas', () => {
    expect(md.content).toContain('```python\ndef f(xs):')
    expect(md.content).toContain('| Método | Costo |')
  })

  it('tacha claves y oculta el usuario en las rutas, y cuenta lo tachado', () => {
    expect(md.content).not.toContain(FAKE_KEY)
    expect(md.content).not.toContain(FAKE_GH)
    expect(md.content).not.toContain('/Users/ana')
    expect(md.content).toContain('~/proyectos/app/main.py')
    expect(md.redactions).toBe(2)
  })

  it('por defecto: herramientas en resumen, sin razonamiento y con adjuntos', () => {
    expect(md.content).toContain('> Herramienta `bash`: python3 main.py')
    expect(md.content).not.toContain('Pienso en sorted')
    expect(md.content).toContain('_Adjuntos: datos.csv, foto.png_')
  })

  it('respeta las opciones', () => {
    const full = buildConversationMarkdown(sample(), { reasoning: true, tools: false, attachments: false })
    expect(full.content).toContain('Pienso en sorted')
    expect(full.content).not.toContain('Herramienta')
    expect(full.content).not.toContain('Adjuntos')
  })
})

describe('buildConversationHtml', () => {
  const out = buildConversationHtml(sample(), { reasoning: true, tools: true, attachments: true })

  it('es estático: sin scripts, sin recursos externos y con CSP estricta', () => {
    expect(out.content).not.toMatch(/<script/i)
    expect(out.content).not.toMatch(/<[^>]*\son\w+=/i)
    expect(out.content).not.toMatch(/<img|<iframe|<link|<object|<embed/i)
    expect(out.content).not.toMatch(/href="javascript/i)
    expect(out.content).not.toMatch(/src=["']?https?:/i)
    expect(out.content).toContain(`content="${EXPORT_CSP}"`)
    expect(EXPORT_CSP).toContain("default-src 'none'")
    expect(EXPORT_CSP).not.toMatch(/script-src/)
  })

  it('escapa el HTML del título y del texto', () => {
    expect(out.content).toContain('<title>Ordenar una lista &lt;b&gt;en&lt;/b&gt; Python</title>')
    expect(out.content).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(out.content).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('muestra código con su lenguaje, tabla con alineación y listas anidadas', () => {
    expect(out.content).toContain('<figcaption>python</figcaption>')
    expect(out.content).toContain('class="language-python"')
    expect(out.content).toContain('<table>')
    expect(out.content).toContain('<th style="text-align:right">Costo</th>')
    expect(out.content).toMatch(/<ul><li>uno<ul><li>anidado<\/li><\/ul><\/li><li>dos<\/li><\/ul>/)
    expect(out.content).toContain('<a href="https://ejemplo.org/a">enlace</a>')
  })

  it('tacha las claves también en el PDF', () => {
    expect(out.content).not.toContain(FAKE_KEY)
    expect(out.content).not.toContain(FAKE_GH)
    expect(out.content).not.toContain('/Users/ana')
    expect(out.redactions).toBe(2)
  })

  it('incluye fecha, modelo, razonamiento y herramientas', () => {
    expect(out.content).toContain('Fecha: 2026-10-16 14:05')
    expect(out.content).toContain('Modelo: claude-sonnet-5-5')
    expect(out.content).toContain('Razonamiento')
    expect(out.content).toContain('Herramienta <code>bash</code>: python3 main.py')
  })
})

describe('markdownToSafeHtml', () => {
  it('no admite HTML crudo ni enlaces que no sean http(s)', () => {
    const html = markdownToSafeHtml('<script>x()</script>\n\n[a](javascript:alert(1)) [b](data:text/html,x)')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('href="javascript')
    expect(html).not.toContain('href="data')
  })

  it('un bloque de código sin cerrar llega hasta el final sin romper nada', () => {
    expect(markdownToSafeHtml('```js\nlet a = 1 < 2')).toContain('let a = 1 &lt; 2</code></pre></figure>')
  })

  it('una línea larguísima no cuelga el generador', () => {
    const t0 = Date.now()
    markdownToSafeHtml(`${'*a '.repeat(30_000)}\n\n${'| a '.repeat(10_000)}`)
    expect(Date.now() - t0).toBeLessThan(2000)
  })
})

describe('redactForExport', () => {
  it('cuenta solo lo tachado y reescribe rutas de Windows y Linux', () => {
    const r = redactForExport(`C:\\Users\\Ana\\doc.txt /home/ana/x ${FAKE_KEY}`)
    expect(r.text).toBe('~\\doc.txt ~/x …')
    expect(r.count).toBe(1)
  })
})

describe('sanitizeExportFileName', () => {
  it('fuerza la extensión y quita separadores, ".." y caracteres de control', () => {
    expect(sanitizeExportFileName('../../etc/passwd', 'md')).toBe('etc passwd.md')
    expect(sanitizeExportFileName('a\u0000b\u0007c\nd', 'md')).toBe('a b c d.md')
    expect(sanitizeExportFileName('informe.exe', 'pdf')).toBe('informe-exe.pdf')
    expect(sanitizeExportFileName('x.md.pdf', 'md')).toBe('x-md-pdf.md')
    expect(sanitizeExportFileName('C:\\Windows\\System32', 'pdf')).toBe('C Windows System32.pdf')
  })

  it('evita nombres vacíos, ocultos y reservados de Windows', () => {
    expect(sanitizeExportFileName('', 'md', 'conversacion')).toBe('conversacion.md')
    expect(sanitizeExportFileName('...', 'md', 'conversacion')).toBe('conversacion.md')
    expect(sanitizeExportFileName('.bashrc', 'md')).toBe('bashrc.md')
    expect(sanitizeExportFileName('CON', 'pdf')).toBe('CON-.pdf')
  })

  it('limita el largo y nunca deja ".." ni separadores', () => {
    const name = sanitizeExportFileName('a'.repeat(500), 'md')
    expect(name.length).toBeLessThanOrEqual(83)
    for (const raw of ['..', '../', '..\\..\\x', 'a/../b', '\u202egpj.exe', '"quoted"|<x>']) {
      const n = sanitizeExportFileName(raw, 'pdf')
      expect(n).not.toMatch(/\.\.|[/\\:*?"<>|\u0000-\u001f\u202e]/)
      expect(n.endsWith('.pdf')).toBe(true)
    }
  })
})
