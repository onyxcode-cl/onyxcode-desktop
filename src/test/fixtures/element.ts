/** `PickedElement` v2 de ejemplo para las pruebas del chip del elemento (ya saneado, como lo entrega main). */
import type { PickedElement } from '@shared/ipc-browser'

// JPEG mínimo en base64 (1×1): basta para que `usableImage` lo acepte.
export const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k='

export function pickedElement(over: Partial<PickedElement> = {}): PickedElement {
  return {
    v: 2,
    tag: 'button',
    role: 'button',
    name: 'Comprar',
    text: 'Comprar',
    selector: '[data-testid="buy"]',
    path: 'main > section.hero > div.cta > button',
    html: '<button class="cta" data-testid="buy" type="submit">Comprar</button>',
    styles: { display: 'inline-flex', color: 'rgb(255, 255, 255)', 'background-color': 'rgb(37, 99, 235)' },
    rect: { x: 120, y: 340, width: 180, height: 44 },
    viewport: { width: 1280, height: 720, dpr: 2 },
    url: 'http://localhost:3000/tienda',
    title: 'Tienda',
    image: { mime: 'image/jpeg', dataUrl: TINY_JPEG, width: 196, height: 60 },
    diagnostics: {
      console: [{ level: 'error', text: 'boom' }],
      network: [{ method: 'GET', url: 'http://localhost:3000/missing', status: 404 }],
      sinceMs: 4200
    },
    flags: { sensitive: false, truncated: false },
    redactions: 0,
    ...over
  }
}
