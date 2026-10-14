import { beforeEach, describe, expect, it, vi } from 'vitest'

const call = vi.fn((..._args: unknown[]) => Promise.resolve())
vi.mock('./api', () => ({ call: (...a: unknown[]) => call(...a) }))

let mod: typeof import('./report-problems')

beforeEach(async () => {
  call.mockClear()
  vi.resetModules()
  mod = await import('./report-problems')
})

describe('reportDocProblem', () => {
  it('manda el aviso por diag:problem con el origen «chat-doc» (queda en el registro de problemas como «documento»)', () => {
    mod.reportDocProblem('{"slides": [roto]}', mod.docProblemMessage('pptx', 'json'))
    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('diag:problem', {
      message: 'documento de Chat (pptx) no se pudo usar: JSON inválido',
      origin: 'chat-doc'
    })
  })

  it('nunca manda el contenido del documento', () => {
    mod.reportDocProblem('contenido secreto del documento', mod.docProblemMessage('docx', 'schema'))
    expect(JSON.stringify(call.mock.calls)).not.toContain('secreto')
  })

  it('el mismo documento y motivo se anota UNA sola vez, aunque el mensaje se repinte o termine con un salto de línea', () => {
    mod.reportDocProblem('abc', mod.docProblemMessage('xlsx', 'cut'))
    mod.reportDocProblem('abc\n', mod.docProblemMessage('xlsx', 'cut'))
    mod.reportDocProblem('abc', mod.docProblemMessage('xlsx', 'cut'))
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('otro motivo u otro documento sí se anotan', () => {
    mod.reportDocProblem('abc', mod.docProblemMessage('xlsx', 'cut'))
    mod.reportDocProblem('abc', mod.docProblemMessage('xlsx', 'json'))
    mod.reportDocProblem('otro', mod.docProblemMessage('xlsx', 'cut'))
    expect(call).toHaveBeenCalledTimes(3)
  })

  it('si el aviso falla, no lanza', () => {
    call.mockImplementationOnce(() => Promise.reject(new Error('cerrando')))
    expect(() => mod.reportDocProblem('x', 'm')).not.toThrow()
  })
})
