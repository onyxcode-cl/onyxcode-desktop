/** Dobles para probar la política de carpetas de Windows (disco falso y contexto base). Solo para pruebas. */
import type { WinDirEntry, WinFolderPolicyContext, WinLinkProbe } from '../folder-policy-win'

export const P = 'C:\\Users\\Ben'

/** Disco doble: mapa `ruta(minúsculas)` → entradas; los enlaces se declaran por ruta completa. */
export function fakeDisk(dirs: Record<string, WinDirEntry[]> = {}, links: string[] = []): WinLinkProbe {
  const L = new Set(links.map((l) => l.toLowerCase()))
  return {
    lstat: (p) => (L.has(p.toLowerCase()) ? { isSymbolicLink: () => true } : { isSymbolicLink: () => false }),
    readdir: (p) => dirs[p.toLowerCase()] ?? []
  }
}

export function ctx(over: Partial<WinFolderPolicyContext> = {}): WinFolderPolicyContext {
  return {
    userProfile: P,
    systemRoot: 'C:\\Windows',
    programData: 'C:\\ProgramData',
    programFiles: ['C:\\Program Files', 'C:\\Program Files (x86)'],
    userData: `${P}\\AppData\\Roaming\\Lazunox`,
    drives: [
      { letter: 'C', kind: 'fixed' },
      { letter: 'D', kind: 'fixed' },
      { letter: 'E', kind: 'removable' },
      { letter: 'Z', kind: 'network' }
    ],
    links: fakeDisk(),
    ...over
  }
}
