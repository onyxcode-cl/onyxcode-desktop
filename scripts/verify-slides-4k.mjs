#!/usr/bin/env node
/** Ejecutar fuera del entorno restringido: usa el harness E2E y la app completa, nunca un bundle parcial de main. */
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, rmdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { transform } from 'esbuild'

const args = process.argv.slice(2)
const value = (flag) => {
  const i = args.indexOf(flag)
  return i < 0 ? undefined : args[i + 1]
}
const source = value('--html')
const destination = value('--out')
if (!destination && !args.includes('--check-only'))
  throw new Error('Uso: node scripts/verify-slides-4k.mjs --out carpeta [--html deck-autonomo.html --expected-slides 5]')
const expected = value('--expected-slides')
if (expected && (!Number.isInteger(Number(expected)) || Number(expected) < 1 || Number(expected) > 40))
  throw new Error('--expected-slides debe estar entre 1 y 40')
if (args.includes('--bundle-only'))
  throw new Error('Ya no se crea un bundle parcial. Use node --check scripts/verify-slides-4k.mjs para comprobar sintaxis sin Electron.')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (args.includes('--check-only')) {
  await transform(await readFile(join(root, 'e2e/specs/slides-4k.e2e.ts'), 'utf8'), { loader: 'ts' })
  console.log('Spec E2E compilable; no se inició Electron ni se modificó out/.')
  process.exit(0)
}
const output = resolve(destination)
await mkdir(output, { recursive: true })
const env = {
  ...process.env,
  LAZUNOX_SLIDES_CHECK_OUT: output,
  ...(source ? { LAZUNOX_SLIDES_CHECK_HTML: resolve(source) } : {}),
  ...(expected ? { LAZUNOX_SLIDES_CHECK_COUNT: expected } : {})
}
delete env.ELECTRON_RUN_AS_NODE
const lock = process.env.LAZUNOX_BUILD_LOCK || join(tmpdir(), 'lazunox-build-e2e.lock')
const deadline = Date.now() + 60_000
for (;;) {
  try {
    await mkdir(lock)
    break
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    if (Date.now() >= deadline) throw new Error('Otro build/E2E conserva el cerrojo: ' + lock)
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}
try {
  // El harness mantiene mock-keychain, userData temporal, ciclo de vida y limpieza de hijos de la app.
  await new Promise((ok, fail) => {
    const child = spawn(
      process.execPath,
      [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '-c', 'vitest.e2e.config.ts', 'e2e/specs/slides-4k.e2e.ts'],
      { cwd: root, stdio: 'inherit', env, detached: process.platform !== 'win32' }
    )
    let expired = false
    let forceTimer
    let spawnError
    let descendants = []
    // Snapshot previo al TERM: conserva también los hijos que se desvinculan del grupo
    // (p.ej. el motor falso), aunque su padre salga antes de la escalada.
    const rememberTree = () => {
      if (process.platform === 'win32' || !child.pid) return
      try {
        const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', timeout: 5000 })
          .trim()
          .split('\n')
          .map((row) => row.trim().split(/\s+/).map(Number))
        const known = new Set([child.pid, ...descendants])
        for (let changed = true; changed;) {
          changed = false
          for (const [pid, parent] of rows)
            if (known.has(parent) && !known.has(pid)) {
              known.add(pid)
              changed = true
            }
        }
        descendants = [...known].filter((pid) => pid !== child.pid)
      } catch {
        /* El grupo propio sigue siendo una segunda vía de limpieza. */
      }
    }
    const stopTree = (force) => {
      if (!child.pid) return
      if (process.platform === 'win32') {
        try {
          execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])], {
            stdio: 'ignore',
            timeout: 15_000,
            windowsHide: true
          })
        } catch {
          /* El harness puede haber terminado ya el árbol. */
        }
      } else {
        const signal = force ? 'SIGKILL' : 'SIGTERM'
        rememberTree()
        for (const pid of [...descendants].reverse()) {
          try {
            process.kill(pid, signal)
          } catch {
            /* ya terminado */
          }
        }
        try {
          process.kill(-child.pid, signal)
        } catch {
          /* grupo ya terminado */
        }
        try {
          child.kill(signal)
        } catch {
          /* padre ya terminado */
        }
      }
    }
    const timer = setTimeout(() => {
      expired = true
      stopTree(false)
      forceTimer = setTimeout(() => stopTree(true), 10_000)
    }, 480_000)
    child.once('error', (error) => {
      spawnError = error
    })
    // close, no exit: los streams y el proceso ya acabaron. El cerrojo no se libera al
    // vencer el reloj; se conserva durante TERM, escalada y limpieza de descendientes.
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      clearTimeout(forceTimer)
      if (expired) {
        stopTree(true)
        fail(new Error('La comprobación superó 8 minutos; se terminó su árbol de procesos'))
        return
      }
      if (spawnError) {
        fail(spawnError)
        return
      }
      code === 0 ? ok() : fail(new Error(`La comprobación terminó: código ${code}, señal ${signal || 'ninguna'}`))
    })
  })
  const result = JSON.parse(await readFile(join(output, 'verification.json'), 'utf8'))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await rmdir(lock)
}
