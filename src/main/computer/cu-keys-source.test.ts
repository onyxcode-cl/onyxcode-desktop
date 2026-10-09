/**
 * Guardia de `cu-keys` (resources/computer-use/keys.swift): TODO evento que postea lleva la misma marca `eventSourceUserData` que
 * `cu-helper`. Sin ella `watch-esc` toma un Escape sintético por el del usuario y corta el control, y `recent-input` cree que el
 * usuario está tecleando (regresión real: se vio con Windows App). Es un análisis del código fuente: no ejecuta nada.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = join(process.cwd(), 'resources', 'computer-use')
const keys = readFileSync(join(dir, 'keys.swift'), 'utf8')
const helper = readFileSync(join(dir, 'helper.swift'), 'utf8')

describe('cu-keys marca sus eventos como propios', () => {
  it('usa la misma marca que cu-helper', () => {
    const tag = (src: string): string | undefined =>
      /let ownEventTag: Int64 = (0x[0-9A-Fa-f_]+)/.exec(src)?.[1]?.replace(/_/g, '').toLowerCase()
    expect(tag(keys)).toBeDefined()
    expect(tag(keys)).toBe(tag(helper))
  })

  it('el único `.post(tap:` está en la función `post`, que pone la marca antes de enviar', () => {
    const posts = keys.split('\n').filter((l) => l.includes('.post(tap:'))
    expect(posts).toHaveLength(1)
    const body = /func post\(_ e: CGEvent\?\) \{[\s\S]*?\n\}/.exec(keys)?.[0] ?? ''
    expect(body).toContain('eventSourceUserData')
    expect(body.indexOf('eventSourceUserData')).toBeLessThan(body.indexOf('.post(tap:'))
  })

  it('usa la fuente privada como cu-helper (aísla del estado físico de modificadores)', () => {
    expect(keys).toContain('CGEventSource(stateID: .privateState)')
  })
})
