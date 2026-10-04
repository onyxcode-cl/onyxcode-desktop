import { closeSync, constants, fstatSync, lstatSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Escritura de artefactos del banco que NO sigue enlaces: el último componente se abre con O_NOFOLLOW
 * y el directorio padre debe ser un directorio real (lstat). Si el agente plantó `out/x -> ~/.zshrc`,
 * falla (ELOOP) en vez de sobrescribir el destino.
 */
export function writeFileNoFollow(path: string, data: string | Uint8Array, mode = 0o600): void {
  const parent = lstatSync(dirname(path));
  if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error(`el directorio de destino no es real: ${dirname(path)}`);
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, mode);
  try {
    if (!fstatSync(fd).isFile()) throw new Error(`destino no es un archivo regular: ${path}`);
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    let off = 0;
    while (off < buf.length) off += writeSync(fd, buf, off);
  } finally {
    closeSync(fd);
  }
}
