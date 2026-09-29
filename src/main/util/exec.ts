import { execFile } from 'node:child_process'

/** Ejecuta un helper nativo y devuelve su stdout; rechaza con stderr (o el mensaje) si falla. */
export function runHelper(bin: string, args: string[], timeout = 10_000, maxBuffer?: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, maxBuffer ? { timeout, maxBuffer } : { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).toString().trim()))
      else resolve(stdout.toString())
    })
  })
}
