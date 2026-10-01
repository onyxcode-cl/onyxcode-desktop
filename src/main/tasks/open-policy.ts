/**
 * Política de `tasks:openPath` (AUDIT.md S4).
 *
 * Los archivos de la carpeta de Tareas los puede crear el agente. Abrirlos con la app por
 * defecto (`shell.openPath`) ejecuta FUERA del sandbox cualquier lanzador: `x.command`/`.tool`
 * (Terminal), `.app`, `.terminal`, `.workflow`, `.pkg`, `.fileloc`… Esos tipos (y todo archivo
 * con bit de ejecución) se rechazan: solo se ofrecen "Mostrar en Finder".
 */
import { t } from '@shared/i18n'
import { statSync } from 'node:fs'
import { extname } from 'node:path'

/** Extensiones que ejecutan código, instalan o lanzan otra cosa al abrirse. */
export const BLOCKED_OPEN_EXTENSIONS = new Set([
  // Bundles y paquetes de macOS
  '.app',
  '.pkg',
  '.mpkg',
  '.dmg',
  '.sparseimage',
  '.sparsebundle',
  '.bundle',
  '.plugin',
  '.prefpane',
  '.kext',
  '.saver',
  '.qlgenerator',
  '.mdimporter',
  '.osax',
  '.xpc',
  '.framework',
  '.appex',
  // Scripts y lanzadores
  '.command',
  '.tool',
  '.terminal',
  '.sh',
  '.bash',
  '.zsh',
  '.csh',
  '.ksh',
  '.tcsh',
  '.fish',
  '.py',
  '.pyc',
  '.pyw',
  '.rb',
  '.pl',
  '.php',
  '.lua',
  '.tcl',
  '.scpt',
  '.scptd',
  '.applescript',
  '.workflow',
  '.action',
  '.shortcut',
  '.automator',
  // Accesos directos (pueden apuntar a ejecutables locales)
  '.fileloc',
  '.webloc',
  '.inetloc',
  '.url',
  '.desktop',
  '.lnk',
  // Otros ejecutables
  '.jar',
  '.jnlp',
  '.exe',
  '.msi',
  '.bat',
  '.cmd',
  '.com',
  '.ps1',
  '.vbs',
  '.wsf',
  '.dylib',
  '.so',
  '.mobileconfig',
  '.configprofile',
  '.itermcolors'
])

/**
 * Lanza un error si abrir `path` con la app por defecto podría ejecutar código.
 * `path` debe venir ya resuelto (realpath) y validado dentro de una carpeta autorizada.
 */
export function assertSafeToOpen(path: string): void {
  const ext = extname(path).toLowerCase()
  const blocked = (): never => {
    throw new Error(t('merr.open.blocked', { ext: ext || t('merr.open.blockedExecutable') }))
  }
  if (BLOCKED_OPEN_EXTENSIONS.has(ext)) blocked()
  const st = statSync(path)
  if (st.isDirectory()) return // carpetas normales: se abren en Finder
  if (!st.isFile()) blocked()
  // Bit de ejecución (u/g/o): Finder lo abre en Terminal.
  if ((st.mode & 0o111) !== 0) blocked()
}
