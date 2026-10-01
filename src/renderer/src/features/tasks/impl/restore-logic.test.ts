import { describe, expect, it } from 'vitest'
import type { TasksRestorePoint } from '@shared/ipc-tasks'
import {
  failedText,
  firstPoint,
  notCopiedWarningText,
  notRestorableText,
  pickPointForMessage,
  restoreResultText,
  restoreWarningText,
  UNDO_POINT_LABEL
} from './restore-logic'

const pt = (id: string, createdAt: number, over: Partial<TasksRestorePoint> = {}): TasksRestorePoint => ({
  id,
  sessionId: 's',
  folder: '/f',
  createdAt,
  label: 'x',
  files: 1,
  bytes: 1,
  status: 'ok',
  ...over
})

describe('restore-logic', () => {
  it('pickPointForMessage: el último punto con createdAt ≤ momento del mensaje', () => {
    const list = [pt('a', 100), pt('b', 200), pt('c', 300)]
    expect(pickPointForMessage(list, 250)?.id).toBe('b')
    expect(pickPointForMessage(list, 300)?.id).toBe('c')
    expect(pickPointForMessage(list, 99)).toBeNull()
  })
  it('ignora los puntos saltados y los «Antes de deshacer»', () => {
    const list = [pt('a', 100), pt('b', 200, { status: 'skipped' }), pt('u', 250, { label: UNDO_POINT_LABEL })]
    expect(pickPointForMessage(list, 300)?.id).toBe('a')
    expect(firstPoint(list)?.id).toBe('a')
    expect(firstPoint([pt('b', 1, { status: 'skipped' })])).toBeNull()
  })
  it('firstPoint: el más antiguo', () => {
    expect(firstPoint([pt('b', 200), pt('a', 100)])?.id).toBe('a')
  })
  it('motivos de «no restaurable» y aviso de archivos no guardados', () => {
    expect(notRestorableText('cloud')).toMatch(/^No restaurable \(solo en la nube\)/)
    expect(notRestorableText('unreadable')).toMatch(/no se pudo leer/)
    expect(notRestorableText('large')).toMatch(/50 MB/)
    expect(notRestorableText(undefined)).toMatch(/50 MB/)
    expect(notCopiedWarningText(1)).toMatch(/1 archivo /)
    expect(notCopiedWarningText(3)).toMatch(/3 archivos /)
  })
  it('textos', () => {
    expect(restoreWarningText('la carpeta ocupa más de 2 GB')).toBe(
      'Esta vez no se guardó un punto de restauración: la carpeta ocupa más de 2 GB'
    )
    expect(restoreResultText({ kind: 'undone', restored: 2, trashed: 1 })).toBe(
      'Cambios deshechos: 2 restaurados, 1 enviados a la Papelera.'
    )
    expect(restoreResultText({ kind: 'redone', restored: 0, trashed: 0 })).toMatch(/^Cambios rehechos/)
    expect(failedText([])).toBe('')
    expect(failedText([{ path: 'a', reason: 'r' }])).toBe('No se pudo restaurar: a (r).')
  })
})
