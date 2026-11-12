// Paridad offline: los locks contienen TODO el cierre común y exactamente los wheels inventariados.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { wheelRequirementsPath, expectedSeal, readPin } from './fetch-python.mjs'

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const lines = (s) => s.split('\n').filter((s) => s.trim() && !s.startsWith('#'))
const requirements = read('resources/python-bin/requirements.txt')
const versions = Object.fromEntries(lines(requirements).map((s) => s.split('==')))
const inventory = JSON.parse(read('resources/python-bin/wheels.json'))
for (const [platform, wheels] of Object.entries(inventory)) {
  test(`${platform}: versiones, wheel exacto, tamaño y SHA-256 coinciden con el cierre común`, () => {
    const path = platform === 'linux-x64' ? 'scripts/wsl-rootfs/pip-requirements.txt' : `resources/python-bin/requirements-${platform}.txt`
    const lock = read(path)
    assert.equal(wheels.length, Object.keys(versions).length)
    assert.equal(lines(lock).length, wheels.length)
    assert.deepEqual(Object.fromEntries(wheels.map((w) => [w.name, w.version])), versions)
    for (const w of wheels) {
      assert.match(w.sha256, /^[a-f0-9]{64}$/)
      assert.ok(w.size > 0 && w.unpackedSize > 0)
      const url = new URL(w.url)
      assert.equal(url.protocol, 'https:')
      assert.equal(url.hostname, 'files.pythonhosted.org')
      assert.ok(url.pathname.endsWith('/' + w.filename))
      assert.ok(w.filename.endsWith('.whl'))
      assert.ok(lock.includes(`# ${w.filename}\n${w.name}==${w.version} --hash=sha256:${w.sha256}\n`))
      if (!w.filename.endsWith('-any.whl')) {
        if (platform === 'linux-x64') {
          assert.match(w.filename, /-(?:cp313-cp313|cp3\d+-abi3|py3-none)-manylinux.*x86_64\.whl$/)
          assert.doesNotMatch(w.filename, /musllinux|aarch64|cp312-cp312/)
        } else assert.match(w.filename, platform === 'darwin-arm64' ? /macosx.*(?:arm64|universal2)\.whl$/ : /win_amd64\.whl$/)
      }
    }
    assert.equal(versions.pymupdf, '1.26.7')
  })
}
test('fetch usa el lock del destino y el sello invalida también al cambiar el hash del wheel', () => {
  assert.ok(wheelRequirementsPath('arm64', 'darwin').endsWith('requirements-darwin-arm64.txt'))
  assert.ok(wheelRequirementsPath('x64', 'win32').endsWith('requirements-win32-x64.txt'))
  assert.ok(wheelRequirementsPath('x64', 'darwin').endsWith('requirements.txt'))
  const seal = (text) => expectedSeal(readPin(), 'arm64', requirements, text).requirementsSha256
  assert.notEqual(seal('x==1 --hash=sha256:' + 'a'.repeat(64)), seal('x==1 --hash=sha256:' + 'b'.repeat(64)))
})
test('receta WSL: cierre pip con hashes, sin duplicados Debian; versión nueva coherente', () => {
  const packages = lines(read('scripts/wsl-rootfs/packages.txt'))
  assert.ok(packages.includes('python3'))
  assert.ok(packages.includes('libstdc++6'))
  assert.ok(packages.every((p) => !p.startsWith('python3-')))
  for (const p of ['git', 'ripgrep', 'mount', 'ca-certificates', 'procps']) assert.ok(packages.includes(p))
  const recipe = read('scripts/wsl-rootfs/customize.sh')
  for (const arg of ['--require-hashes', '--only-binary=:all:', '--no-deps', '--no-compile', '--python-version 3.13', '--abi cp313'])
    assert.ok(recipe.includes(arg))
  assert.ok(recipe.includes('chroot "$ROOT" /usr/bin/python3 -I'))
  assert.ok(recipe.includes('--site /usr/local/lib/python3.13/dist-packages'))
  assert.match(read('scripts/build-wsl-rootfs.sh'), /LAZUNOX_ROOTFS_VERSION:-2026\.11\.12/)
  assert.match(read('.github/workflows/wsl-rootfs.yml'), /default: '2026\.11\.12'/)
})
