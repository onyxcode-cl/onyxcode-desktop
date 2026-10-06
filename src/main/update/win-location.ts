import { randomBytes } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import { join, win32 } from 'node:path'
import { validateInstallLocationWin, type LocationCheckWin } from '@shared/update-install'
import type { RunFn } from './installer'

const UNINSTALL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'

export interface UninstallEntry {
  displayName: string
  installLocation: string
}

/** Interpreta la salida de `reg.exe query <clave> /s`: bloques «HKEY_…\subclave» con líneas «    Nombre    REG_SZ    valor». */
export function parseUninstallEntries(stdout: string): UninstallEntry[] {
  const out: UninstallEntry[] = []
  let cur: { displayName?: string; installLocation?: string } | null = null
  const flush = (): void => {
    if (cur?.displayName !== undefined && cur.installLocation !== undefined)
      out.push({ displayName: cur.displayName, installLocation: cur.installLocation })
  }
  for (const raw of stdout.split(/\r?\n/)) {
    if (/^HKEY_/i.test(raw)) {
      flush()
      cur = {}
      continue
    }
    const m = /^\s+(DisplayName|InstallLocation)\s+REG_(?:EXPAND_)?SZ\s+(.*)$/.exec(raw)
    if (m && cur) {
      const v = m[2].trim()
      if (m[1] === 'DisplayName') cur.displayName = v
      else cur.installLocation = v.replace(/^"(.*)"$/, '$1')
    }
  }
  flush()
  return out
}

const norm = (p: string): string =>
  p
    .replace(/[\\/]+/g, '\\')
    .replace(/\\+$/, '')
    .toLowerCase()

/** La clave de desinstalación «Lazunox» que registró el instalador NSIS por usuario; prefiere la que apunta a `installDir`. */
export async function readUninstallKeyWin(run: RunFn, systemRoot: string, installDir: string): Promise<{ installLocation: string } | null> {
  const r = await run(win32.join(systemRoot, 'System32', 'reg.exe'), ['query', UNINSTALL_KEY, '/s'])
  if (r.code !== 0) return null
  const mine = parseUninstallEntries(r.stdout).filter((e) => e.displayName === 'Lazunox')
  if (mine.length === 0) return null
  return mine.find((e) => norm(e.installLocation) === norm(installDir)) ?? mine[0]
}

/** ¿Se puede crear y borrar un fichero dentro de la carpeta? (`access(W_OK)` no basta en NTFS: ignora las ACL.) */
export async function probeWritable(dir: string): Promise<boolean> {
  const f = join(dir, `.lazunox-w-${randomBytes(4).toString('hex')}`)
  try {
    await writeFile(f, '', { flag: 'wx' })
    await unlink(f)
    return true
  } catch {
    return false
  }
}

export interface LocationWinDeps {
  run: RunFn
  systemRoot: string
  /** Carpeta REAL de la app en ejecución. */
  installDir: string
  env: Record<string, string | undefined>
  tempDir: string
  probe?: (dir: string) => Promise<boolean>
}

/** Equivale a `evaluateLocation` del Mac: solo la carpeta por usuario registrada por el instalador NSIS, con permiso de escritura. */
export async function evaluateLocationWin(d: LocationWinDeps): Promise<LocationCheckWin> {
  const probe = d.probe ?? probeWritable
  const key = await readUninstallKeyWin(d.run, d.systemRoot, d.installDir).catch(() => null)
  const parent = win32.dirname(d.installDir)
  const writable = new Map<string, boolean>([
    [norm(d.installDir), await probe(d.installDir)],
    [norm(parent), await probe(parent)]
  ])
  return validateInstallLocationWin({
    installDir: d.installDir,
    programFilesDirs: [d.env.ProgramFiles, d.env['ProgramFiles(x86)'], d.env.ProgramW6432].filter((x): x is string => !!x),
    tempDir: d.tempDir,
    readUninstallKey: () => key,
    isWritable: (dir) => writable.get(norm(dir)) ?? false
  })
}
