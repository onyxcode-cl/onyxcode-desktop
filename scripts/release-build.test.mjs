// Pruebas (node:test, sin Electron ni red) de la firma y la notarización: build/sign-common.js, build/notarize.js,
// build/notarize-dmg.js y scripts/verify-signed.mjs. Todo con dobles: nada firma, notariza ni empaqueta de verdad.
//   node --test scripts/*.test.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { MODES, parseCodesignInfo, plannedCommands, verifySigned, main } from './verify-signed.mjs'

const require = createRequire(import.meta.url)
const common = require('../build/sign-common.js')
const { runAfterSign } = require('../build/notarize.js')
const { notarizeDmgs } = require('../build/notarize-dmg.js')

const IDS = { appId: 'cl.t.lazunox', helperId: 'cl.t.lazunox.cu-helper', disclaimId: 'cl.t.lazunox.disclaim' }
const API = { APPLE_API_KEY: '/tmp/k.p8', APPLE_API_KEY_ID: 'KID', APPLE_API_ISSUER: 'ISS' }
const APPLE = { APPLE_ID: 'a@b.c', APPLE_APP_SPECIFIC_PASSWORD: 'secreto-de-prueba', APPLE_TEAM_ID: 'ABCDE12345' }

// ---- A1: credenciales de notarización ---------------------------------------------------------

test('A1 resolveNotarizeCreds: ninguna / API key / Apple ID / incompleta / prioridad', () => {
  assert.equal(common.resolveNotarizeCreds({}).kind, 'none')
  assert.deepEqual(common.resolveNotarizeCreds(API), { kind: 'api-key', key: '/tmp/k.p8', keyId: 'KID', issuer: 'ISS' })
  assert.deepEqual(common.resolveNotarizeCreds(APPLE), { kind: 'apple-id', appleId: 'a@b.c', teamId: 'ABCDE12345' })
  assert.equal(common.resolveNotarizeCreds({ ...APPLE, ...API }).kind, 'api-key')
  const inc = common.resolveNotarizeCreds({ APPLE_API_KEY: '/tmp/k.p8', APPLE_ID: 'a@b.c' })
  assert.equal(inc.kind, 'incomplete')
  assert.deepEqual(inc.missing.apiKey, ['APPLE_API_KEY_ID', 'APPLE_API_ISSUER'])
  assert.deepEqual(inc.missing.appleId, ['APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'])
  assert.match(common.describeIncomplete(inc), /APPLE_API_KEY_ID.*APPLE_APP_SPECIFIC_PASSWORD/s)
  // Una variable vacía cuenta como ausente.
  assert.equal(common.resolveNotarizeCreds({ ...API, APPLE_API_ISSUER: '' }).kind, 'incomplete')
})

test('A1 notarizeOptions y notarytoolAuthArgs: la contraseña de app no va en argv', () => {
  const o = common.notarizeOptions(common.resolveNotarizeCreds(API), '/x/Lazunox.app')
  assert.deepEqual(o, {
    tool: 'notarytool',
    appPath: '/x/Lazunox.app',
    appleApiKey: '/tmp/k.p8',
    appleApiKeyId: 'KID',
    appleApiIssuer: 'ISS'
  })
  const a = common.notarytoolAuthArgs(common.resolveNotarizeCreds(APPLE))
  assert.deepEqual(a, ['--apple-id', 'a@b.c', '--password', '@env:APPLE_APP_SPECIFIC_PASSWORD', '--team-id', 'ABCDE12345'])
  assert.ok(!a.join(' ').includes('secreto-de-prueba'))
  assert.throws(() => common.notarytoolAuthArgs({ kind: 'none' }))
})

function ctx() {
  return { electronPlatformName: 'darwin', appOutDir: '/out/mac-arm64', packager: { appInfo: { productFilename: 'Lazunox' } } }
}
function doubles() {
  const calls = []
  const logs = []
  return { calls, logs, run: (c, a) => calls.push([c, ...a]), log: (m) => logs.push(m), notarize: async (o) => calls.push(['notarize', o]) }
}

test('A1 afterSign: sin identidad no hace nada; con identidad pero sin credenciales firma helpers y omite la notarización', async () => {
  let d = doubles()
  await runAfterSign(ctx(), { ...d, env: {} })
  assert.deepEqual(d.calls, [])
  assert.match(d.logs.join('\n'), /ad-hoc/)

  d = doubles()
  await runAfterSign(ctx(), { ...d, env: { CSC_NAME: 'Developer ID Application: X (ABCDE12345)' } })
  assert.ok(d.calls.some((c) => c[0] === '/usr/bin/codesign'))
  assert.ok(!d.calls.some((c) => c[0] === 'notarize'))
  assert.match(d.logs.join('\n'), /se omite la notarización/)
})

