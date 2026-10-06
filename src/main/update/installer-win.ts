import { spawn } from 'node:child_process'
import { dirname, join, win32 } from 'node:path'
import { checkZipEntriesWin, UPDATE_PLATFORMS, type UpdateManifest, type UpdatePlatformSpec } from '@shared/update-install'
import { UPDATE_WIN_CERT_THUMBPRINT } from './config'
import {
  InstallError,
  MAX_ENTRIES,
  UNCOMPRESSED_FACTOR_LIMIT,
  UpdateInstaller,
  type InstallerDeps,
  type RunFn
} from './installer'
import { readAsarPackageInfo } from './asar-version'
import { fileSource, readZipIndex, ZipIndexError, type ByteSource } from './zip-index'

/**
 * Instalador de Windows: misma descarga y mismas verificaciones (firma Ed25519 antes de leer el JSON, tamaño y SHA-256 del ZIP,
 * anti-downgrade) que el del Mac; cambia la verificación del paquete (índice del ZIP en JS puro, tar.exe, cotejo de ficheros y
 * versión del app.asar en vez de codesign/plutil). NADA del staging se ejecuta: solo `swap.ps1` lo mueve, tras `beginInstall`.
 */
export interface WinInstallerDeps extends InstallerDeps {
  /** Carpeta REAL de la app en ejecución (…\Programs\Lazunox). El staging es hermano suyo, en el mismo volumen. */
  installDir: string
  /** `%SystemRoot%` (p. ej. C:\Windows): de ahí salen tar.exe y powershell.exe, siempre por ruta absoluta. */
  systemRoot: string
  /** Huella Authenticode exigida (por defecto UPDATE_WIN_CERT_THUMBPRINT; vacío = no se comprueba). */
  certThumbprint?: string
  /** Abre un fichero como fuente de bytes (inyectable en pruebas). */
  openSource?: (path: string) => Promise<ByteSource & { close: () => Promise<void> }>
}

/** Ficheros sin los que la app no arranca; se exigen en el ZIP ANTES de extraer y en disco después. */
const REQUIRED = ['lazunox.exe', 'resources/app.asar', 'resources/opencode/opencode.exe']
const FIXED_EXTRA_SPACE = 256 * 1024 * 1024

export function stagingDirWin(installDir: string, version: string): string {
  return join(dirname(installDir), `.Lazunox.staging-${version}`)
}

interface Expected {
  /** Ruta relativa en minúsculas (con «/») → tamaño. */
  files: Map<string, number>
  dirs: Set<string>
}

export class WinUpdateInstaller extends UpdateInstaller {
  protected readonly spec: UpdatePlatformSpec = UPDATE_PLATFORMS['win32-x64']
  private expected: { app: string; exp: Expected } | null = null

  constructor(private readonly w: WinInstallerDeps) {
    super(w)
  }

  protected override async discardExtra(version: string): Promise<void> {
    await this.w.fs.rmrf(stagingDirWin(this.w.installDir, version))
  }

  private open(path: string): Promise<ByteSource & { close: () => Promise<void> }> {
    return (this.w.openSource ?? fileSource)(path)
  }

  protected override async extractAndVerify(zipPath: string, _dir: string, m: UpdateManifest): Promise<string> {
    const staged = stagingDirWin(this.w.installDir, m.version)
    try {
      // 1. Índice del ZIP (JS puro): cada entrada se valida ANTES de extraer nada.
      const zip = await this.open(zipPath)
      let exp: Expected
      let total: number
      try {
        const idx = await readZipIndex(zip, {
          maxEntries: MAX_ENTRIES,
          maxUncompressed: m.zip.size * UNCOMPRESSED_FACTOR_LIMIT + 1024 * 1024 * 1024
        })
        total = idx.totalUncompressed
        const check = checkZipEntriesWin(idx.entries.map((e) => ({ name: e.name, isSymlink: e.isSymlink })))
        if (!check.ok) throw new InstallError('zip', `entrada no permitida (${check.reason}): ${JSON.stringify(check.entry.slice(0, 80))}`)
        exp = { files: new Map(), dirs: new Set() }
        for (const e of idx.entries) {
          const rel = e.name.slice('Lazunox/'.length).replace(/\/$/, '').toLowerCase()
          if (rel === '') continue
          if (e.isDirectory) exp.dirs.add(rel)
          else exp.files.set(rel, e.size)
        }
        for (const r of REQUIRED) if (!exp.files.has(r)) throw new InstallError('zip', `falta ${r} en el ZIP`)
      } catch (err) {
        if (err instanceof InstallError) throw err
        if (err instanceof ZipIndexError) throw new InstallError('zip', `ZIP no válido (${err.code})`)
        throw new InstallError('zip', 'no se pudo leer el ZIP')
      } finally {
        await zip.close().catch(() => undefined)
      }
      if (this.cancelled) throw new InstallError('unknown', 'cancelado')

      // 2. Espacio en el volumen del destino (el staging es hermano de la carpeta instalada).
      const free = await this.w.fs.freeBytes(dirname(this.w.installDir))
      if (free < total * 1.5 + FIXED_EXTRA_SPACE) throw new InstallError('space', 'espacio insuficiente en la carpeta de instalación')

      // 3. Extracción con tar.exe (bsdtar de System32) en el staging hermano; argumentos en array, nunca una shell.
      await this.w.fs.rmrf(staged)
      await this.w.fs.mkdirp(staged, 0o700)
      const tar = win32.join(this.w.systemRoot, 'System32', 'tar.exe')
      const ex = await this.d.run(tar, ['-x', '-f', zipPath, '-C', staged, '--strip-components', '1'])
      if (ex.code !== 0) throw new InstallError('zip', 'no se pudo extraer el ZIP')
      if (this.cancelled) throw new InstallError('unknown', 'cancelado')

      this.expected = { app: staged, exp }
      await this.verifyApp(staged, m)
      return staged
    } catch (err) {
      this.expected = null
      await this.w.fs.rmrf(staged).catch(() => undefined)
      throw err
    }
  }

