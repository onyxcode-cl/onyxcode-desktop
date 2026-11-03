/**
 * Carpeta base de los temporales de los programas de ArtCraft (vista previa, HOME de `runCraft`). Por defecto es `os.tmpdir()`; la app la
 * apunta a una carpeta PRIVADA bajo `userData` (el agente aislado no puede escribir allí), porque en `$TMPDIR` el sandbox sí escribe y
 * podría cambiar `paginas/` o `libro.pdf` por un enlace a otra carpeta mientras el main los lee. Sin Electron: se inyecta desde `documents/index.ts`.
 */
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'

let base: string | null = null

export function setPrivateTmpBase(dir: string | null): void {
  base = dir
}

/** Base para `mkdtemp`: la privada si está configurada (se crea con permisos 0700), si no `os.tmpdir()`. */
export async function privateTmp(): Promise<string> {
  if (!base) return tmpdir()
  await mkdir(base, { recursive: true, mode: 0o700 })
  return base
}
