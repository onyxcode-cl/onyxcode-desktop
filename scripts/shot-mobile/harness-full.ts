// Interfaz móvil COMPLETA (la de src/renderer/remote) sobre el FakeLink con datos sintéticos. Solo para capturas.
import { FakeLink } from '../../src/renderer/remote/fake-link'
import { attachFixtures } from './fixtures'

const link = new FakeLink()
const scenario = new URLSearchParams(location.search).get('s') ?? 'lista'
attachFixtures(link, scenario)
;(globalThis as { __onyxLink?: unknown }).__onyxLink = link
;(globalThis as { __fake?: unknown }).__fake = link
;(globalThis as { __onyxAppMounted?: () => void }).__onyxAppMounted = () => {
  document.documentElement.dataset.ready = '1'
}
void import('../../src/renderer/remote/main')
