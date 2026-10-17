import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { announce, subscribeAnnouncements, type Announcement } from './announce'

describe('announce (H20)', () => {
  it('entrega el texto a las regiones suscritas, con su tono, y deja de entregarlo al darse de baja', () => {
    const got: Announcement[] = []
    const off = subscribeAnnouncements((a) => got.push(a))
    announce('Copiado')
    announce('No se pudo guardar', 'assertive')
    off()
    announce('ignorado')
    expect(got.map((a) => [a.text, a.tone])).toEqual([
      ['Copiado', 'polite'],
      ['No se pudo guardar', 'assertive']
    ])
  })
  it('un texto vacío no anuncia nada', () => {
    const got: Announcement[] = []
    const off = subscribeAnnouncements((a) => got.push(a))
    announce('   ')
    off()
    expect(got).toEqual([])
  })
  it('las regiones permanentes están montadas en la app y los avisos clave las usan', () => {
    const src = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf8')
    expect(src('app/App.tsx')).toContain('<LiveAnnouncer />')
    expect(src('components/CopyButton.tsx')).toContain("announce(tr('common.copied'))")
    expect(src('components/ExportConversation.tsx')).toContain('announce(text')
    expect(src('components/permission/PermissionShell.tsx')).toContain("announce(t('a11y.approvalNeeded'")
    expect(src('components/conversation/ConversationAnnouncer.tsx')).toContain("t('a11y.responseDone')")
  })
})
