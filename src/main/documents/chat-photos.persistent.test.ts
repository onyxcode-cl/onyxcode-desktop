import { afterEach, expect, it } from 'vitest'
import { build } from 'esbuild'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const run = promisify(execFile)
let temporary: string | undefined
afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true })
})

it('Chat conserva las fotos tras un proceso y token nuevos (transporte directo; HTTP opcional), rechaza otra conversación y orienta sobre vistas caducadas', async () => {
  temporary = await mkdtemp(join(tmpdir(), 'lzx-chat-photo-restart-'))
  const program = join(temporary, 'server.cjs')
  await build({
    entryPoints: [resolve('src/main/documents/fixtures/chat-photos-persistent.ts')],
    outfile: program,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    alias: { '@shared': resolve('src/shared') },
    logLevel: 'silent'
  })
  const launch = async (phase: string) => {
    const { stdout } = await run(process.execPath, [program, temporary!, phase], {
      timeout: 15_000,
      killSignal: 'SIGKILL',
      env: { ...process.env, NODE_PATH: resolve('node_modules') }
    })
    const result = stdout.split('\n').find((line) => line.startsWith('RESULT '))
    expect(result).toBeDefined()
    return JSON.parse(result!.slice(7))
  }
  const before = await launch('prepare')
  const after = await launch('reload')
  expect(after.pid).not.toBe(before.pid)
  expect(after.tokenHash).not.toBe(before.tokenHash)
  for (const result of [before, after]) {
    expect(result.transport).toBe(process.env.LAZUNOX_PHOTO_RESTART_LOOPBACK === '1' ? 'http' : 'direct-with-real-token')
    expect(result.used).toMatchObject({ id: 'prepared-before-restart', source: 'imagen:prepared-before-restart' })
    expect(result.embedded).toBe(true)
    expect(result.unresolved).toBe(false)
    expect(result.automaticCredit).toBe(false)
    expect(result.otherHtmlError).toContain('prepared-before-restart')
    expect(result.otherUseRejected).toBe(true)
  }
  expect(after.expired.isError).toBe(true)
  expect(after.expired.text).toContain('Ese resultado de búsqueda ya no está disponible; vuelve a buscar')
}, 45_000)
