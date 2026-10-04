// Glob mínimo: **, *, ?, {a,b}. Rutas con "/" como separador.
export function globToRegExp(glob: string): RegExp {
  let re = "";
  let i = 0;
  let brace = 0;
  while (i < glob.length) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i += 2;
        if (glob[i] === "/") { i++; re += "(?:.*/)?"; } else re += ".*";
        continue;
      }
      re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") { brace++; re += "(?:"; }
    else if (c === "}" && brace > 0) { brace--; re += ")"; }
    else if (c === "," && brace > 0) re += "|";
    else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
    i++;
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}
