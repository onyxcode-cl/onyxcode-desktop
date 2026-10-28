/**
 * Modo unificado en Windows: carpetas de chat `%USERPROFILE%\Lazunox\Chats\<AAAAMMDD-xxxxxx>`. Lógica pura con el disco inyectado
 * (`WinChatFs`), para probarla en macOS con un disco doble; `manager.ts` la usa solo con la bandera del modo unificado encendida.
 *
 * Garantías: (1) ni el perfil, ni `Lazunox`, ni `Chats`, ni la carpeta del chat son enlace simbólico ni junction (`lstat`, que en
 * Windows marca ambos como enlace, en CADA ancestro desde el perfil); (2) el realpath de la carpeta queda exactamente en
 * `realpath(perfil)\Lazunox\Chats\<id>`, comparando sin distinguir mayúsculas y con separadores normalizados; (3) solo se borra con
 * `rmdir` (nunca recursivo) y una carpeta vacía.
 *
 * LÍMITE RESIDUAL: en Windows no hay uid ni modo 0700. Se CONFÍA en la ACL heredada del perfil del usuario (por defecto solo él, SYSTEM
 * y los administradores) y NO se comprueba. Otro proceso del mismo usuario puede leer estas carpetas igual que el resto del perfil.
 */
import { randomBytes } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, rmdirSync } from 'node:fs'
import { win32 } from 'node:path'
import type { WinHost } from './win-context'

/** Disco que usan las carpetas de chat de Windows. Los errores "no existe" se señalan con `null` (lstat) o lanzando (el resto). */
export interface WinChatFs {
  /** `lstat` sin seguir enlaces; `null` si no existe. Un junction o symlink devuelve `isSymbolicLink() === true`. */
  lstat(p: string): { isSymbolicLink(): boolean; isDirectory(): boolean; birthtimeMs: number; mtimeMs: number } | null
  /** `realpath` nativo; lanza si no existe o la unidad no es fija. */
  realpath(p: string): string
  /** Crea UN nivel (no recursivo). Lanza con `code: 'EEXIST'` si ya existe. */
  mkdir(p: string): void
  /** Borra una carpeta vacía (nunca recursivo). */
  rmdir(p: string): void
  /** Nombres de las entradas. */
  readdir(p: string): string[]
}

/** Clave de comparación: minúsculas, `/` → `\`, sin separador final. NTFS no distingue mayúsculas. */
export function winKey(p: string): string {
  const k = p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  return k
}

export const CHAT_ID_RE = /^(\d{4})(\d{2})(\d{2})-[0-9a-f]{6}$/

export function winChatsDir(home: string): string {
  return win32.join(home, 'Lazunox', 'Chats')
}

/** Error genérico sin rutas completas; el llamador lo convierte en `merr.chat.folderUnsafe`. */
export class WinChatUnsafe extends Error {}

/** Cada ancestro existente desde `home` hasta `target` debe ser una carpeta normal (ni symlink ni junction). */
export function assertWinChainSafe(fs: WinChatFs, home: string, target: string): void {
  const homeK = winKey(home)
  const targetK = winKey(target)
  if (targetK !== homeK && !targetK.startsWith(homeK + '\\')) throw new WinChatUnsafe('fuera del perfil')
  const rest = win32.relative(home, target)
  const parts = rest === '' ? [] : rest.split('\\')
  let cur = home
  const chain = [cur]
  for (const p of parts) {
    cur = win32.join(cur, p)
    chain.push(cur)
  }
  for (const dir of chain) {
    const st = fs.lstat(dir)
    if (!st) {
      if (dir === home) throw new WinChatUnsafe('perfil')
      return // lo que falta se crea después y se vuelve a comprobar
    }
    if (st.isSymbolicLink() || !st.isDirectory()) throw new WinChatUnsafe('enlace o no es carpeta')
  }
}

/** ¿`real` es hijo DIRECTO de `chats`? (sin distinguir mayúsculas) */
export function isDirectChild(real: string, chats: string): boolean {
  const r = winKey(real)
  const c = winKey(chats)
  return r.startsWith(c + '\\') && winKey(win32.dirname(real)) === c && win32.basename(real) !== ''
}

/**
 * `Chats` y sus ancestros (`...\Lazunox`, el perfil, la raíz) no sirven de carpeta de trabajo ni adicional: reabrirían todos los chats.
 * `true` si `folder` es `Chats` o contiene a `Chats`. Compara realpath si existe y la ruta léxica si no.
 */
