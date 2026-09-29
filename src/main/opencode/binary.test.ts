import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { getOpencodeInfo, isCompatible, parseVersion, validateOpencodeBin } from './binary'
import { findOpencodeBinary } from './server'

const dir = mkdtempSync(join(tmpdir(), 'onyx-bin-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function script(name: string, body: string, mode = 0o755): string {
  const file = join(dir, name)
  writeFileSync(file, `#!/bin/sh\n${body}\n`)
  chmodSync(file, mode)
  return file
}

describe('parseVersion / isCompatible', () => {
  it('extrae el número de versión', () => {
    expect(parseVersion('1.18.33\n')).toBe('1.18.33')
    expect(parseVersion('opencode v2.0.1-beta.3 (abc)')).toBe('2.0.1-beta.3')
    expect(parseVersion('sin versión')).toBeNull()
  })
  it('compatible = misma mayor y menor', () => {
    expect(isCompatible('1.18.33', '1.18.32')).toBe(true)
    expect(isCompatible('1.18.0', '1.18.32')).toBe(true)
    expect(isCompatible('1.19.0', '1.18.32')).toBe(false)
    expect(isCompatible('2.18.32', '1.18.32')).toBe(false)
    expect(isCompatible(null, '1.18.32')).toBe(false)
  })
})

describe('validateOpencodeBin (archivos reales)', () => {
  it('acepta un ejecutable cuyo --version imprime algo', async () => {
    const bin = script('ok', 'echo 1.18.32')
    expect(await validateOpencodeBin(bin)).toEqual({ ok: true, path: bin, output: '1.18.32', version: '1.18.32' })
  })
  it('acepta un enlace simbólico a un ejecutable válido', async () => {
    const bin = script('target', 'echo 1.2.3')
    const link = join(dir, 'link')
    symlinkSync(bin, link)
    expect((await validateOpencodeBin(link)).ok).toBe(true)
  })
  it('acepta una versión sin número (imprime algo) con version null', async () => {
    const r = await validateOpencodeBin(script('dev', 'echo dev-build'))
    expect(r).toMatchObject({ ok: true, version: null })
  })
  it('rechaza rutas inexistentes, relativas y vacías', async () => {
    expect((await validateOpencodeBin(join(dir, 'nope'))).ok).toBe(false)
    expect((await validateOpencodeBin('opencode')).ok).toBe(false)
    expect((await validateOpencodeBin('')).ok).toBe(false)
  })
  it('rechaza un directorio', async () => {
    expect(await validateOpencodeBin(dir)).toEqual({ ok: false, error: 'La ruta no es un archivo.' })
  })
  it('rechaza un archivo sin permiso de ejecución', async () => {
    const r = await validateOpencodeBin(script('noexec', 'echo 1.0.0', 0o644))
    expect(r).toEqual({ ok: false, error: 'El archivo no es ejecutable.' })
  })
  it('rechaza si --version no imprime nada', async () => {
    expect((await validateOpencodeBin(script('silent', 'exit 0'))).ok).toBe(false)
  })
  it('rechaza si --version termina con error', async () => {
    expect((await validateOpencodeBin(script('fails', 'echo boom; exit 3'))).ok).toBe(false)
  })
  it('rechaza (timeout) si --version se cuelga', async () => {
    const started = Date.now()
    const r = await validateOpencodeBin(script('hang', 'exec sleep 30'), 300)
    expect(r.ok).toBe(false)
    expect(Date.now() - started).toBeLessThan(5_000)
  })
  it('no usa shell: los metacaracteres de la ruta no se interpretan', async () => {
    const weird = join(dir, 'a;b $(x)')
    writeFileSync(weird, '#!/bin/sh\necho 9.9.9\n')
    chmodSync(weird, 0o755)
    expect((await validateOpencodeBin(weird)).ok).toBe(true)
  })
})

describe('getOpencodeInfo', () => {
  it('sin binario: found=false', async () => {
    expect(await getOpencodeInfo(() => null)).toMatchObject({
      found: false,
      path: null,
      version: null,
      compatible: false,
      sdkVersion: '1.18.32'
    })
  })
  it('con binario: versión y compatibilidad', async () => {
    const bin = script('info', 'echo 1.18.99')
    expect(await getOpencodeInfo(() => bin)).toMatchObject({ found: true, path: bin, version: '1.18.99', compatible: true })
    const old = script('info-old', 'echo 0.9.0')
    expect(await getOpencodeInfo(() => old)).toMatchObject({ found: true, version: '0.9.0', compatible: false })
  })
  it('binario que falla: found=true, version null', async () => {
    const bin = script('info-bad', 'exit 1')
    expect(await getOpencodeInfo(() => bin)).toMatchObject({ found: true, version: null, compatible: false })
  })
})

describe('findOpencodeBinary: OPENCODE_BIN antes que settings.opencodeBin', () => {
  it('usa el binario de ajustes si OPENCODE_BIN falta o es inválido, y OPENCODE_BIN si es válido', () => {
    const configured = script('configured', 'echo 1.0.0')
    const fromEnv = script('fromenv', 'echo 1.0.0')
    const saved = process.env.OPENCODE_BIN
    try {
      process.env.OPENCODE_BIN = join(dir, 'no-existe')
      expect(findOpencodeBinary(configured)).toBe(configured)
      process.env.OPENCODE_BIN = fromEnv
      expect(findOpencodeBinary(configured)).toBe(fromEnv)
    } finally {
      if (saved === undefined) delete process.env.OPENCODE_BIN
      else process.env.OPENCODE_BIN = saved
    }
  })
})
