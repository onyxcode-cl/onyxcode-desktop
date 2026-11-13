import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { prepareOwnDeleteBin } from './own-delete-runtime-files'
import { posixOnly } from '../../test/platform'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const fixture = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lzx rm files ')))
  dirs.push(dir)
  return dir
}
it('crea los tres verbos con Python aislado y rutas con espacios entrecomilladas', () => {
  const dir = fixture()
  const source = join(dir, 'source.py')
  writeFileSync(source, 'print(1)')
  const bin = prepareOwnDeleteBin(dir, "/python's folder/python3", source)
  for (const verb of ['rm', 'rmdir', 'unlink']) {
    expect(readFileSync(join(bin, verb), 'utf8')).toContain(`--lazunox-verb ${verb} "$@"`)
    expect(readFileSync(join(bin, verb), 'utf8')).toContain("exec '/python'\\''s folder/python3' -I '")
  }
  expect(existsSync(join(bin, 'lzx_rm.py'))).toBe(true)
})
it.skipIf(!posixOnly)('rechaza enlaces dejados en un ayudante sin sobrescribir el destino', () => {
  const dir = fixture()
  const source = join(dir, 'source.py')
  writeFileSync(source, 'print(1)')
  const bin = join(dir, 'own-delete-bin')
  mkdirSync(bin)
  symlinkSync(source, join(bin, 'rm'))
  expect(() => prepareOwnDeleteBin(dir, '/python', source)).toThrow('unsafe helper')
  expect(readFileSync(source, 'utf8')).toBe('print(1)')
  chmodSync(source, 0o600)
})
