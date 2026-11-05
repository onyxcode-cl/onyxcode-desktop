/**
 * ¿La app corre con firma ad-hoc (sin certificado de Apple)? Con ese tipo de firma macOS liga los permisos (TCC) al hash exacto del
 * binario: tras cada versión nueva el interruptor puede seguir encendido en Ajustes y aun así el permiso no vale. Solo lectura
 * (`codesign -dv`); nunca toca permisos. Se calcula una vez por ejecución (la firma no cambia con la app abierta).
 */
import { execFile } from 'node:child_process'

/** Carpeta `.app` que contiene el ejecutable (`…/X.app/Contents/MacOS/X`), o `null` si no corre dentro de un paquete. */
export function bundleOf(execPath: string): string | null {
  const i = execPath.indexOf('.app/Contents/')
  return i < 0 ? null : execPath.slice(0, i + 4)
}

/** Interpreta la salida de `codesign -dv` (va por stderr): ad-hoc = `Signature=adhoc` o la marca `adhoc` en los flags. */
export function isAdhocOutput(text: string): boolean {
  return /^Signature=adhoc$/m.test(text) || /flags=.*\badhoc\b/.test(text)
}

export type CodesignRun = (bundle: string) => Promise<string>

const realRun: CodesignRun = (bundle) =>
  new Promise((resolve) => {
    // codesign escribe en stderr incluso cuando todo va bien; si falla, se devuelve vacío (= no se sabe).
    execFile('/usr/bin/codesign', ['-dv', bundle], { timeout: 5_000 }, (_err, stdout, stderr) => resolve(`${stdout}${stderr}`))
  })

let cached: Promise<boolean> | null = null

/** `true` solo si se pudo comprobar y es ad-hoc. En cualquier duda, `false` (no se muestra el aviso). */
export function isAdhocSigned(execPath: string = process.execPath, run: CodesignRun = realRun): Promise<boolean> {
  if (process.platform !== 'darwin' && run === realRun) return Promise.resolve(false)
  if (run === realRun && cached) return cached
  const bundle = bundleOf(execPath)
  const p = bundle ? run(bundle).then(isAdhocOutput, () => false) : Promise.resolve(false)
  if (run === realRun) cached = p
  return p
}
