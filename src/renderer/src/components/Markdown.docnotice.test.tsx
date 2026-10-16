/**
 * Un documento de Chat que no se puede usar NUNCA queda mudo: JSON roto o forma incorrecta → aviso con el motivo; valla sin cerrar cuando la
 * respuesta ya terminó → «El documento se cortó» (no un «Generando…» eterno). Mientras la respuesta sigue llegando, o si no se sabe
 * (Tareas/Code), sigue valiendo «Generando documento…».
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from './Markdown'

const fence = (lang: string, body: string): string => '```' + lang + '\n' + body
const closed = (lang: string, body: string): string => fence(lang, body) + '\n```'

describe('CodeBlock: avisos de documento', () => {
  it('JSON roto en una valla cerrada → aviso de formato roto, con «Ver detalle»', () => {
    const html = renderToStaticMarkup(<Markdown text={closed('pptx', '{"slides": [oops]}')} streaming={false} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('formato dañado')
    expect(html).toContain('Ver detalle')
    expect(html).not.toContain('Generando documento')
  })

  it('forma incorrecta → aviso de que no tiene la forma esperada', () => {
    const html = renderToStaticMarkup(<Markdown text={closed('docx', '{"blocks":[{"type":"image","path":"a.png"}]}')} />)
    expect(html).toContain('no tiene la forma esperada')
  })

  it('valla sin cerrar con la respuesta TERMINADA → «El documento se cortó»', () => {
    const html = renderToStaticMarkup(<Markdown text={fence('xlsx', '{"sheets":[{"name":"A","rows":[["x"]')} streaming={false} />)
    expect(html).toContain('El documento se cortó')
    expect(html).not.toContain('Generando documento')
  })

  it('valla sin cerrar con la respuesta EN CURSO → sigue «Generando documento…»', () => {
    const html = renderToStaticMarkup(<Markdown text={fence('xlsx', '{"sheets":[{"name":"A","rows":[["x"]')} streaming />)
    expect(html).toContain('Generando documento')
    expect(html).not.toContain('El documento se cortó')
  })

  it('valla sin cerrar y sin saber si terminó (Tareas/Code) → no se declara cortada', () => {
    const html = renderToStaticMarkup(<Markdown text={fence('xlsx', '{"sheets":[{"name":"A","rows":[["x"]')} />)
    expect(html).toContain('Generando documento')
  })

  it('un documento válido (con campos de más, como los escribe GPT) NO muestra aviso', () => {
    const html = renderToStaticMarkup(
      <Markdown text={closed('pptx', '{"title":"x","slides":[{"title":"Hola","notes":"n"}]}')} streaming={false} />
    )
    expect(html).not.toContain('role="alert"')
    expect(html).toContain('aria-expanded="false"')
  })

  it('una valla ```json con la spec de un documento se trata como documento (colapsada, con sus botones)', () => {
    const html = renderToStaticMarkup(<Markdown text={closed('json', '{"slides":[{"title":"Hola"}]}')} streaming={false} />)
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('role="alert"')
  })

  it('un ```json cualquiera sigue siendo código normal', () => {
    const html = renderToStaticMarkup(<Markdown text={closed('json', '{"name":"app"}')} streaming={false} />)
    expect(html).not.toContain('role="alert"')
    expect(html).toContain('<pre>')
  })
})
