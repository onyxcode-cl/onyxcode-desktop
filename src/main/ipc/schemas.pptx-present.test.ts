import { expect, it } from 'vitest'
import { IPC_SCHEMAS, CHANNEL_ROLES } from './schemas'
import { OFFICE_MAX_BYTES } from '@shared/attach-office'

it('Presentar solo acepta una ruta; importar solo nombre PPTX y base64 acotado, sin claves extra', () => {
  for (const channel of ['extras:presentPptx', 'tasks:presentPptx']) {
    const validate = IPC_SCHEMAS[channel]!
    expect(validate({ path: '/work/deck.pptx' })).toEqual({ path: '/work/deck.pptx' })
    expect(() => validate({ path: 'relative.pptx' })).toThrow()
    expect(() => validate({ path: '/work/deck.pptx', bypass: true })).toThrow()
  }
  const validate = IPC_SCHEMAS['extras:importPptx']!
  expect(validate({ name: 'x.pptx', base64: 'UEsDBA==' })).toEqual({ name: 'x.pptx', base64: 'UEsDBA==' })
  for (const bad of [
    { name: 'x.ppt', base64: 'UEsDBA==' },
    { name: 'x.pptx', base64: 'https://example.test/' },
    { name: 'x.pptx', base64: 'a'.repeat(Math.ceil(OFFICE_MAX_BYTES / 3) * 4 + 1) },
    { name: 'x.pptx', base64: 'UEsDBA==', path: '/escape' }
  ])
    expect(() => validate(bad)).toThrow()
  for (const channel of ['extras:presentPptx', 'tasks:presentPptx', 'extras:importPptx'])
    for (const channels of Object.values(CHANNEL_ROLES)) expect(channels.has(channel)).toBe(false)
})
