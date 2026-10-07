/**
 * ¿Lazunox corre ELEVADO (como administrador) en Windows? Tareas se NIEGA a arrancar así (decisión del dueño, 2026-10-07; la
 * razón es el fallo abierto de WSL con sesión elevada, microsoft/WSL#12443, que no se ha verificado), igual que Control del
 * PC (que lo sabe por el helper: `permissions.elevated`). Aquí no hay helper garantizado, así que se lee el nivel de integridad
 * del token propio con `whoami.exe /groups` (etiqueta obligatoria `S-1-16-…`): 12288 = Alta (administrador elevado), 16384 =
 * Sistema. 8192 = Media y 4096 = Baja se consideran NO elevado. Cualquier otra cosa (falla, sin etiqueta, salida rara) = `null`
 * = «no se sabe», y la puerta lo trata como elevado (falla cerrado). Parte pura + ejecutor inyectable; nada probado en Windows real.
 */
import { execFile } from 'node:child_process'
import { join } from 'node:path'

/** Nivel de integridad que dice la salida CSV de `whoami /groups /fo csv /nh`; `null` si no hay etiqueta reconocible. */
export function parseWhoamiGroups(out: string): boolean | null {
  const levels = [...out.matchAll(/S-1-16-(\d{1,6})/g)].map((m) => Number(m[1]))
  if (levels.length !== 1) return null
  const level = levels[0]!
  if (level >= 12288) return true
  if (level === 4096 || level === 8192) return false
  return null
}

export type WhoamiRunner = () => Promise<string>

function realRunner(): Promise<string> {
  return new Promise((resolve, reject) => {
    const exe = join(process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'whoami.exe')
    execFile(
      exe,
      ['/groups', '/fo', 'csv', '/nh'],
      { windowsHide: true, timeout: 5_000, maxBuffer: 1024 * 1024, shell: false },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    )
  })
}

/** `true` elevado, `false` normal, `null` no se sabe (se trata como elevado). Nunca lanza. */
export async function detectElevated(run: WhoamiRunner = realRunner): Promise<boolean | null> {
  try {
    return parseWhoamiGroups(await run())
  } catch {
    return null
  }
}
