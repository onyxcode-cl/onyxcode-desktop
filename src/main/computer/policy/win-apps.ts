/**
 * Listas de apps de Windows para las concesiones por app (plan C §3; C4). Puro: sin Electron ni disco.
 *  - BLOQUEADAS (nunca concedibles, nunca controlables): espejo EXACTO de `resources/computer-use/win/src/blocklist.rs`
 *    (una prueba compara las dos listas leyendo el archivo de Rust).
 *  - EXENTAS (no piden acceso): las mismas que el MCP (`mcp-platform-win32.ts`, `DEFAULT_EXEMPT_EXES`). `explorer.exe` NO está:
 *    sus carpetas piden concesión (decisión del dueño del plan).
 *  - SOLO VER por defecto: navegadores y banca/cripto (por nombre), como en macOS.
 * Las claves son las de `app-key.ts` (`exe:<ruta>|pub:<editor>` o `aumid:<id>`, en minúsculas).
 */
import { exeBaseName, parseAppKey } from './app-key'

export const WIN_BLOCKED_EXES: readonly string[] = [
  'consent.exe',
  'credentialuibroker.exe',
  'logonui.exe',
  'lockapp.exe',
  'winlogon.exe',
  'securityhealthui.exe',
  'sechealthui.exe',
  'mmc.exe',
  'regedit.exe',
  'taskmgr.exe',
  '1password.exe',
  'bitwarden.exe',
  'keepass.exe',
  'keepassxc.exe',
  'dashlane.exe',
  'lastpass.exe',
  'enpass.exe',
  'nordpass.exe'
]

export const WIN_BLOCKED_AUMID_PREFIXES: readonly string[] = [
  'microsoft.sechealthui',
  'microsoft.windows.securityhealth',
  'microsoft.windows.credentialui'
]

export const WIN_EXEMPT_EXES: readonly string[] = [
  'lazunox.exe',
  'electron.exe',
  'dwm.exe',
  'shellexperiencehost.exe',
  'startmenuexperiencehost.exe',
  'searchhost.exe',
  'textinputhost.exe'
]

const WIN_BROWSER_EXES: readonly string[] = [
  'chrome.exe',
  'msedge.exe',
  'firefox.exe',
  'brave.exe',
  'opera.exe',
  'vivaldi.exe',
  'duckduckgo.exe',
  'arc.exe'
]
const WIN_BROWSER_AUMID_PREFIXES: readonly string[] = ['microsoft.microsoftedge', 'mozilla.firefox', 'operasoftware.opera']

/** Misma heurística de nombre que en macOS (banca, trading, cripto). */
const FINANCE_RE = /banc|bank|trading|broker|invest|crypto|coinbase|binance|kraken|wallet|exchange/i

/** ¿Clave bloqueada? Una clave que no es válida cuenta como bloqueada (falla cerrado). */
export function isWinBlocked(key: string): boolean {
  const p = parseAppKey(key)
  if (!p) return true
  if (p.kind === 'aumid') return WIN_BLOCKED_AUMID_PREFIXES.some((x) => p.id.startsWith(x))
  return WIN_BLOCKED_EXES.includes(exeBaseName(key) ?? '')
}

export function isWinExempt(key: string): boolean {
  const exe = exeBaseName(key)
  return !!exe && WIN_EXEMPT_EXES.includes(exe)
}

/** Nivel por defecto autoasignado: navegadores y banca/cripto → solo ver. El resto, null (hay que preguntar). */
export function winDefaultTier(key: string, name: string): 'view' | null {
  const p = parseAppKey(key)
  if (!p) return null
  const base = p.kind === 'exe' ? (exeBaseName(key) ?? '') : ''
  if (p.kind === 'aumid' ? WIN_BROWSER_AUMID_PREFIXES.some((x) => p.id.startsWith(x)) : WIN_BROWSER_EXES.includes(base)) return 'view'
  if (FINANCE_RE.test(name) || FINANCE_RE.test(base.replace(/\.exe$/, ''))) return 'view'
  return null
}
