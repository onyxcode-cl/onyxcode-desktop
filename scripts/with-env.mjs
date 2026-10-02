#!/usr/bin/env node
// Ejecuta un comando con variables de entorno añadidas, igual en macOS/Linux/Windows (sin la sintaxis
// POSIX `VAR=1 cmd`). Sin dependencias.
//   node scripts/with-env.mjs ONYXCODE_FS_IT=1 E2E_MODE=prod -- vitest run -c x.ts
import { spawn } from 'node:child_process'

const argv = process.argv.slice(2)
const sep = argv.indexOf('--')
if (sep < 0 || sep === argv.length - 1) {
  console.error('uso: with-env.mjs VAR=valor [VAR=valor…] -- comando [args…]')
  process.exit(2)
}
const env = { ...process.env }
for (const pair of argv.slice(0, sep)) {
  const i = pair.indexOf('=')
  if (i <= 0) {
    console.error(`with-env: asignación inválida «${pair}» (se espera VAR=valor)`)
    process.exit(2)
  }
  env[pair.slice(0, i)] = pair.slice(i + 1)
}
const [cmd, ...args] = argv.slice(sep + 1)

// En Windows los binarios de node_modules/.bin son .cmd: requieren shell. Se compone la línea con comillas.
const win = process.platform === 'win32'
const quote = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`)
const child = win
  ? spawn([cmd, ...args].map(quote).join(' '), { env, stdio: 'inherit', shell: true, windowsHide: true })
  : spawn(cmd, args, { env, stdio: 'inherit' })
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
child.on('error', (err) => {
  console.error(`with-env: no se pudo ejecutar «${cmd}»: ${err.message}`)
  process.exit(127)
})
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
