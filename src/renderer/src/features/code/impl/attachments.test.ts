import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setLang } from '@shared/i18n'
import { toCodeAttachment, codeAttachmentPart } from './attachments'
import { phoneSafeAttachments, validatePhoneAttachments } from './mobile-logic'

const reads = vi.fn()
const paths = vi.fn()
const savedWindow = window
const savedFileReader = globalThis.FileReader

beforeEach(() => {
  setLang('es')
  reads.mockClear()
  paths.mockReset().mockReturnValue('')
  vi.stubGlobal('window', { ...savedWindow, lzxPaths: { forFile: paths } })
  // Node no tiene FileReader: el lector falso lee los bytes reales del File, sin sustituir la clasificación.
  vi.stubGlobal(
    'FileReader',
    class {
      result = ''
      onload?: () => void
      readAsDataURL(file: File): void {
        reads(file)
        void file.arrayBuffer().then((data) => {
          this.result = `data:${file.type};base64,${Buffer.from(data).toString('base64')}`
          this.onload?.()
        })
      }
    }
  )
})

afterEach(() => {
  setLang('es')
  vi.stubGlobal('window', savedWindow)
  vi.stubGlobal('FileReader', savedFileReader)
})

describe('adjuntos de Código de escritorio', () => {
  it.each([
    ['datos.gld', 'text/plain'],
    ['leeme.md', 'text/markdown'],
    ['leeme.md', ''],
    ['datos.json', 'application/json']
  ])('%s con tipo %s se normaliza a text/plain', async (name, type) => {
    const text = '# Contenido con ñ y 🙂'
    const a = await toCodeAttachment(new File([text], name, { type }))
    expect(codeAttachmentPart(a)).toEqual({ type: 'file', filename: name, mime: 'text/plain', url: a.url })
    expect(a.url).toBe(`data:text/plain;base64,${Buffer.from(text).toString('base64')}`)
    expect(paths).not.toHaveBeenCalled()
  })

  it.each([
    ['datos.gld', '', '/work/proyecto/datos.gld'],
    ['datos.gld', 'application/octet-stream', 'C:\\trabajo\\proyecto\\datos.gld'],
    ['datos.bin', 'application/octet-stream', 'C:\\trabajo con espacios\\datos.bin'],
    ['documento.docx', '', '/work/documento.docx']
  ])('%s desconocido/binario conserva solo la ruta %s %s', async (name, type, path) => {
    paths.mockReturnValue(path)
    // Incluso si el .gld contiene texto, sin tipo conocido se deja que lo lean las herramientas.
    const file = new File([name.endsWith('.gld') ? 'texto legible' : new Uint8Array([0, 255, 128])], name, { type })
    const a = await toCodeAttachment(file)
    expect(a.url).toBe('')
    expect(a.reference).toEqual({ path })
    expect(codeAttachmentPart(a)).toEqual({
      type: 'text',
      text: `Archivo adjunto: ${name}\nRuta: ${path}\nPuedes abrirlo con las herramientas del proyecto.`
    })
    expect(paths).toHaveBeenCalledWith(file)
    expect(reads).not.toHaveBeenCalled()
  })

  it('un archivo pegado sin ruta lleva solo una nota con el nombre', async () => {
    const a = await toCodeAttachment(new File(['contenido que no debe salir'], 'pegado.gld'))
    expect(a.url).toBe('')
    expect(codeAttachmentPart(a)).toEqual({
      type: 'text',
      text: 'Archivo adjunto: pegado.gld. No hay una ruta local disponible; no se incluye su contenido.'
    })
    expect(reads).not.toHaveBeenCalled()
  })

  it('sin el puente de rutas conserva la nota y la traducción inglesa', async () => {
    vi.stubGlobal('window', { api: window.api })
    setLang('en')
    const a = await toCodeAttachment(new File(['secreto'], 'paste.bin'))
    expect(codeAttachmentPart(a)).toEqual({
      type: 'text',
      text: 'Attached file: paste.bin. No local path is available; its contents are not included.'
    })
  })

  it.each([
    ['foto.png', 'image/png', new Uint8Array([137, 80, 78, 71])],
    ['informe.pdf', 'application/pdf', '%PDF-1.7']
  ])('%s conserva el MIME y los bytes', async (name, type, data) => {
    const a = await toCodeAttachment(new File([data], name, { type }))
    expect(codeAttachmentPart(a)).toEqual({ type: 'file', mime: type, filename: name, url: a.url })
    expect(a.url).toBe(`data:${type};base64,${Buffer.from(data).toString('base64')}`)
    expect(a.reference).toBeUndefined()
    expect(paths).not.toHaveBeenCalled()
  })

  it('el celular sigue rechazando desconocidos y referencias locales', async () => {
    const file = new File(['texto'], 'datos.gld')
    expect(validatePhoneAttachments([file], []).accepted).toEqual([])
    paths.mockReturnValue('C:\\trabajo\\datos.gld')
    const reference = await toCodeAttachment(file)
    const image = { id: 'img', name: 'a.png', mime: 'image/png', url: 'data:image/png;base64,AAAA' }
    expect(phoneSafeAttachments([reference, image])).toEqual([image])
  })
})
