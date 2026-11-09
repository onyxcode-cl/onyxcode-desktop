import { describe, expect, it } from 'vitest'
import { t } from '@shared/i18n'
import { toEngineError } from '@shared/engine/errors'
import { errorMessage } from './opencode'

describe('errorMessage con la confianza obligatoria del motor', () => {
  it('«carpeta sin confianza» sale en lenguaje simple, no como código del motor', () => {
    const msg = errorMessage(toEngineError({ error: 'folder_not_trusted' }, 403))
    expect(msg).toBe(t('common.error.folderNotTrusted'))
    expect(msg).not.toContain('folder_not_trusted')
    expect(errorMessage({ error: 'folder_not_trusted' })).toBe(t('common.error.folderNotTrusted'))
  })
  it('los demás errores no cambian', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
    expect(errorMessage({ data: { message: 'x' } })).toBe('x')
    expect(errorMessage(null)).toBe(t('common.error.unknown'))
  })
})
