#!/usr/bin/env node
// Verifica la distribución YA EMPAQUETADA (no empaqueta nada ni usa la red): firma, identificadores, Gatekeeper y ticket grapado.
//
//   node scripts/verify-signed.mjs --expect adhoc|self|devid [--app dist/mac-arm64/Lazunox.app] [--dmg dist/x.dmg] [--team ABCDE12345] [--dry-run]
//
// Modos (lo que se espera de la firma):
//   adhoc : `Signature=adhoc`, sin autoridad ni equipo (build local de `npm run package`).
//   self  : certificado autofirmado (LAZUNOX_SELF_SIGNED=1): con autoridad que NO es Developer ID y sin equipo.
//   devid : Developer ID Application + TeamIdentifier + hardened runtime; además `spctl` del .app y del .dmg
//           («accepted, source=Notarized Developer ID») y `stapler validate` de ambos.
// En los tres: `codesign --verify --deep --strict`, Identifier del .app = APP_ID y de los helpers = HELPER_ID / DISCLAIM_ID (brand.ts).
// `--dry-run` imprime los comandos que ejecutaría y no ejecuta ninguno.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const MODES = ['adhoc', 'self', 'devid']

export function idsFromBrand(root = defaultRoot) {
  const src = readFileSync(join(root, 'src/shared/brand.ts'), 'utf8')
  const alias = /export const AUTHOR_ALIAS = '([^']*)'/.exec(src)?.[1]
  if (!alias) throw new Error('No se encontró AUTHOR_ALIAS en src/shared/brand.ts')
  const appId = `cl.${alias}.lazunox`
  return {
    appId,
    helperId: `cl.${alias}.lazunox.cu-helper`,
    keysId: `cl.${alias}.lazunox.cu-keys`,
    disclaimId: `${appId}.disclaim`,
    keyboxId: `${appId}.keybox`
  }
}

const defaultRun = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** Lee la salida de `codesign -dvv`: Identifier, Authority (lista), TeamIdentifier, flags y si es ad-hoc. */
export function parseCodesignInfo(text) {
  const one = (re) => re.exec(text)?.[1]?.trim()
  const flags = /^CodeDirectory .*flags=0x[0-9a-f]+\(([^)]*)\)/m.exec(text)?.[1] ?? ''
  const team = one(/^TeamIdentifier=(.*)$/m)
  return {
    identifier: one(/^Identifier=(.*)$/m),
    authorities: [...text.matchAll(/^Authority=(.*)$/gm)].map((m) => m[1].trim()),
    team: team && team !== 'not set' ? team : undefined,
    runtime: flags.split(',').includes('runtime'),
    adhoc: /^Signature=adhoc$/m.test(text)
  }
}

/** Ejecuta las comprobaciones y devuelve [{name, ok, detail}] (ok === null: omitida). */
export function verifySigned({ app, dmg, expect, team, ids, run = defaultRun }) {
  if (!MODES.includes(expect)) throw new Error(`--expect debe ser uno de ${MODES.join(', ')}`)
  const out = []
  const add = (name, ok, detail = '') => out.push({ name, ok, detail })
  const text = (r) => `${r.stderr}\n${r.stdout}`

  const v = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
  add('codesign --verify --deep --strict', v.code === 0, v.code === 0 ? '' : text(v).trim())

  const info = parseCodesignInfo(text(run('/usr/bin/codesign', ['-dvv', app])))
  add(`Identifier del .app = ${ids.appId}`, info.identifier === ids.appId, `es «${info.identifier}»`)
  const devAuthority = info.authorities[0]?.startsWith('Developer ID Application:') ?? false
  if (expect === 'adhoc') {
    add('firma ad-hoc', info.adhoc && info.authorities.length === 0, info.adhoc ? '' : 'no es ad-hoc')
  } else if (expect === 'self') {
    add(
      'certificado autofirmado (autoridad que no es Developer ID, sin equipo)',
      !info.adhoc && info.authorities.length > 0 && !devAuthority && !info.team,
      `autoridad: ${info.authorities[0] ?? 'ninguna'}, equipo: ${info.team ?? 'ninguno'}`
    )
  } else {
    add('Authority = Developer ID Application', devAuthority, `autoridad: ${info.authorities[0] ?? 'ninguna'}`)
    add(
      'TeamIdentifier presente' + (team ? ` = ${team}` : ''),
      Boolean(info.team) && (!team || info.team === team),
      `equipo: ${info.team ?? 'ninguno'}`
    )
    add('hardened runtime (flags: runtime)', info.runtime, info.runtime ? '' : 'falta runtime')
  }

  const keysRel = 'Contents/Resources/computer-use/bin/cu-keys'
  const keyboxRel = 'Contents/Resources/keybox/lazunox-keybox'
  for (const [rel, id] of [
    ['Contents/Resources/computer-use/bin/cu-helper', ids.helperId],
    // cu-keys solo se comprueba si viaja en el paquete (se compila con swiftc: puede faltar en un build sin Xcode).
    ...(existsSync(join(app, keysRel)) ? [[keysRel, ids.keysId ?? ids.helperId.replace(/cu-helper$/, 'cu-keys')]] : []),
    ['Contents/Resources/launcher/lazunox-disclaim', ids.disclaimId],
    // El auxiliar del Llavero (resources/keybox) viaja en el paquete; su identificador fijo es su identidad ante el Llavero.
    ...(existsSync(join(app, keyboxRel)) ? [[keyboxRel, ids.keyboxId ?? `${ids.appId}.keybox`]] : [])
  ]) {
    const h = parseCodesignInfo(text(run('/usr/bin/codesign', ['-dvv', join(app, rel)])))
    add(`Identifier de ${rel.split('/').pop()} = ${id}`, h.identifier === id, `es «${h.identifier}»`)
    if (expect === 'devid') add(`${rel.split('/').pop()} con hardened runtime`, h.runtime, h.runtime ? '' : 'falta runtime')
  }

  if (expect === 'devid') {
    const sp = run('/usr/sbin/spctl', ['-a', '-vvv', '-t', 'exec', app])
    add(
      'spctl del .app: accepted, Notarized Developer ID',
      sp.code === 0 && /source=Notarized Developer ID/.test(text(sp)),
      text(sp).trim()
    )
    const st = run('/usr/bin/xcrun', ['stapler', 'validate', app])
    add('stapler validate del .app', st.code === 0, text(st).trim())
    if (dmg) {
      const sd = run('/usr/sbin/spctl', ['-a', '-vvv', '-t', 'open', '--context', 'context:primary-signature', dmg])
      add(
        'spctl del .dmg: accepted, Notarized Developer ID',
        sd.code === 0 && /source=Notarized Developer ID/.test(text(sd)),
        text(sd).trim()
      )
      const sv = run('/usr/bin/xcrun', ['stapler', 'validate', dmg])
      add('stapler validate del .dmg', sv.code === 0, text(sv).trim())
    } else add('spctl y stapler del .dmg', false, 'no se indicó --dmg ni hay un .dmg en dist/')
  } else {
    add('spctl y stapler', null, `omitidos con --expect ${expect} (solo aplican a Developer ID notarizado)`)
  }
  return out
}

