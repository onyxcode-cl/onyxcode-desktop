/**
 * Ayudas SOLO de pruebas: crea un «binario» `cloudflared` de mentira en `<dir>/bin/cloudflared-test/cloudflared` (un script que
 * ejecuta `e2e/fake-cloudflared/fake-cloudflared.mjs` con el modo fijado). Nada de red real ni del cloudflared de Cloudflare.
 */
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const FAKE_CF = resolve(__dirname, '../../../../e2e/fake-cloudflared/fake-cloudflared.mjs')

/** Devuelve la ruta del binario falso para `mode` (ver la cabecera del falso). `ip` simula la IP del visitante. */
export function makeFakeBinary(dir: string, mode = 'ok', opts: { ip?: string; name?: string } = {}): string {
  const folder = join(dir, 'bin', opts.name ?? 'cloudflared-test')
  mkdirSync(folder, { recursive: true })
  const bin = join(folder, 'cloudflared')
  const esc = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
  writeFileSync(
    bin,
    `#!/bin/sh\nexport FAKE_CF_MODE=${esc(mode)}${opts.ip ? `\nexport FAKE_CF_IP=${esc(opts.ip)}` : ''}\nexec ${esc(process.execPath)} ${esc(FAKE_CF)} "$@"\n`
  )
  chmodSync(bin, 0o755)
  return bin
}

/** Lee el ÚLTIMO valor `CLAVE=valor` de las líneas del falso (el de la ejecución más reciente). */
export function fakeValue(lines: readonly string[], key: string): string | null {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].startsWith(`${key}=`)) return lines[i].slice(key.length + 1)
  return null
}
