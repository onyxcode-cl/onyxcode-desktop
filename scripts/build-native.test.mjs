import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { planWinHelper } from './build-native.mjs'

test('el plan por defecto fuera de Windows cruza a windows-gnu con mingw y 2 trabajos', () => {
  const p = planWinHelper([], 'darwin')
  assert.equal(p.target, 'x86_64-pc-windows-gnu')
  assert.equal(p.needsMingw, true)
  assert.equal(p.jobs, 2)
  assert.ok(p.exe.endsWith(join('target', 'x86_64-pc-windows-gnu', 'release', 'cu-helper.exe')))
  assert.ok(p.out.endsWith(join('resources', 'computer-use', 'win', 'bin', 'cu-helper.exe')))
})

test('en Windows sin --target se usa el objetivo del anfitrión y no hace falta mingw', () => {
  const p = planWinHelper([], 'win32')
  assert.equal(p.target, undefined)
  assert.equal(p.needsMingw, false)
  assert.ok(p.exe.endsWith(join('target', 'release', 'cu-helper.exe')))
})

test('--jobs y --target se validan', () => {
  assert.equal(planWinHelper(['--jobs', '4'], 'linux').jobs, 4)
  assert.equal(planWinHelper(['--jobs=3'], 'linux').jobs, 3)
  assert.equal(planWinHelper(['--target', 'x86_64-pc-windows-msvc'], 'win32').needsMingw, false)
  for (const bad of [
    ['--jobs', '0'],
    ['--jobs', '99'],
    ['--jobs', 'x'],
    ['--target', 'a; rm -rf /'],
    ['--target', '../x']
  ]) {
    assert.throws(() => planWinHelper(bad, 'linux'), undefined, bad.join(' '))
  }
})

test('importar el módulo no compila nada ni sale del proceso', () => {
  assert.equal(typeof planWinHelper, 'function')
})
