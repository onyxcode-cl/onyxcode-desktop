/**
 * `SkillRecorder.prepare` (1.8.18, corrección tras la revisión 1): las capturas se copian a `.lazunox/trabajo/grabaciones/<id>` con la
 * escritura segura (`tasks/safe-write.ts`). Lo normal funciona y un enlace en el camino no recibe nada. Enlaces: solo macOS/Linux.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import { t } from '@shared/i18n'
import { posixOnly } from '../../test/platform'
import { SkillRecorder } from './recorder'

let root: string
let base: string
let folder: string
let outside: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-recorder-')))
  base = join(root, 'ud', 'skill-recordings')
  folder = join(root, 'tarea')
  outside = join(root, 'fuera')
  for (const d of [base, folder, outside]) mkdirSync(d, { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function recording(id: string): void {
  const dir = join(base, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'shot-1.png'), 'PNG1')
  writeFileSync(join(dir, 'shot-2.png'), 'PNG2')
  writeFileSync(
    join(dir, 'recording.json'),
    JSON.stringify({ id, dir, startedAt: 0, durationMs: 1000, steps: [], shots: ['shot-1.png', 'shot-2.png'], mic: 'off', transcript: null })
  )
}

describe.skipIf(!posixOnly)('SkillRecorder.prepare', () => {
  it('copia las capturas a la carpeta de grabaciones de la tarea y borra la copia de userData', async () => {
    recording('r1')
    const rec = new SkillRecorder(() => null, base)
    const out = await rec.prepare('r1', folder, false)
    const dest = join(folder, out.relDir)
    expect(readdirSync(dest).sort()).toEqual(['shot-1.png', 'shot-2.png'])
    expect(readFileSync(join(dest, 'shot-2.png'), 'utf8')).toBe('PNG2')
    expect(existsSync(join(base, 'r1'))).toBe(false)
  })

  it('con `grabaciones` como enlace: error claro y nada se escribe en el destino', async () => {
    recording('r2')
    mkdirSync(join(folder, '.lazunox', 'trabajo'), { recursive: true })
    symlinkSync(outside, join(folder, '.lazunox', 'trabajo', 'grabaciones'))
    const rec = new SkillRecorder(() => null, base)
    await expect(rec.prepare('r2', folder, false)).rejects.toThrow(
      t('merr.task.linkInFolder', { path: join('.lazunox', 'trabajo', 'grabaciones', 'r2') })
    )
    expect(readdirSync(outside)).toEqual([])
  })
})
