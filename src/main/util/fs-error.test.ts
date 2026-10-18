import { describe, expect, it } from 'vitest'
import { fsFailureKind } from './fs-error'

const errno = (code: string, extra: Record<string, unknown> = {}): Error => Object.assign(new Error(`${code}: algo`), { code, ...extra })

describe('fsFailureKind', () => {
  it('disco lleno', () => {
    expect(fsFailureKind(errno('ENOSPC'))).toBe('disk')
    expect(fsFailureKind(errno('EDQUOT'))).toBe('disk')
  })
  it('sin permiso de escritura', () => {
    expect(fsFailureKind(errno('EACCES'))).toBe('permission')
    expect(fsFailureKind(errno('EPERM'))).toBe('permission')
    expect(fsFailureKind(errno('EROFS'))).toBe('permission')
  })
  it('mira la causa si el error vino envuelto', () => {
    expect(fsFailureKind(new Error('envuelto', { cause: errno('EACCES') }))).toBe('permission')
  })
  it('lo demás (red, texto, nada) no se clasifica', () => {
    expect(fsFailureKind(errno('ECONNRESET'))).toBeNull()
    expect(fsFailureKind(new Error('EACCES en el texto no cuenta'))).toBeNull()
    expect(fsFailureKind(undefined)).toBeNull()
    expect(fsFailureKind('ENOSPC')).toBeNull()
  })
})