test('A1 afterSign: API key (prioridad) y Apple ID notarizan después de firmar; incompleta o CSC_LINK sin CSC_NAME fallan claro', async () => {
  let d = doubles()
  await runAfterSign(ctx(), { ...d, env: { CSC_NAME: 'Dev', ...APPLE, ...API } })
  const n = d.calls.filter((c) => c[0] === 'notarize')
  assert.equal(n.length, 1)
  assert.equal(n[0][1].appleApiKey, '/tmp/k.p8')
  assert.equal(n[0][1].appPath, '/out/mac-arm64/Lazunox.app')
  assert.ok(
    d.calls.findIndex((c) => c[0] === 'notarize') > d.calls.findIndex((c) => c[0] === '/usr/bin/codesign'),
    'se firma ANTES de notarizar'
  )

  d = doubles()
  await runAfterSign(ctx(), { ...d, env: { CSC_NAME: 'Dev', ...APPLE } })
  assert.equal(d.calls.find((c) => c[0] === 'notarize')[1].teamId, 'ABCDE12345')

  d = doubles()
  await assert.rejects(runAfterSign(ctx(), { ...d, env: { CSC_NAME: 'Dev', APPLE_API_KEY: '/k.p8' } }), /incompletas.*APPLE_API_KEY_ID/s)
  assert.deepEqual(d.calls, [])
  await assert.rejects(runAfterSign(ctx(), { ...doubles(), env: { CSC_LINK: '/x.p12' } }), /CSC_NAME/)
  // En otras plataformas no hace nada.
  d = doubles()
  await runAfterSign({ ...ctx(), electronPlatformName: 'win32' }, { ...d, env: { CSC_NAME: 'Dev' } })
  assert.deepEqual(d.calls, [])
})

// ---- A2: identificadores de helpers con Developer ID -------------------------------------------

test('A2 resignBundle: argumentos exactos de codesign en modo self y devid', () => {
  const app = '/o/Lazunox.app'
  const res = `${app}/Contents/Resources`
  let calls = []
  common.resignBundle({ appPath: app, identity: 'Local', ids: IDS, mode: 'self', run: (c, a) => calls.push([c, ...a]) })
  assert.deepEqual(calls, [
    ['/usr/bin/codesign', '--force', '--sign', 'Local', '--identifier', IDS.helperId, `${res}/computer-use/bin/cu-helper`],
    ['/usr/bin/codesign', '--force', '--sign', 'Local', '--identifier', IDS.disclaimId, `${res}/launcher/lazunox-disclaim`],
    ['/usr/bin/codesign', '--force', '--sign', 'Local', '--identifier', IDS.appId, app],
    ['/usr/bin/codesign', '--verify', '--deep', '--strict', app]
  ])

  calls = []
  const ent = '/r/build/entitlements.mac.plist'
  common.resignBundle({ appPath: app, identity: 'Dev', ids: IDS, mode: 'devid', entitlements: ent, run: (c, a) => calls.push([c, ...a]) })
  const rt = ['--options', 'runtime', '--timestamp', '--entitlements', ent]
  assert.deepEqual(calls, [
    ['/usr/bin/codesign', '--force', '--sign', 'Dev', '--identifier', IDS.helperId, ...rt, `${res}/computer-use/bin/cu-helper`],
    ['/usr/bin/codesign', '--force', '--sign', 'Dev', '--identifier', IDS.disclaimId, ...rt, `${res}/launcher/lazunox-disclaim`],
    ['/usr/bin/codesign', '--force', '--sign', 'Dev', '--identifier', IDS.appId, ...rt, app],
    ['/usr/bin/codesign', '--verify', '--deep', '--strict', app]
  ])
  assert.ok(!calls.some((c) => c.includes('--deep') && c.includes('--force')), 'el resellado no usa --deep')

  calls = []
  common.resignBundle({
    appPath: app,
    identity: 'Dev',
    ids: IDS,
    mode: 'devid',
    entitlements: ent,
    keychain: '/tmp/ci.keychain-db',
    run: (c, a) => calls.push([c, ...a])
  })
  assert.ok(calls.slice(0, 3).every((c) => c.includes('--keychain') && c[c.indexOf('--keychain') + 1] === '/tmp/ci.keychain-db'))
  assert.throws(() => common.resignBundle({ appPath: app, identity: 'Dev', ids: IDS, mode: 'devid', run: () => undefined }), /entitlements/)
  assert.throws(() => common.resignBundle({ appPath: app, identity: 'Dev', ids: IDS, mode: 'x', run: () => undefined }), /modo/)
})

