import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guardia del auxiliar del Llavero (`resources/keybox`). Su `cdhash` es la identidad que el Llavero de macOS recuerda entre versiones:
 * si el código cambia, TODOS los usuarios verían la pregunta de la contraseña del Llavero una vez más. Por eso el binario va en git y su
 * fuente queda fijada por hash: para cambiarla hay que recompilar con `resources/keybox/build.sh`, que actualiza SOURCE.sha256.
 */
const dir = join(__dirname, '..', '..', 'resources', 'keybox')

describe('auxiliar del Llavero (lazunox-keybox)', () => {
  it('el código fuente coincide con SOURCE.sha256 (si lo cambias, recompila con build.sh: cambia la identidad ante el Llavero)', () => {
    const src = readFileSync(join(dir, 'keybox.swift'))
    const pinned = readFileSync(join(dir, 'SOURCE.sha256'), 'utf8').trim()
    expect(createHash('sha256').update(src).digest('hex'), 'keybox.swift cambió: recompila con resources/keybox/build.sh').toBe(pinned)
  })

  it('el binario compilado está en git y el empaquetado lo incluye con un identificador fijo', () => {
    expect(existsSync(join(dir, 'lazunox-keybox'))).toBe(true)
    const builder = readFileSync(join(__dirname, '..', '..', 'electron-builder.js'), 'utf8')
    expect(builder).toContain("filter: ['lazunox-keybox']")
    expect(builder).toContain("'Contents/Resources/keybox/lazunox-keybox'")
    expect(readFileSync(join(__dirname, '..', '..', 'build', 'sign-common.js'), 'utf8')).toContain("'keybox', 'lazunox-keybox'")
  })

  it('el identificador de build.sh es el de sign-common (`<appId>.keybox`) y la fuente solo acepta a Lazunox como llamador', () => {
    expect(readFileSync(join(dir, 'build.sh'), 'utf8')).toContain('KEYBOX_ID="cl.bentec.lazunox.keybox"')
    const swift = readFileSync(join(dir, 'keybox.swift'), 'utf8')
    expect(swift).toContain('let allowedIdentifier = "cl.bentec.lazunox"')
    expect(swift).toContain('callerIsLazunox()')
    expect(swift).toContain('certificate leaf = H')
  })
})
