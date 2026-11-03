import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { reviewFile } from './review-file'

const FIX = join(__dirname, '..', 'documents', 'fixtures-review')
const dir = mkdtempSync(join(tmpdir(), 'rev-file-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('reviewFile', () => {
  it('un Word bueno sale ok y uno malo sale con avisos ✘', async () => {
    const good = join(dir, 'bueno.docx')
    const bad = join(dir, 'malo.docx')
    copyFileSync(join(FIX, 'bueno.docx'), good)
    copyFileSync(join(FIX, 'malo.docx'), bad)
    const a = await reviewFile(good)
    expect(a.status).toBe('ok')
    expect(a.items.length).toBeGreaterThan(0)
    const b = await reviewFile(bad)
    expect(b.status).toBe('issues')
    expect(b.items.some((i) => !i.ok)).toBe(true)
  })
  it('Excel y PowerPoint también se revisan', async () => {
    const x = join(dir, 'malo.xlsx')
    const p = join(dir, 'malo.pptx')
    copyFileSync(join(FIX, 'malo.xlsx'), x)
    copyFileSync(join(FIX, 'malo.pptx'), p)
    expect((await reviewFile(x)).status).toBe('issues')
    expect((await reviewFile(p)).status).toBe('issues')
  })
  it('no Office, archivo roto o inexistente: unavailable, sin lanzar', async () => {
    const txt = join(dir, 'a.txt')
    writeFileSync(txt, 'hola')
    const broken = join(dir, 'roto.docx')
    writeFileSync(broken, 'no soy un zip')
    expect(await reviewFile(txt)).toEqual({ status: 'unavailable', items: [] })
    expect((await reviewFile(broken)).status).toBe('unavailable')
    expect((await reviewFile(join(dir, 'nada.pptx'))).status).toBe('unavailable')
  })
  it('si el archivo cambia, la siguiente revisión refleja el cambio (nada de ✔ viejo)', async () => {
    const f = join(dir, 'cambia.docx')
    copyFileSync(join(FIX, 'bueno.docx'), f)
    expect((await reviewFile(f)).status).toBe('ok')
    copyFileSync(join(FIX, 'malo.docx'), f)
    expect((await reviewFile(f)).status).toBe('issues')
  })
})
