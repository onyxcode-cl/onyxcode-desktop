/**
 * Subconjunto de YAML suficiente para configuraciones y experimentos:
 * mapas por indentación, listas con "- ", escalares (null/bool/número/string, comillas simples y dobles),
 * flujo en línea ([a, b] y {a: 1}), bloques literales "|" y ">", comentarios "#".
 * No soporta anclas, etiquetas ni documentos múltiples. Los errores indican la línea.
 */
export class YamlLiteError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`YAML línea ${line}: ${message}`);
    this.name = "YamlLiteError";
    this.line = line;
  }
}

interface Ln { indent: number; text: string; n: number }

function stripComment(s: string): string {
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c === "\\" && q === '"') i++;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s:\[{,-]/.test(s[i - 1]!)) q = c;
    } else if (c === "#" && (i === 0 || /\s/.test(s[i - 1]!))) return s.slice(0, i);
  }
  return s;
}

function tokenize(src: string): { lines: Ln[]; raw: string[] } {
  const raw = src.replace(/\r\n?/g, "\n").split("\n");
  const lines: Ln[] = [];
  raw.forEach((l, i) => {
    if (/^\t/.test(l)) {
      if (l.trim() && !l.trim().startsWith("#")) throw new YamlLiteError("tabuladores no permitidos en la indentación", i + 1);
    }
    const t = stripComment(l).replace(/\s+$/, "");
    if (!t.trim()) return;
    lines.push({ indent: t.length - t.trimStart().length, text: t.trimStart(), n: i + 1 });
  });
  return { lines, raw };
}

const NUM = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

function scalar(v: string, n: number): unknown {
  const s = v.trim();
  if (s === "" || s === "~" || s === "null" || s === "Null" || s === "NULL") return null;
  if (s === "true" || s === "True") return true;
  if (s === "false" || s === "False") return false;
  if (s[0] === '"') {
    try { return JSON.parse(s); } catch { throw new YamlLiteError(`cadena entre comillas inválida: ${s}`, n); }
  }
  if (s[0] === "'") {
    if (!s.endsWith("'") || s.length < 2) throw new YamlLiteError(`comilla sin cerrar: ${s}`, n);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s[0] === "[" || s[0] === "{") return flow(s, n);
  if (NUM.test(s)) return Number(s);
  return s;
}

function splitTop(s: string, sep: string, n: number): string[] {
  const out: string[] = [];
  let depth = 0, q: string | null = null, cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      cur += c;
      if (c === "\\" && q === '"') { cur += s[++i] ?? ""; } else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === "[" || c === "{") depth++;
    if (c === "]" || c === "}") depth--;
    if (depth === 0 && c === sep) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (q || depth !== 0) throw new YamlLiteError("estructura en línea sin cerrar", n);
  if (cur.trim() !== "" || out.length) out.push(cur);
  return out;
}

function flow(s: string, n: number): unknown {
  const t = s.trim();
  if (t[0] === "[") {
    if (!t.endsWith("]")) throw new YamlLiteError("lista en línea sin cerrar", n);
    return splitTop(t.slice(1, -1), ",", n).filter((x) => x.trim() !== "").map((x) => scalar(x, n));
  }
  if (!t.endsWith("}")) throw new YamlLiteError("mapa en línea sin cerrar", n);
  const obj: Record<string, unknown> = {};
  for (const part of splitTop(t.slice(1, -1), ",", n)) {
    if (part.trim() === "") continue;
    const kv = splitKey(part.trim(), n);
    if (!kv) throw new YamlLiteError(`se esperaba clave: valor en "${part.trim()}"`, n);
    obj[kv[0]] = scalar(kv[1], n);
  }
  return obj;
}

