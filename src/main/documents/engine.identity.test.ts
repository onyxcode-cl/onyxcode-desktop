import { beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { DeckTextFitError } from '../office/craft/deck-kit'
import { renderBytes } from './engine'

const mocks = vi.hoisted(() => ({ render: vi.fn(), problem: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('../office/craft/service', () => ({
  craftService: () => ({ status: () => ({ state: 'installed', bins: { deckcraft: '/synthetic/cli' } }) })
}))
vi.mock('../extras/artifact-window', () => ({ renderHtmlToPdf: vi.fn() }))
vi.mock('../office/craft/craft-problems', () => ({ recordCraftProblem: mocks.problem }))
vi.mock('../office/craft/chat-deck', async (original) => ({
  ...(await original<typeof import('../office/craft/chat-deck')>()),
  renderChatDeck: mocks.render
}))

beforeEach(() => {
  mocks.render.mockReset()
  mocks.problem.mockReset()
})

describe('identidad y legibilidad en el motor común', () => {
  it('un texto que no cabe se devuelve como contenido inválido y no se disimula con otro motor', async () => {
    mocks.render.mockRejectedValue(new DeckTextFitError('Divide el contenido en más diapositivas.'))
    await expect(renderBytes({ kind: 'pptx', data: { slides: [{ title: 'Informe' }] } }, 'Informe')).rejects.toMatchObject({
      code: 'invalid',
      message: 'Divide el contenido en más diapositivas.'
    })
    expect(mocks.problem).not.toHaveBeenCalled()
  })
  it('un fallo del programa conserva paleta y fuentes propias al crear el archivo de respaldo', async () => {
    mocks.render.mockRejectedValue(new Error('Programa no disponible'))
    const bytes = await renderBytes(
      {
        kind: 'pptx',
        data: {
          identity: {
            concept: 'Museo',
            palette: { bg: '#FAF5E8', text: '#20332E', accent: '#346A50' },
            fonts: { title: 'Georgia', body: 'Tahoma' }
          },
          slides: [
            { title: 'Museo', bullets: ['Colección marina'] },
            { title: 'Plan', bullets: ['Conservar el patrimonio'] }
          ]
        }
      },
      'Museo'
    )
    const zip = await JSZip.loadAsync(bytes)
    expect(await zip.file('ppt/theme/theme1.xml')!.async('string')).toContain('typeface="Tahoma"')
    expect(await zip.file('ppt/slides/slide2.xml')!.async('string')).toContain('FAF5E8')
    expect(mocks.problem).toHaveBeenCalledOnce()
  })
})
