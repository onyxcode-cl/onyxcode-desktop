/**
 * Descripción en lenguaje llano de un comando de terminal, para el resumen de pasos de la conversación: una persona sin
 * conocimientos técnicos lee «Creó la hoja de Excel», no `PY="$LAZUNOX_PYTHON" S=… build_xlsx.py …`. El comando real sigue
 * disponible al desplegar el paso.
 */
export type PlainBashId =
  'check' | 'render' | 'excel' | 'word' | 'ppt' | 'pdf' | 'mkdir' | 'move' | 'copy' | 'remove' | 'look' | 'prep' | 'open' | 'other'

/** Orden = prioridad: primero verificar/renderizar (también nombran el .xlsx), luego crear, luego operaciones de archivos. */
const RULES: Array<[PlainBashId, RegExp]> = [
  [
    'check',
    /(recalc_check|check_(xlsx|docx|pptx|pdf)|inspect_(xlsx|docx|pptx|pdf)|verificar_office|comparar_estructura|extract_pdf|\bdoctor\.py)/
  ],
  ['render', /(render\.py|\bpdftoppm\b|\bqlmanage\b)/],
  ['excel', /(build_xlsx|openpyxl|\.xlsx\b)/],
  ['word', /(build_docx|python-docx|\.docx\b)/],
  ['ppt', /(build_pptx|python-pptx|\.pptx\b)/],
  ['pdf', /(build_pdf|reportlab|\bqpdf\b|\.pdf\b)/],
  ['mkdir', /((^|[;&|]\s*)mkdir\b|new-item\b.*-itemtype\s+directory|\bmd\s)/],
  ['move', /((^|[;&|]\s*)mv\b|\bmove-item\b|(^|[;&|]\s*)move\s)/],
  ['copy', /((^|[;&|]\s*)(cp|ditto)\b|\bcopy-item\b|(^|[;&|]\s*)(copy|xcopy|robocopy)\s)/],
  ['remove', /((^|[;&|]\s*)(rm|trash)\b|\bremove-item\b|(^|[;&|]\s*)(del|erase|rmdir)\s)/],
  ['open', /((^|[;&|]\s*)open\b|\bstart-process\b|(^|[;&|]\s*)start\s)/],
  [
    'look',
    /((^|[;&|]\s*)(ls|find|test|stat|du|cat|head|tail|wc|echo|pwd|which|dir|type)\b|\b(get-childitem|test-path|get-content|get-item)\b)/
  ],
  ['prep', /(python3?\b|\$lazunox_python|\bpip\b|\bnode\b|\bsed\b|\bawk\b)/]
]

/** Un script suelto con python-docx/openpyxl/python-pptx que solo LEE (no guarda ni escribe nada) es una revisión, no una creación. */
function readsOfficeOnly(c: string): boolean {
  return /(import docx|from docx|openpyxl|import pptx|from pptx)/.test(c) && !/(\.save\(|\.write\(|write_text|open\([^)]*['"]w)/.test(c)
}

/** Un comando suelto (sin encadenar) que borra, mueve, copia o abre un archivo es esa operación aunque nombre un .docx/.xlsx…: `rm informe.docx` no «creó» nada. */
const SOLE_FILE_OPS: Array<[PlainBashId, RegExp]> = [
  ['remove', /^((rm|trash)\b|remove-item\b|(del|erase|rmdir)\s)/],
  ['move', /^(mv\b|move-item\b|move\s)/],
  ['copy', /^((cp|ditto)\b|copy-item\b|(copy|xcopy|robocopy)\s)/],
  ['open', /^(open\b|start-process\b|start\s)/]
]

function soleFileOp(c: string): PlainBashId | null {
  if (/(&&|\|\||[;|])/.test(c)) return null
  for (const [id, re] of SOLE_FILE_OPS) if (re.test(c)) return id
  return null
}

export function plainBash(command: string): PlainBashId {
  const c = command.toLowerCase().replace(/\s+/g, ' ').trim()
  const op = soleFileOp(c)
  if (op) return op
  if (readsOfficeOnly(c)) return 'check'
  for (const [id, re] of RULES) if (re.test(c)) return id
  return 'other'
}
