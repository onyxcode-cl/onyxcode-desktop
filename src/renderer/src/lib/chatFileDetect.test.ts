import { describe, expect, it } from 'vitest'
import type { Part } from '@opencode-ai/sdk/v2/client'
import { detectChatFiles, normalizeAbs } from './chatFileDetect'

const text = (t: string): Part => ({ id: 'p', type: 'text', text: t }) as unknown as Part
const tool = (name: string, input: Record<string, unknown>, output = ''): Part =>
  ({ id: 't' + name, type: 'tool', tool: name, state: { status: 'completed', input, output } }) as unknown as Part

describe('detectChatFiles', () => {
  it('encuentra rutas absolutas en el texto del asistente, de varios tipos', () => {
    const r = detectChatFiles({
      parts: [text('Listo: /Users/ana/Informes/Resumen final.pdf y también `/tmp/x/grafico.png`, además de C:\\Users\\ana\\hoja.xlsx.')],
      root: null
    })
    expect(r).toEqual(['/Users/ana/Informes/Resumen final.pdf', '/tmp/x/grafico.png', 'C:\\Users\\ana\\hoja.xlsx'])
  })
  it('detecta el MP4 absoluto devuelto por video_render dentro del workspace de Chat', () => {
    const ruta = '/data/chat-workspace/videos/abc/Promo.mp4'
    expect(
      detectChatFiles({
        parts: [
          tool(
            'video_render',
            { composicion: '.lazunox/trabajo/video/composicion-1/index.html', nombre: 'Promo' },
            JSON.stringify({ ruta, bytes: 100, duracion: 15 })
          )
        ],
        root: '/data/chat-workspace'
      })
    ).toContain(ruta)
  })
  it('no confunde URLs con rutas', () => {
    expect(detectChatFiles({ parts: [text('mira https://ejemplo.com/a/b/foto.png y http://x.y/z.pdf')], root: null })).toEqual([])
  })
  it('sirve con cualquier herramienta: mira las entradas y salidas de todas, no solo las de escritura', () => {
    const r = detectChatFiles({
      parts: [
        tool('mcp_dibujar_imagen', { output_path: '/data/chat/dibujo.png', prompt: 'un gato' }),
        tool('mcp_exportar', { opciones: { destino: '/data/chat/reporte.docx' } }, 'Guardado en /data/chat/reporte.docx'),
        tool('bash', { command: 'ls' }, 'creado: /data/chat/salida.csv\n')
      ],
      root: '/data/chat'
    })
    expect(r).toEqual(['/data/chat/dibujo.png', '/data/chat/reporte.docx', '/data/chat/salida.csv'])
  })
  it('resuelve rutas relativas de una herramienta contra la carpeta del chat y normaliza ..', () => {
    const r = detectChatFiles({ parts: [tool('write', { filePath: 'docs/../notas.md', content: '' })], root: '/data/chat' })
    expect(r).toEqual(['/data/chat/notas.md'])
  })
  it('una ruta relativa sin carpeta conocida o con ~ se ignora', () => {
    expect(detectChatFiles({ parts: [tool('write', { filePath: 'a.md' })], root: null })).toEqual([])
    expect(detectChatFiles({ parts: [tool('write', { filePath: '~/a.md' })], root: '/data' })).toEqual([])
  })
  it('sin repetidos, ignora texto sintético y herramientas no terminadas', () => {
    const pending = {
      id: 'x',
      type: 'tool',
      tool: 'write',
      state: { status: 'running', input: { filePath: '/a/b.png' } }
    } as unknown as Part
    const synthetic = { id: 's', type: 'text', text: '/a/oculto.png', synthetic: true } as unknown as Part
    const r = detectChatFiles({ parts: [text('/a/uno.png'), text('otra vez /a/uno.png'), pending, synthetic], root: null })
    expect(r).toEqual(['/a/uno.png'])
  })
  it('limita la cantidad de candidatos', () => {
    const many = Array.from({ length: 100 }, (_, i) => `/a/f${i}.png`).join(' ')
    expect(detectChatFiles({ parts: [text(many)], root: null })).toHaveLength(40)
  })
  it('incluye ejecutables solo para que main los marque como bloqueados (la decisión no es del renderer)', () => {
    expect(detectChatFiles({ parts: [text('corre /tmp/x/instalar.sh')], root: null })).toEqual(['/tmp/x/instalar.sh'])
  })
})

describe('normalizeAbs', () => {
  it('quita . y .. y barras repetidas', () => {
    expect(normalizeAbs('/a//b/./c/../d.txt')).toBe('/a/b/d.txt')
    expect(normalizeAbs('C:\\a\\..\\b\\c.txt')).toBe('C:\\b\\c.txt')
  })
})

it('oculta los PNG internos en texto, entradas y salidas, conserva MP4 y fotos pedidas en Mac y Windows', () => {
  for (const root of ['/data/chat', 'C:\\data\\chat']) {
    const scratch = `${root}/videos/abc/.lazunox/trabajo/video/hash/cuadro-1.png`
    const mp4 = `${root}/videos/abc/Promo.mp4`,
      photo = `${root}/foto.png`
    const files = detectChatFiles({
      root,
      parts: [
        tool('video_cuadros', { path: scratch }, JSON.stringify({ cuadros: [scratch] })),
        text(scratch),
        tool('video_render', {}, JSON.stringify({ ruta: mp4 })),
        text(photo)
      ]
    })
    expect(files).toEqual([normalizeAbs(mp4), normalizeAbs(photo)])
  }
})