/** Separa "clave: valor" respetando comillas en la clave. null si no es una entrada de mapa. */
function splitKey(text: string, n: number): [string, string] | null {
  let i = 0;
  let key: string;
  if (text[0] === '"' || text[0] === "'") {
    const q = text[0];
    let j = 1;
    while (j < text.length && text[j] !== q) { if (text[j] === "\\" && q === '"') j++; j++; }
    if (j >= text.length) return null;
    key = String(scalar(text.slice(0, j + 1), n));
    i = j + 1;
    if (text[i] !== ":") return null;
  } else {
    const m = /^([^:]*?):(?:\s|$)/.exec(text);
    if (!m || /^[\[{]/.test(text)) return null;
    key = m[1]!.trim();
    i = m[1]!.length;
    if (key === "") return null;
  }
  return [key, text.slice(i + 1).trim()];
}

const isItem = (t: string): boolean => t === "-" || t.startsWith("- ");

function block(lines: Ln[], i: number, indent: number, raw: string[]): [unknown, number] {
  const ln = lines[i]!;
  return isItem(ln.text) ? list(lines, i, indent, raw) : map(lines, i, indent, raw);
}

function child(lines: Ln[], i: number, parentIndent: number, raw: string[], allowSameIndentList: boolean): [unknown, number] {
  const nx = lines[i];
  if (nx && nx.indent > parentIndent) return block(lines, i, nx.indent, raw);
  if (allowSameIndentList && nx && nx.indent === parentIndent && isItem(nx.text)) return list(lines, i, parentIndent, raw);
  return [null, i];
}

function blockScalar(lines: Ln[], i: number, parentIndent: number, raw: string[], style: string, startLine: number): [string, number] {
  // usa las líneas crudas para conservar contenido (incluido '#') y saltos
  const out: string[] = [];
  let r = startLine; // índice crudo de la línea siguiente a la cabecera
  let ind = -1;
  while (r < raw.length) {
    const l = raw[r]!;
    if (l.trim() === "") { out.push(""); r++; continue; }
    const li = l.length - l.trimStart().length;
    if (li <= parentIndent) break;
    if (ind < 0) ind = li;
    if (li < ind) break;
    out.push(l.slice(ind));
    r++;
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  let next = i;
  while (next < lines.length && lines[next]!.n <= r) next++;
  const text = style.startsWith(">") ? out.join(" ").replace(/ {2,}/g, " ") : out.join("\n");
  return [text + (style.endsWith("-") ? "" : "\n"), next];
}

function map(lines: Ln[], i: number, indent: number, raw: string[]): [unknown, number] {
  const obj: Record<string, unknown> = {};
  while (i < lines.length) {
    const ln = lines[i]!;
    if (ln.indent < indent) break;
    if (ln.indent > indent) throw new YamlLiteError("indentación inesperada", ln.n);
    if (isItem(ln.text)) break;
    const kv = splitKey(ln.text, ln.n);
    if (!kv) throw new YamlLiteError(`se esperaba "clave: valor": ${ln.text}`, ln.n);
    const [key, val] = kv;
    if (key in obj) throw new YamlLiteError(`clave duplicada: ${key}`, ln.n);
    i++;
    if (val === "") {
      const [v, next] = child(lines, i, indent, raw, true);
      obj[key] = v; i = next;
    } else if (/^[|>][+-]?$/.test(val)) {
      const [v, next] = blockScalar(lines, i, indent, raw, val, ln.n);
      obj[key] = v; i = next;
    } else obj[key] = scalar(val, ln.n);
  }
  return [obj, i];
}

function list(lines: Ln[], i: number, indent: number, raw: string[]): [unknown, number] {
  const arr: unknown[] = [];
  while (i < lines.length) {
    const ln = lines[i]!;
    if (ln.indent < indent) break;
    if (ln.indent > indent) throw new YamlLiteError("indentación inesperada", ln.n);
    if (!isItem(ln.text)) break;
    const after = ln.text.slice(1);
    const rest = after.trim();
    if (rest === "") {
      i++;
      const [v, next] = child(lines, i, indent, raw, false);
      arr.push(v); i = next;
      continue;
    }
    if (splitKey(rest, ln.n)) {
      // "- clave: valor": el mapa continúa con las claves alineadas a la columna de "clave"
      const off = 1 + (after.length - after.trimStart().length);
      lines[i] = { indent: indent + off, text: rest, n: ln.n };
      const [v, next] = map(lines, i, indent + off, raw);
      arr.push(v); i = next;
      continue;
    }
    arr.push(scalar(rest, ln.n));
    i++;
  }
  return [arr, i];
}

export function parseYamlLite(src: string): unknown {
  const { lines, raw } = tokenize(src);
  if (lines.length === 0) return null;
  const first = lines[0]!;
  if (lines.length === 1 && !isItem(first.text) && !splitKey(first.text, first.n)) return scalar(first.text, first.n);
  const [v, next] = block(lines, 0, first.indent, raw);
  if (next < lines.length) throw new YamlLiteError("contenido inesperado tras el documento", lines[next]!.n);
  return v;
}
