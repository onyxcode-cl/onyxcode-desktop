import { describe, expect, it } from 'vitest'
import {
  DOCUMENTS_CREATE_TOOL,
  DOCUMENTS_PREPARE_HTML_TOOL,
  DOCUMENTS_EXPORT_PDF_TOOL,
  DOCUMENTS_RENDER_TOOL,
  DOCUMENTS_IMAGE_SEARCH_TOOL,
  DOCUMENTS_IMAGE_USE_TOOL,
  DOCUMENTS_IMAGE_VIEW_TOOL,
  DOCUMENTS_SERVER,
  documentsConfigPermission,
  documentsCreateAction,
  documentsSessionRules
} from './documents-permissions'
import { effectiveModeFor, rulesetForMode, type PermissionModeId } from './permission-rules'

const MODES: PermissionModeId[] = ['manual', 'acceptEdits', 'plan', 'auto', 'bypass']

describe('documents-permissions', () => {
  it('nombres de las herramientas (la igualdad con la ruta de main se prueba en mcp-server.code.test.ts)', () => {
    expect(DOCUMENTS_SERVER).toBe('documentos')
    expect(DOCUMENTS_CREATE_TOOL).toBe('documentos_crear')
    expect(DOCUMENTS_PREPARE_HTML_TOOL).toBe('documentos_preparar_html')
    expect(DOCUMENTS_EXPORT_PDF_TOOL).toBe('documentos_exportar_pdf')
    expect(DOCUMENTS_RENDER_TOOL).toBe('documentos_renderizar')
    expect(DOCUMENTS_IMAGE_SEARCH_TOOL).toBe('documentos_imagenes_buscar')
    expect(DOCUMENTS_IMAGE_VIEW_TOOL).toBe('documentos_imagenes_ver')
    expect(DOCUMENTS_IMAGE_USE_TOOL).toBe('documentos_imagenes_usar')
  })

  it('tabla de los cinco modos (agente de construcción)', () => {
    expect(documentsCreateAction('manual')).toBe('ask')
    expect(documentsCreateAction('acceptEdits')).toBe('allow')
    expect(documentsCreateAction('auto')).toBe('allow')
    expect(documentsCreateAction('bypass')).toBe('allow')
    // «plan» como modo elegido se comporta como Preguntar para el agente de construcción (effectiveModeFor); el agente `plan` niega.
    expect(documentsCreateAction('plan')).toBe('ask')
    expect(documentsCreateAction('acceptEdits', 'plan')).toBe('deny')
    expect(documentsCreateAction('bypass', 'plan')).toBe('deny')
  })

  it('crear sigue exactamente a la regla write * del bloque del modo; renderizar siempre pasa', () => {
    for (const mode of MODES) {
      for (const agent of [undefined, 'build', 'plan']) {
        const write = [...rulesetForMode(effectiveModeFor(mode, agent))]
          .reverse()
          .find((r) => r.permission === 'write' && r.pattern === '*')
        const rules = documentsSessionRules(mode, agent)
        expect(rules[0]).toEqual({ permission: 'documentos_crear', pattern: '*', action: write?.action ?? 'ask' })
        expect(rules[1]).toEqual({ permission: 'documentos_renderizar', pattern: '*', action: 'allow' })
        const search = [...rulesetForMode(effectiveModeFor(mode, agent))]
          .reverse()
          .find((r) => r.permission === 'websearch' && r.pattern === '*')
        expect(rules[2]).toEqual({ permission: 'documentos_imagenes_buscar', pattern: '*', action: search?.action ?? 'ask' })
        expect(rules[3]).toEqual({ permission: 'documentos_imagenes_ver', pattern: '*', action: search?.action ?? 'ask' })
        expect(rules[4]).toEqual({ permission: 'documentos_imagenes_usar', pattern: '*', action: write?.action ?? 'ask' })
        expect(rules[6]).toEqual({ permission: 'documentos_preparar_html', pattern: '*', action: write?.action ?? 'ask' })
        expect(rules[5]).toEqual({ permission: 'documentos_exportar_pdf', pattern: '*', action: write?.action ?? 'ask' })
      }
    }
  })

  it('el suelo de la config pregunta al crear y deja mirar', () => {
    expect(documentsConfigPermission()).toEqual({
      'chat_fotos_*': 'deny',
      chat_fotos_imagenes_buscar: 'deny',
      chat_fotos_imagenes_ver: 'deny',
      chat_fotos_imagenes_usar: 'deny',
      documentos_crear: 'ask',
      documentos_renderizar: 'allow',
      documentos_imagenes_buscar: 'ask',
      documentos_imagenes_ver: 'ask',
      documentos_imagenes_usar: 'ask',
      documentos_exportar_pdf: 'ask',
      documentos_preparar_html: 'ask'
    })
  })
})
