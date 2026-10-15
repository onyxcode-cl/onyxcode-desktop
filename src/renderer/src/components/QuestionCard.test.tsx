import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuestionCard } from './QuestionCard'

const Q = [
  {
    header: 'Formato',
    question: '¿Cuál prefieres?',
    multiple: false,
    custom: false,
    options: [
      { label: 'Editable (PowerPoint)', description: 'Un .pptx' },
      { label: 'Diseño libre (HTML/CSS)', description: 'Se ve mejor' }
    ]
  }
]

describe('QuestionCard compartida', () => {
  it('render: opciones como radio con descripción, sin texto libre si custom=false, Responder desactivado', () => {
    const html = renderToStaticMarkup(<QuestionCard questions={Q} onReply={() => undefined} onReject={() => undefined} />)
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('Editable (PowerPoint)')
    expect(html).toContain('Se ve mejor')
    expect(html).not.toContain('<input')
    expect(html).toMatch(/disabled=""[^>]*>Responder/)
  })
})