test('A2 el gancho autofirmado conserva su contrato (resign con 4 args) y los ids salen de brand.ts', () => {
  const hook = require('../build/after-sign-self-signed.js')
  const calls = []
  hook.resign({ appPath: '/o/A.app', identity: 'L', ids: IDS, run: (c, a) => calls.push([c, ...a]) })
  assert.equal(calls.length, 4)
  assert.ok(!calls[0].includes('--options'))
  assert.deepEqual(hook.idsFromBrandSource("export const AUTHOR_ALIAS = 'zz'"), {
    appId: 'cl.zz.lazunox',
    helperId: 'cl.zz.lazunox.cu-helper',
    keysId: 'cl.zz.lazunox.cu-keys',
    disclaimId: 'cl.zz.lazunox.disclaim'
  })
})

test('A2 el afterSign de Developer ID usa los ids de brand.ts y los entitlements del repo', async () => {
  const d = doubles()
  await runAfterSign(ctx(), { ...d, env: { CSC_NAME: 'Dev' } })
  const helper = d.calls.find((c) => c[0] === '/usr/bin/codesign' && c.at(-1).endsWith('/cu-helper'))
  assert.match(helper[helper.indexOf('--identifier') + 1], /^cl\..+\.lazunox\.cu-helper$/)
  assert.match(helper[helper.indexOf('--entitlements') + 1], /build\/entitlements\.mac\.plist$/)
})

// ---- A3: notarizar y grapar el .dmg --------------------------------------------------------------

test('A3 notarizeDmgs: notariza, graba y valida con la API key; Apple ID con @env; omite sin credenciales o sin Developer ID', async () => {
  const res = { artifactPaths: ['/d/x.dmg', '/d/x.dmg.blockmap', '/d/x.zip'] }
  let d = doubles()
  await notarizeDmgs(res, { ...d, platform: 'darwin', env: { CSC_NAME: 'Dev', ...API } })
  assert.deepEqual(d.calls, [
    ['/usr/bin/xcrun', 'notarytool', 'submit', '/d/x.dmg', '--key', '/tmp/k.p8', '--key-id', 'KID', '--issuer', 'ISS', '--wait'],
    ['/usr/bin/xcrun', 'stapler', 'staple', '/d/x.dmg'],
    ['/usr/bin/xcrun', 'stapler', 'validate', '/d/x.dmg']
  ])

  d = doubles()
  await notarizeDmgs(res, { ...d, platform: 'darwin', env: { CSC_LINK: '/x.p12', ...APPLE } })
  assert.deepEqual(d.calls[0].slice(0, 5), ['/usr/bin/xcrun', 'notarytool', 'submit', '/d/x.dmg', '--apple-id'])
  assert.ok(!JSON.stringify(d.calls).includes('secreto-de-prueba'))

  for (const env of [{ CSC_NAME: 'Dev' }, { ...API }, { LAZUNOX_SELF_SIGNED: '1', CSC_NAME: 'L', ...API }]) {
    d = doubles()
    assert.deepEqual(await notarizeDmgs(res, { ...d, platform: 'darwin', env }), [])
    assert.deepEqual(d.calls, [])
    assert.ok(d.logs.length >= 1, 'deja un log claro al omitir')
  }
  d = doubles()
  await notarizeDmgs(res, { ...d, platform: 'win32', env: { CSC_NAME: 'Dev', ...API } })
  await notarizeDmgs({ artifactPaths: ['/d/x.zip'] }, { ...d, platform: 'darwin', env: { CSC_NAME: 'Dev', ...API } })
  assert.deepEqual(d.calls, [])
  await assert.rejects(notarizeDmgs(res, { ...doubles(), platform: 'darwin', env: { CSC_NAME: 'Dev', APPLE_ID: 'a' } }), /incompletas/)
})

// ---- A4: verify:signed ---------------------------------------------------------------------------

const APP = '/d/Lazunox.app'
const DMG = '/d/x.dmg'
function info({ id, auth = [], team = 'not set', flags = '0x2(adhoc)', adhoc = false }) {
  return `Executable=/x\nIdentifier=${id}\nFormat=app bundle\nCodeDirectory v=20400 size=1 flags=${flags} hashes=1+3 location=embedded\n${adhoc ? 'Signature=adhoc\n' : ''}${auth.map((a) => `Authority=${a}`).join('\n')}\nTeamIdentifier=${team}\n`
}
function fakeRun(kind, over = {}) {
  const dev = ['Developer ID Application: X (ABCDE12345)', 'Developer ID Certification Authority', 'Apple Root CA']
  const shapes = {
    adhoc: { auth: [], team: 'not set', flags: '0x2(adhoc)', adhoc: true },
    self: { auth: ['Lazunox Local Signing'], team: 'not set', flags: '0x0(none)' },
    devid: { auth: dev, team: 'ABCDE12345', flags: '0x10000(runtime)' }
  }
  const s = { ...shapes[kind], ...over.shape }
  const ids = { ...IDS, ...over.ids }
  return (cmd, args) => {
    const last = args.at(-1)
    if (cmd === '/usr/bin/codesign' && args[0] === '--verify') return { code: over.verify ?? 0, stdout: '', stderr: 'v' }
    if (cmd === '/usr/bin/codesign' && args[0] === '-dvv') {
      const id = last.endsWith('cu-helper') ? ids.helperId : last.endsWith('lazunox-disclaim') ? ids.disclaimId : ids.appId
      return { code: 0, stdout: '', stderr: info({ id, ...s }) }
    }
    if (cmd === '/usr/sbin/spctl')
      return { code: over.spctl ?? 0, stdout: '', stderr: `${last}: accepted\nsource=${over.source ?? 'Notarized Developer ID'}\n` }
    if (cmd === '/usr/bin/xcrun') return { code: over.stapler ?? 0, stdout: 'The validate action worked!', stderr: '' }
    return { code: 1, stdout: '', stderr: 'inesperado' }
  }
}
const failed = (r) => r.filter((x) => x.ok === false).map((x) => x.name)

