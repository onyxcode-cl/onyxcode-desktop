// Pruebas sin red de scripts/fetch-python.mjs (pin, rutas, requisitos, poda). Se ejecutan con: node --test scripts/fetch-python.test.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  PIN_PATH,
  REQUIREMENTS_PATH,
  assetFor,
  expectedSeal,
  parseArgs,
  parsePin,
  parseRequirements,
  pinKey,
  pruneInstall,
  pythonBin,
  pythonDir,
  readPin
} from './fetch-python.mjs'

const good = () => JSON.parse(readFileSync(PIN_PATH, 'utf8'))

test('el pin real es válido y cubre arm64 y x64 con sha256 de 64 hex y URLs de astral-sh', () => {
  const pin = readPin()
  assert.match(pin.python, /^3\.12\.\d+$/)
  for (const key of ['darwin-arm64', 'darwin-x64']) {
    const a = pin.assets[key]
    assert.match(a.sha256, /^[0-9a-f]{64}$/)
    assert.ok(a.url.startsWith('https://github.com/astral-sh/python-build-standalone/releases/download/'))
    assert.ok(a.url.includes(pin.release) && a.url.endsWith('.tar.gz'))
    assert.ok(Number.isInteger(a.size) && a.size > 1_000_000)
  }
  assert.equal(assetFor(pin, 'arm64'), pin.assets['darwin-arm64'])
})

test('parsePin rechaza sha256 malo, URL ajena, http, sin plataforma y JSON roto', () => {
  const bad = (mut) => {
    const p = good()
    mut(p)
    return JSON.stringify(p)
  }
  assert.throws(() => parsePin(bad((p) => (p.assets['darwin-arm64'].sha256 = 'abc'))), /darwin-arm64/)
  assert.throws(() => parsePin(bad((p) => (p.assets['darwin-x64'].sha256 = 'G'.repeat(64)))), /darwin-x64/)
  assert.throws(() => parsePin(bad((p) => (p.assets['darwin-arm64'].url = 'https://evil.example/python.tar.gz'))), /darwin-arm64/)
  assert.throws(
    () => parsePin(bad((p) => (p.assets['darwin-arm64'].url = 'https://github.com/otro/repo/releases/download/x.tar.gz'))),
    /darwin-arm64/
  )
  assert.throws(
    () => parsePin(bad((p) => (p.assets['darwin-x64'].url = p.assets['darwin-x64'].url.replace('https', 'http')))),
    /darwin-x64/
  )
  assert.throws(() => parsePin(bad((p) => delete p.assets['darwin-x64'])), /darwin-x64/)
  assert.throws(() => parsePin(bad((p) => (p.assets['darwin-arm64'].size = '10'))), /darwin-arm64/)
  assert.throws(() => parsePin(bad((p) => (p.release = 'hoy'))), /inválido/)
  assert.throws(() => parsePin('{no json'), /JSON/)
})

test('rutas y claves por arquitectura', () => {
  assert.equal(pinKey('arm64'), 'darwin-arm64')
  assert.equal(pinKey('x64'), 'darwin-x64')
  assert.throws(() => pinKey('ia32'), /no soportada/)
  assert.equal(pythonDir('arm64', '/b'), '/b/mac-arm64/python')
  assert.equal(pythonBin('x64', '/b'), '/b/mac-x64/python/bin/python3')
  assert.deepEqual(parseArgs(['--if-missing', '--arch', 'x64']), { ifMissing: true, arch: 'x64' })
  assert.throws(() => parseArgs(['--arch', 'mips']), /no soportada/)
})

test('requirements.txt fija las 9 librerías con versión exacta', () => {
  const lines = parseRequirements(readFileSync(REQUIREMENTS_PATH, 'utf8'))
  assert.ok(
    lines.every((l) => /^[A-Za-z0-9_.-]+==\d[\w.]*$/.test(l)),
    'todas con =='
  )
  for (const name of ['python-docx', 'openpyxl', 'python-pptx', 'pypdf', 'pdfplumber', 'reportlab', 'pypdfium2', 'pillow', 'lxml']) {
    assert.ok(
      lines.some((l) => l.startsWith(`${name}==`)),
      name
    )
  }
})

test('el sello cambia si cambian los requisitos o el pin', () => {
  const pin = readPin()
  const a = expectedSeal(pin, 'arm64', 'a==1\n')
  assert.deepEqual(a, expectedSeal(pin, 'arm64', '# nota\na==1\n\n'))
  assert.notEqual(a.requirementsSha256, expectedSeal(pin, 'arm64', 'a==2\n').requirementsSha256)
  assert.notEqual(a.release, expectedSeal({ ...pin, release: '20990101' }, 'arm64', 'a==1\n').release)
})

test('pruneInstall borra lo innecesario y conserva python3, stdlib y site-packages', () => {
  const root = mkdtempSync(join(tmpdir(), 'prune-test-'))
  try {
    const mk = (rel, content = 'x') => {
      const p = join(root, rel)
      mkdirSync(join(p, '..'), { recursive: true })
      writeFileSync(p, content)
    }
    for (const f of [
      'bin/python3',
      'bin/python3.12',
      'bin/pip3',
      'bin/idle3',
      'include/python3.12/Python.h',
      'lib/python3.12/test/a.py',
      'lib/python3.12/idlelib/a.py',
      'lib/python3.12/tkinter/a.py',
      'lib/python3.12/os.py',
      'lib/python3.12/__pycache__/os.pyc',
      'lib/python3.12/lib-dynload/_tkinter.so',
      'lib/python3.12/lib-dynload/math.so',
      'lib/python3.12/site-packages/docx/a.py',
      'lib/python3.12/site-packages/pip/a.py',
      'lib/python3.12/site-packages/pip-25.0.1.dist-info/METADATA',
      'lib/libpython3.12.dylib',
      'lib/libtcl9.0.dylib'
    ])
      mk(f)
    pruneInstall(root)
    for (const f of [
      'bin/python3',
      'bin/python3.12',
      'lib/python3.12/os.py',
      'lib/python3.12/lib-dynload/math.so',
      'lib/python3.12/site-packages/docx/a.py',
      'lib/libpython3.12.dylib'
    ])
      assert.ok(existsSync(join(root, f)), f)
    for (const f of [
      'bin/pip3',
      'bin/idle3',
      'include',
      'lib/python3.12/test',
      'lib/python3.12/idlelib',
      'lib/python3.12/tkinter',
      'lib/python3.12/__pycache__',
      'lib/python3.12/lib-dynload/_tkinter.so',
      'lib/python3.12/site-packages/pip',
      'lib/python3.12/site-packages/pip-25.0.1.dist-info',
      'lib/libtcl9.0.dylib'
    ])
      assert.ok(!existsSync(join(root, f)), f)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