function arg(argv, name) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

/** Imprime los comandos sin ejecutar nada (--dry-run). */
export function plannedCommands({ app, dmg, expect }) {
  const cmds = [
    ['codesign', '--verify', '--deep', '--strict', '--verbose=2', app],
    ['codesign', '-dvv', app],
    ['codesign', '-dvv', join(app, 'Contents/Resources/computer-use/bin/cu-helper')],
    ['codesign', '-dvv', join(app, 'Contents/Resources/launcher/lazunox-disclaim')]
  ]
  if (expect === 'devid') {
    cmds.push(['spctl', '-a', '-vvv', '-t', 'exec', app], ['xcrun', 'stapler', 'validate', app])
    if (dmg)
      cmds.push(['spctl', '-a', '-vvv', '-t', 'open', '--context', 'context:primary-signature', dmg], ['xcrun', 'stapler', 'validate', dmg])
  }
  return cmds.map((c) => c.join(' '))
}

export function main(argv = process.argv.slice(2), { run = defaultRun, root = defaultRoot, log = console.log, err = console.error } = {}) {
  const expect = arg(argv, '--expect')
  if (!MODES.includes(expect)) {
    err('Uso: node scripts/verify-signed.mjs --expect adhoc|self|devid [--app ruta.app] [--dmg ruta.dmg] [--team ID] [--dry-run]')
    return 2
  }
  const app = resolve(arg(argv, '--app') ?? join(root, 'dist/mac-arm64/Lazunox.app'))
  let dmg = arg(argv, '--dmg')
  if (!dmg && existsSync(join(root, 'dist'))) {
    const f = readdirSync(join(root, 'dist')).filter((n) => n.endsWith('.dmg'))
    if (f.length === 1) dmg = join(root, 'dist', f[0])
  }
  if (dmg) dmg = resolve(dmg)
  if (argv.includes('--dry-run')) {
    log(`verify-signed (simulación, no ejecuta nada) — esperado: ${expect}`)
    for (const c of plannedCommands({ app, dmg, expect })) log(`  ${c}`)
    return 0
  }
  if (!existsSync(app)) {
    err(`verify:signed FALLÓ: no existe ${app} (ejecuta antes \`npm run package\`).`)
    return 1
  }
  const results = verifySigned({ app, dmg, expect, team: arg(argv, '--team') ?? process.env.APPLE_TEAM_ID, ids: idsFromBrand(root), run })
  for (const r of results)
    log(
      `  ${r.ok === null ? 'omitida' : r.ok ? 'OK     ' : 'FALLA  '} ${r.name}${r.ok === false && r.detail ? `\n           ${r.detail.split('\n').join('\n           ')}` : ''}`
    )
  const failed = results.filter((r) => r.ok === false)
  if (failed.length) {
    err(`verify:signed FALLÓ (${failed.length} de ${results.length})`)
    return 1
  }
  log(`verify:signed OK (--expect ${expect})`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main())
