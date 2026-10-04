import { describe, expect, it } from 'vitest'
import { parseEgressHost } from './host-rules'
import { IPC_SCHEMAS } from '../ipc/schemas'

describe('parseEgressHost (F8-B69, hallazgo 7)', () => {
  it.each([
    ['example.com', 'example.com'],
    ['API.Example.COM.', 'api.example.com'],
    ['*.example.com', '*.example.com'],
    ['registry.npmjs.org', 'registry.npmjs.org'],
    ['8.8.8.8', '8.8.8.8'],
    ['xn--bcher-kva.example', 'xn--bcher-kva.example']
  ])('acepta %s', (input, out) => expect(parseEgressHost(input)).toBe(out))

  it.each([
    'com',
    'io',
    '*.com',
    '*',
    '*.',
    '.com',
    'co.uk',
    '*.co.uk',
    'com.au',
    'a*.example.com',
    'foo.*.com',
    '**.example.com',
    'localhost',
    '127.0.0.1',
    '10.1.2.3',
    '192.168.0.5',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    '[::1]',
    '2130706433',
    'foo.local',
    'host.internal',
    'exa mple.com',
    'example.com/path',
    'example.com:443',
    'user@example.com',
    'http://example.com',
    '-bad.example.com',
    'bad-.example.com',
    'a..example.com',
    ''
  ])('rechaza %j', (input) => expect(parseEgressHost(input)).toBeNull())
})

describe('esquemas de red de Tareas', () => {
  it('setHost allow/allowOnce rechazan TLD sueltos, comodines peligrosos e IP privadas', () => {
    for (const host of ['com', 'io', '*.com', '*', '127.0.0.1', '10.0.0.1']) {
      expect(() => IPC_SCHEMAS['tasks:network:setHost']({ host, decision: 'allow' }), host).toThrow()
      expect(() => IPC_SCHEMAS['tasks:network:allowOnce']({ folder: '/tmp/x', host }), host).toThrow()
    }
  })
  it('acepta hosts normales y normaliza', () => {
    expect(IPC_SCHEMAS['tasks:network:setHost']({ host: 'Example.com', decision: 'allow' })).toEqual({
      host: 'example.com',
      decision: 'allow'
    })
    expect(IPC_SCHEMAS['tasks:network:allowOnce']({ folder: '/tmp/x', host: 'cdn.example.com' })).toEqual({
      folder: '/tmp/x',
      host: 'cdn.example.com'
    })
  })
  it('unset y block siguen admitiendo entradas heredadas (poder retirarlas)', () => {
    expect(IPC_SCHEMAS['tasks:network:setHost']({ host: 'com', decision: 'unset' })).toEqual({ host: 'com', decision: 'unset' })
    expect(() => IPC_SCHEMAS['tasks:network:setHost']({ host: 'a b', decision: 'unset' })).toThrow()
  })
})
