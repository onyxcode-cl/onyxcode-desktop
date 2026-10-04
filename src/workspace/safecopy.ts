import { chmod, copyFile, lstat, mkdir, readdir, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export interface SafeCopyResult {
  /** rutas relativas de symlinks encontrados (no se copian, no se siguen) */
  symlinks: string[];
  /** entradas que no son archivo/directorio/symlink (sockets, fifos, dispositivos): no se copian */
  special: string[];
  files: number;
}

export interface SafeCopyOptions {
  /** devuelve true para omitir una ruta relativa (con "/") */
  skip?: (rel: string) => boolean;
  /** reemplaza archivos existentes en destino (inyección de ocultos); nunca escribe a través de un symlink */
  overwrite?: boolean;
}

/**
 * Copia un árbol controlado por el agente SIN seguir ni recrear enlaces simbólicos:
 * usa lstat en cada entrada, descarta symlinks y especiales y los reporta. El destino debe ser un
 * directorio real creado por el banco. Así un `eval/x -> ~/Documents` plantado por el agente nunca
 * llega a la copia de evaluación y la inyección posterior de ocultos no puede escribir a través de él.
 */
export async function safeCopyTree(src: string, dest: string, o: SafeCopyOptions = {}): Promise<SafeCopyResult> {
  const res: SafeCopyResult = { symlinks: [], special: [], files: 0 };
  const rootSt = await lstat(src);
  if (rootSt.isSymbolicLink() || !rootSt.isDirectory()) throw new Error(`origen no es un directorio real: ${src}`);
  await mkdir(dest, { recursive: true });
  const dst = await lstat(dest);
  if (dst.isSymbolicLink() || !dst.isDirectory()) throw new Error(`destino no es un directorio real: ${dest}`);
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const from = join(dir, e.name);
      const rel = relative(src, from).split(sep).join("/");
      if (o.skip?.(rel)) continue;
      const to = join(dest, rel);
      const st = await lstat(from); // no sigue enlaces
      if (st.isSymbolicLink()) { res.symlinks.push(rel); continue; }
      const cur = await lstat(to).catch(() => null);
      if (st.isDirectory()) {
        if (cur && (cur.isSymbolicLink() || !cur.isDirectory())) {
          if (!o.overwrite) throw new Error(`destino ocupado: ${to}`);
          await rm(to, { force: true, recursive: true });
          await mkdir(to, { mode: 0o700 });
        } else if (!cur) await mkdir(to, { recursive: false, mode: (st.mode & 0o777) | 0o700 });
        else if (!o.overwrite) throw new Error(`destino ocupado: ${to}`);
        await walk(from);
      } else if (st.isFile()) {
        if (cur) {
          if (!o.overwrite) throw new Error(`destino ocupado: ${to}`);
          await rm(to, { force: true, recursive: true }); // si era symlink se borra el enlace, no su destino
        }
        await copyFile(from, to, 1 /* COPYFILE_EXCL */);
        await chmod(to, st.mode & 0o777);
        res.files++;
      } else res.special.push(rel);
    }
  };
  await walk(src);
  return res;
}

/** Recorre `root` y devuelve los symlinks (rutas relativas) sin seguirlos. */
export async function findSymlinks(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) out.push(relative(root, p).split(sep).join("/"));
      else if (e.isDirectory()) await walk(p);
    }
  };
  await walk(root);
  return out.sort();
}