  /** Recorrido sin enlaces ni reparse points, cotejo con el índice del ZIP, ficheros imprescindibles, versión del asar y Authenticode opcional. */
  override async verifyApp(app: string, m: UpdateManifest): Promise<void> {
    const { fs } = this.w
    const st = await fs.lstat(app).catch(() => null)
    if (!st || !st.isDirectory || st.isSymlink) throw new InstallError('zip', 'falta la carpeta de la app')
    const exp = this.expected && this.expected.app === app ? this.expected.exp : null
    if (!exp) throw new InstallError('zip', 'sin índice del ZIP para esta carpeta')

    const files = new Map<string, number>()
    const dirs = new Set<string>()
    const visit = async (dir: string, rel: string): Promise<void> => {
      for (const name of await fs.readdir(dir)) {
        const p = join(dir, name)
        const r = rel === '' ? name.toLowerCase() : `${rel}/${name.toLowerCase()}`
        const k = await fs.lstat(p)
        // En Windows un junction o symlink aparece como isSymlink: ninguno es válido dentro de la app.
        if (k.isSymlink) throw new InstallError('zip', `enlace no permitido: ${name}`)
        if (k.isDirectory) {
          dirs.add(r)
          await visit(p, r)
        } else if (k.isFile) files.set(r, k.size ?? -1)
        else throw new InstallError('zip', `tipo de archivo no permitido: ${name}`)
      }
    }
    await visit(app, '')
    // Lo extraído debe ser EXACTAMENTE lo del índice: detecta cuarentena de Defender (faltan o cambian de tamaño) y sobras.
    if (files.size !== exp.files.size) throw new InstallError('zip', 'el número de ficheros no coincide con el ZIP')
    for (const [rel, size] of exp.files) {
      if (files.get(rel) !== size) throw new InstallError('zip', `fichero ausente o de otro tamaño: ${JSON.stringify(rel.slice(0, 80))}`)
    }
    // Carpetas: las del índice y las implícitas en las rutas de los ficheros (un ZIP puede no traer entradas de carpeta).
    const known = new Set(exp.dirs)
    for (const f of exp.files.keys()) for (let i = f.indexOf('/'); i > 0; i = f.indexOf('/', i + 1)) known.add(f.slice(0, i))
    for (const d of dirs) if (!known.has(d)) throw new InstallError('zip', `carpeta que no está en el ZIP: ${JSON.stringify(d.slice(0, 80))}`)
    for (const r of REQUIRED) if (!files.has(r)) throw new InstallError('zip', `falta ${r}`)

    // Versión: package.json de la cabecera del app.asar (JS puro) frente al manifiesto firmado.
    const src = await this.open(join(app, 'resources', 'app.asar'))
    let info
    try {
      info = await readAsarPackageInfo(src)
    } catch (e) {
      throw new InstallError('zip', `app.asar no válido: ${e instanceof Error ? e.message : 'error'}`)
    } finally {
      await src.close().catch(() => undefined)
    }
    if (info.name !== 'lazunox') throw new InstallError('signing', 'app.asar: nombre distinto')
    if (info.version !== m.version) throw new InstallError('downgrade', 'app.asar: versión distinta de la firmada')

    const thumb = this.w.certThumbprint ?? UPDATE_WIN_CERT_THUMBPRINT
    if (thumb !== '') {
      // Valor mal formado = configuración rota (falla cerrado): nunca se pasa a PowerShell sin validar.
      if (!/^[0-9A-F]{40}$/.test(thumb)) throw new InstallError('signing', 'UPDATE_WIN_CERT_THUMBPRINT mal formado')
      const ps = win32.join(this.w.systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      const script =
        "$s = Get-AuthenticodeSignature -LiteralPath $env:LAZUNOX_VERIFY_PATH; if ($s.Status -eq 'Valid' -and $s.SignerCertificate.Thumbprint -eq $env:LAZUNOX_VERIFY_THUMB) { exit 0 } else { exit 1 }"
      const r = await this.d.run(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        env: { LAZUNOX_VERIFY_PATH: join(app, 'Lazunox.exe'), LAZUNOX_VERIFY_THUMB: thumb }
      })
      if (r.code !== 0) throw new InstallError('signing', 'Authenticode: firma no válida o de otro certificado')
    }
  }
}

/** `run` real de Windows: sin shell, sin ventana, entorno mínimo con System32 en el PATH. */
export function nodeRunWin(systemRoot: string): RunFn {
  return (cmd, args, opts) =>
    new Promise((ok) => {
      const env: Record<string, string> = {
        SystemRoot: systemRoot,
        windir: systemRoot,
        PATH: `${systemRoot}\\System32;${systemRoot}`,
        TEMP: process.env.TEMP ?? '',
        TMP: process.env.TMP ?? process.env.TEMP ?? '',
        ...opts?.env
      }
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (b: Buffer) => (stdout = (stdout + b.toString('utf8')).slice(-8 * 1024 * 1024)))
      child.stderr.on('data', (b: Buffer) => (stderr = (stderr + b.toString('utf8')).slice(-64 * 1024)))
      child.once('error', (e) => ok({ code: 127, stdout, stderr: `${stderr}${e.message}` }))
      child.once('close', (code) => ok({ code: code ?? 1, stdout, stderr }))
    })
}
