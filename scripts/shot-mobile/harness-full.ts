// Interfaz móvil COMPLETA (la de src/renderer/remote) sobre el FakeLink con datos sintéticos. Solo para capturas.
import { FakeLink } from '../../src/renderer/remote/fake-link'
import { attachFixtures } from './fixtures'

const link = new FakeLink()
const scenario = new URLSearchParams(location.search).get('s') ?? 'lista'
attachFixtures(link, scenario)
;(globalThis as { __lazunoxLink?: unknown }).__lazunoxLink = link
;(globalThis as { __fake?: unknown }).__fake = link
;(globalThis as { __lazunoxAppMounted?: () => void }).__lazunoxAppMounted = () => {
  document.documentElement.dataset.ready = '1'
}
void import('../../src/renderer/remote/main')