export function winContainsChats(fs: Pick<WinChatFs, 'realpath'>, home: string, folder: string): boolean {
  let chats: string
  try {
    chats = winChatsDir(fs.realpath(home))
  } catch {
    chats = winChatsDir(home)
  }
  const lexical = winChatsDir(home)
  let real: string
  try {
    real = fs.realpath(folder)
  } catch {
    real = folder
  }
  const covers = (r: string, c: string): boolean => winKey(r) === winKey(c) || winKey(c).startsWith(winKey(r) + '\\')
  return covers(real, chats) || covers(folder, lexical) || covers(real, lexical)
}

/** ¿Es `folder` una carpeta de chat válida AHORA? (registro aparte: lo comprueba el llamador). */
export function isValidWinChatFolder(fs: WinChatFs, home: string, folder: string): boolean {
  try {
    const chats = winChatsDir(fs.realpath(home))
    assertWinChainSafe(fs, home, folder)
    const st = fs.lstat(folder)
    if (!st || st.isSymbolicLink() || !st.isDirectory()) return false
    const real = fs.realpath(folder)
    return winKey(real) === winKey(folder) && isDirectChild(real, chats) && winKey(fs.realpath(chats)) === winKey(chats)
  } catch {
    return false
  }
}

/**
 * Crea `Lazunox\Chats\<id>` y devuelve su ruta real. `policyCheck(chats)` se llama ANTES de tocar el disco (devuelve un motivo o null).
 * Lanza `WinChatUnsafe` ante cualquier enlace, ruta fuera de `Chats` o carrera.
 */
export function createWinChatDir(
  fs: WinChatFs,
  home: string,
  policyCheck: (chats: string) => string | null,
  now: Date = new Date(),
  rand: () => string = () => randomBytes(4).toString('hex').slice(0, 6)
): string {
  const base = win32.join(home, 'Lazunox')
  const chats = winChatsDir(home)
  assertWinChainSafe(fs, home, chats)
  const denied = policyCheck(chats)
  if (denied) throw new Error(denied)
  for (const dir of [base, chats]) {
    try {
      fs.mkdir(dir)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
  }
  assertWinChainSafe(fs, home, chats)
  const expectedChats = winChatsDir(fs.realpath(home))
  const realChats = fs.realpath(chats)
  if (winKey(realChats) !== winKey(expectedChats)) throw new WinChatUnsafe('Chats fuera de lugar')
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  for (let i = 0; i < 8; i++) {
    const name = `${stamp}-${rand()}`
    const dir = win32.join(realChats, name)
    try {
      fs.mkdir(dir)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw e
    }
    try {
      const st = fs.lstat(dir)
      if (!st || st.isSymbolicLink() || !st.isDirectory()) throw new WinChatUnsafe('carpeta nueva')
      if (winKey(fs.realpath(dir)) !== winKey(dir)) throw new WinChatUnsafe('carpeta nueva fuera de Chats')
    } catch (e) {
      removeIfEmptyReal(fs, dir, realChats)
      throw e
    }
    return dir
  }
  throw new WinChatUnsafe('sin id libre')
}

/** Deshace una carpeta recién creada: solo si sigue siendo carpeta real bajo `chats` (rmdir, nunca recursivo). */
export function removeIfEmptyReal(fs: WinChatFs, dir: string, chats: string): void {
  try {
    const st = fs.lstat(dir)
    if (st && !st.isSymbolicLink() && winKey(fs.realpath(win32.dirname(dir))) === winKey(chats)) fs.rmdir(dir)
  } catch {
    /* ya no está o no está vacía: no se toca */
  }
}

/** Disco real: `lstat`/`mkdir`/`rmdir`/`readdir` de `node:fs` y `realpath` del `WinHost` (que no abre unidades de red). */
export function createRealWinChatFs(host: Pick<WinHost, 'realpath'>): WinChatFs {
  return {
    lstat: (p) => {
      try {
        return lstatSync(p)
      } catch (e) {
        const c = (e as NodeJS.ErrnoException).code
        if (c === 'ENOENT' || c === 'ENOTDIR') return null
        throw e
      }
    },
    realpath: (p) => host.realpath(p),
    mkdir: (p) => mkdirSync(p),
    rmdir: (p) => rmdirSync(p),
    readdir: (p) => readdirSync(p)
  }
}
