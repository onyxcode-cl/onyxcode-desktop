import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { ownDeletePluginSource } from './own-delete-plugin'

const dirs: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
async function plugin() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-rm-plugin-')))
  dirs.push(dir)
  const path = join(dir, 'plugin.mjs')
  writeFileSync(path, ownDeletePluginSource())
  vi.stubEnv('LAZUNOX_OWN_DELETE_URL', 'http://127.0.0.1:1/cleanup')
  vi.stubEnv('LAZUNOX_OWN_DELETE_TOKEN', 'server-secret')
  vi.stubEnv('LAZUNOX_OWN_DELETE_RUNTIME', '1')
  vi.stubEnv('LAZUNOX_RM_BIN_DIR', '/app/own-delete-bin')
  return (await import(/* @vite-ignore */ pathToFileURL(path).href)).default.server()
}
it('shell.env pone billete por llamada y PATH; nunca reescribe una orden compuesta por adelantado', async () => {
  const ticket = 'a'.repeat(43)
  const fake = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ ticket })))
  vi.stubGlobal('fetch', fake)
  const hooks = await plugin()
  const input = { sessionID: 'ses_abcdefgh', callID: 'call_1' }
  const output = { env: { PATH: '/bin', LAZUNOX_OWN_DELETE_TOKEN: '' } }
  await hooks['shell.env'](input, output)
  expect(output.env).toEqual({
    PATH: '/app/own-delete-bin:/bin',
    LAZUNOX_OWN_DELETE_TOKEN: '',
    LAZUNOX_RM_BILLETE: ticket,
    LAZUNOX_RM_URL: 'http://127.0.0.1:1/cleanup'
  })
  expect(JSON.parse(fake.mock.calls[0]![1].body as string)).toEqual({ action: 'ticket', sessionId: input.sessionID, callId: input.callID })
  const command = { args: { command: 'printf hola > nuevo && cat nuevo && rm nuevo' } }
  await hooks['tool.execute.before']({ ...input, tool: 'bash' }, command)
  expect(command.args.command).toBe('printf hola > nuevo && cat nuevo && rm nuevo')
  expect(fake).toHaveBeenCalledTimes(1)
})
it.each(['missing', 'http-error', 'offline'])('sin billete válido deja el shell nativo: %s', async (failure) => {
  vi.stubGlobal('fetch', async () => {
    if (failure === 'offline') throw new Error('offline')
    return new Response('{}', { status: failure === 'http-error' ? 403 : 200 })
  })
  const hooks = await plugin()
  const output = { env: { PATH: '/bin' } }
  await hooks['shell.env']({ sessionID: 'ses_abcdefgh', callID: 'call_1' }, output)
  expect(output.env).toEqual({ PATH: '/bin' })
})
