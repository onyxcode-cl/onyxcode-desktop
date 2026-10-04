#!/usr/bin/env node
// Compila la PWA del control remoto con Vite en dos pasos: el arranque ligero (`pwa/vite.config.*` → `pwa/dist`) y, después, la
// interfaz completa (`pwa/vite.full.config.*` → `pwa/dist/app`, la que el arranque carga tras autenticar). Si todavía no existe
// la carpeta `pwa/` o su configuración de Vite, no hace nada (el resto del build sigue igual): el servidor local muestra un
// aviso en su lugar. Si falta solo la configuración completa, la PWA ligera sigue funcionando sola.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const find = (base) => ['ts', 'mts', 'js', 'mjs'].map((e) => join(root, 'pwa', `${base}.${e}`)).find(existsSync)
const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js')

const light = find('vite.config')
if (!light) {
  console.log('[build:pwa] no hay pwa/vite.config.*: se omite (la app incluirá un aviso en lugar de la PWA).')
  process.exit(0)
}
const run = (config) => spawnSync(process.execPath, [vite, 'build', '--config', config], { cwd: root, stdio: 'inherit' }).status ?? 1

let code = run(light)
if (code === 0) {
  const full = find('vite.full.config')
  if (full) code = run(full)
  else console.log('[build:pwa] no hay pwa/vite.full.config.*: solo se incluye el arranque ligero.')
}

// Deja un `.gz` junto a cada texto (js, css, html, json, svg, map): el servidor local lo sirve con `Content-Encoding: gzip` en vez de
// comprimir en cada petición. Se reporta el peso gzip del arranque (ligero + interfaz completa, sin los trozos perezosos).
if (code === 0) {
  const dist = join(root, 'pwa', 'dist')
  const TEXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.map', '.txt', '.webmanifest'])
  const files = []
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (TEXT.has(extname(name).toLowerCase())) files.push(p)
    }
  }
  walk(dist)
  const sizes = new Map()
  for (const f of files) {
    const gz = gzipSync(readFileSync(f), { level: 9 })
    writeFileSync(`${f}.gz`, gz)
    sizes.set(f, gz.length)
  }
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`
  const startup = [join(dist, 'index.html')]
  for (const f of files) if (/[\\/]assets[\\/](index|style)-/.test(f) && !f.includes(`${join(dist, 'app')}`)) startup.push(f)
  const entry = join(dist, 'app', 'entry.json')
  if (existsSync(entry)) {
    const e = JSON.parse(readFileSync(entry, 'utf8'))
    // Arranque de la interfaz completa: JS de entrada (+ lo que importa de forma estática) y su CSS.
    startup.push(join(dist, 'app', e.js), ...e.css.map((c) => join(dist, 'app', c)))
    // Dependencias estáticas (`from "./x.js"`) y el `import("./boot-…")` de `main` (se baja al abrir). Los perezosos de verdad
    // (Tareas, Rutinas, Ajustes, inglés) no cuentan.
    const deps = (js) => {
      const text = readFileSync(join(dist, 'app', js), 'utf8')
      const stat = [...text.matchAll(/(?:from|import)\s*["']\.\/([A-Za-z0-9._-]+\.js)["']/g)].map((m) => m[1])
      const boot = [...text.matchAll(/import\(\s*["']\.\/(boot-[A-Za-z0-9._-]+\.js)["']\s*\)/g)].map((m) => m[1])
      return [...stat, ...boot].map((n) => `assets/${n}`)
    }
    const seen = new Set([e.js])
    const queue = deps(e.js)
    for (const j of queue) {
      if (seen.has(j)) continue
      seen.add(j)
      startup.push(join(dist, 'app', j))
      queue.push(...deps(j))
    }
  }
  // El CSS de la interfaz (`boot-*.css`) lo enlaza el trozo `boot` al cargar: también es de arranque.
  for (const f of files) if (/[\\/]app[\\/]assets[\\/]boot-[^\\/]*\.css$/.test(f)) startup.push(f)
  const uniq = [...new Set(startup)].filter((f) => sizes.has(f))
  const total = uniq.reduce((n, f) => n + sizes.get(f), 0)
  const lazy = [...sizes].filter(([f]) => !uniq.includes(f) && !f.endsWith('.map')).reduce((n, [, v]) => n + v, 0)
  console.log(`[build:pwa] peso gzip del arranque (HTML + JS + CSS cargados al abrir): ${kb(total)}`)
  console.log(`[build:pwa] trozos perezosos (Tareas, Rutinas, Ajustes, inglés…; solo al usarlos): ${kb(lazy)}`)
}
process.exit(code)