test('A4 verify-signed: los tres modos pasan con su firma esperada', () => {
  for (const mode of MODES) {
    const r = verifySigned({ app: APP, dmg: DMG, expect: mode, ids: IDS, run: fakeRun(mode) })
    assert.deepEqual(failed(r), [], mode)
  }
  const devid = verifySigned({ app: APP, dmg: DMG, expect: 'devid', team: 'ABCDE12345', ids: IDS, run: fakeRun('devid') })
  assert.ok(devid.some((x) => /spctl del \.dmg/.test(x.name) && x.ok))
  assert.ok(devid.some((x) => /stapler validate del \.app/.test(x.name) && x.ok))
})

test('A4 verify-signed: detecta cada desviación', () => {
  const f = (mode, over, extra = {}) =>
    failed(verifySigned({ app: APP, dmg: DMG, expect: mode, ids: IDS, run: fakeRun(mode, over), ...extra }))
  assert.ok(f('adhoc', { verify: 1 }).some((n) => /codesign --verify/.test(n)))
  assert.ok(f('devid', { shape: { adhoc: true, auth: [] } }).some((n) => /Developer ID/.test(n)))
  assert.ok(f('adhoc', { shape: { adhoc: false, auth: ['x'] } }).length > 0, 'adhoc esperado pero hay autoridad')
  assert.ok(f('self', { shape: { auth: ['Developer ID Application: X (A)'], team: 'ABCDE12345' } }).length > 0)
  assert.ok(f('devid', { shape: { flags: '0x0(none)' } }).some((n) => /runtime/.test(n)))
  assert.ok(f('devid', {}, { team: 'ZZZZZZZZZZ' }).some((n) => /TeamIdentifier/.test(n)))
  assert.ok(f('devid', { source: 'Unnotarized Developer ID', spctl: 3 }).some((n) => /spctl/.test(n)))
  assert.ok(f('devid', { stapler: 1 }).some((n) => /stapler/.test(n)))
  assert.ok(
    f('adhoc', { ids: { helperId: 'cu-helper-5555abcd' } }).some((n) => /cu-helper/.test(n)),
    'helper con identificador derivado'
  )
  assert.ok(f('devid', { ids: { disclaimId: 'lazunox-disclaim-1' } }).some((n) => /lazunox-disclaim/.test(n)))
  assert.ok(failed(verifySigned({ app: APP, dmg: undefined, expect: 'devid', ids: IDS, run: fakeRun('devid') })).some((n) => /dmg/.test(n)))
  assert.throws(() => verifySigned({ app: APP, expect: 'otro', ids: IDS }), /--expect/)
})

test('A4 parseCodesignInfo y --dry-run', () => {
  const p = parseCodesignInfo(
    info({ id: 'a.b', auth: ['Developer ID Application: X (T)', 'Apple Root CA'], team: 'T', flags: '0x10000(runtime)' })
  )
  assert.deepEqual(p, {
    identifier: 'a.b',
    authorities: ['Developer ID Application: X (T)', 'Apple Root CA'],
    team: 'T',
    runtime: true,
    adhoc: false
  })
  assert.equal(plannedCommands({ app: APP, dmg: DMG, expect: 'adhoc' }).length, 4)
  assert.equal(plannedCommands({ app: APP, dmg: DMG, expect: 'devid' }).length, 8)
  const out = []
  const code = main(['--expect', 'devid', '--app', APP, '--dmg', DMG, '--dry-run'], {
    run: () => assert.fail('no debe ejecutar nada'),
    log: (m) => out.push(m),
    err: () => undefined
  })
  assert.equal(code, 0)
  assert.match(out.join('\n'), /simulación/)
  assert.equal(main([], { err: () => undefined }), 2)
  assert.equal(main(['--expect', 'adhoc', '--app', '/no/existe.app'], { err: () => undefined }), 1)
})
