import ts from 'typescript'

/** Atributos JSX cuyo literal es texto visible. */
const TEXT_ATTRS = new Set([
  'label',
  'title',
  'placeholder',
  'aria-label',
  'alt',
  'description',
  'aria-description',
  'aria-placeholder',
  'tooltip',
  'heading'
])
/** Palabras sueltas permitidas como texto JSX (marcas y siglas, no traducibles). */
const BRAND = new Set([
  'OpenCode',
  'MCP',
  'API',
  'OnyxCode',
  'Quick',
  'Entry',
  'Esc',
  'Ctrl',
  'Code',
  'URL',
  'JSON',
  'OAuth',
  'GitHub',
  'Go',
  'Enter',
  'Shift',
  'Tab',
  'Electron',
  'Chromium',
  'Node',
  'js',
  'PyPI',
  'rm',
  'mv',
  'find',
  'delete',
  'github',
  'npx',
  'npm',
  'API_KEY',
  'Authorization',
  'Bearer',
  'opencode',
  'config',
  'server',
  'everything',
  'modelcontextprotocol'
])
const STOPWORDS = new Set([
  'de',
  'la',
  'el',
  'los',
  'las',
  'para',
  'que',
  'con',
  'sin',
  'una',
  'del',
  'por',
  'tu',
  'tus',
  'su',
  'al',
  'se',
  'no',
  'es',
  'esta',
  'este',
  'ya',
  'más',
  'muy',
  'hay'
])

/** Clases de Tailwind y similares: casi todos los trozos llevan guion, dos puntos o corchetes. */
function looksLikeCss(text: string): boolean {
  const parts = text.trim().split(/\s+/)
  return parts.length > 1 && parts.filter((p) => /[-:[\]/]/.test(p)).length * 2 >= parts.length
}

function isSpanish(text: string): boolean {
  if (/[áéíóúñ¿¡ÁÉÍÓÚÑ]/.test(text)) return true
  if (!/\s/.test(text.trim()) || looksLikeCss(text)) return false
  const words = text.toLowerCase().match(/[a-záéíóúñ]+/g) ?? []
  return words.length >= 2 && words.some((w) => STOPWORDS.has(w))
}

export function findHardcodedText(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const lines = source.split('\n')
  const out: string[] = []
  const ignored = (pos: number): boolean => {
    const line = sf.getLineAndCharacterOfPosition(pos).line
    return /i18n-ignore/.test(lines[line] ?? '') || /i18n-ignore/.test(lines[line - 1] ?? '')
  }
  const report = (node: ts.Node, kind: string, text: string): void => {
    if (ignored(node.getStart(sf))) return
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    out.push(`${file}:${line + 1} [${kind}] ${text.trim().replace(/\s+/g, ' ').slice(0, 90)}`)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    // Los registros de consola no los ve el usuario: sus argumentos no cuentan.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'console'
    )
      return
    if (ts.isJsxText(node)) {
      const text = node.getText(sf)
      const words = text.match(/[A-Za-zÀ-ÿ]{2,}/g) ?? []
      if (words.some((w) => !BRAND.has(w))) report(node, 'texto JSX', text)
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText(sf)
      const value = node.initializer.text
      if (TEXT_ATTRS.has(name) && (value.match(/[A-Za-zÀ-ÿ_]{2,}/g) ?? []).some((w) => !BRAND.has(w)))
        report(node, `atributo ${name}`, value)
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!ts.isJsxAttribute(node.parent) && !ts.isImportDeclaration(node.parent) && isSpanish(node.text))
        report(node, 'literal', node.text)
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (isSpanish(node.text)) report(node, 'plantilla', node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}
