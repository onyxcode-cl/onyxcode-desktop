import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import { describe, expect, it } from 'vitest'
import { WIN_CONSENT_MISSING_MARK } from '@shared/unified-bridge'
import { looksLikeMissingWinConsent } from './util'

const part = (tool: string, state: Record<string, unknown>): ToolPart => ({ type: 'tool', tool, state }) as unknown as ToolPart

describe('looksLikeMissingWinConsent', () => {
  const msg = `${WIN_CONSENT_MISSING_MARK}: el usuario debe activarlo en Ajustes`
  it('herramienta computer_* rechazada por falta de consentimiento (error o salida)', () => {
    expect(looksLikeMissingWinConsent(part('computer_request_access', { status: 'error', error: msg }))).toBe(true)
    expect(looksLikeMissingWinConsent(part('computer_open_application', { status: 'completed', output: msg }))).toBe(true)
  })
  it('otras herramientas o otros errores no', () => {
    expect(looksLikeMissingWinConsent(part('bash', { status: 'error', error: msg }))).toBe(false)
    expect(looksLikeMissingWinConsent(part('computer_screenshot', { status: 'error', error: 'Control detenido por el usuario' }))).toBe(
      false
    )
    expect(looksLikeMissingWinConsent(part('computer_screenshot', { status: 'running' }))).toBe(false)
  })
})
