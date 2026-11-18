/** Runs in the composition page. Geometry warnings are advisory and bounded, never authorization. */
export function inspectFrame({ width, height }) {
  const stage = document.querySelector('[data-composition-id]')
  const elements = [stage, ...Array.from(stage.querySelectorAll('*')).slice(0, 1999)]
  const visible = (el) => {
    let opacity = 1
    for (let p = el; p; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (s.display === 'none' || ['hidden', 'collapse'].includes(s.visibility)) return false
      opacity *= Number(s.opacity || '1')
    }
    const r = el.getBoundingClientRect()
    return opacity > 0.06 && r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < width && r.top < height
  }
  const shown = elements.filter(visible)
  const painted = (el) => {
    const s = getComputedStyle(el)
    return /^(IMG|SVG|CANVAS|VIDEO|PATH|RECT|CIRCLE|LINE|POLYGON|ELLIPSE)$/.test(el.tagName.toUpperCase()) ||
      (s.backgroundImage && s.backgroundImage !== 'none') || (!['transparent', 'rgba(0, 0, 0, 0)'].includes(s.backgroundColor) && s.backgroundColor !== '') ||
      ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== 'none')
  }
  const texts = []
  for (const el of shown) {
    if (/^(SCRIPT|STYLE)$/.test(el.tagName)) continue
    for (const node of el.childNodes) {
      if (node.nodeType !== 3 || !node.textContent.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0)
      if (rects.length) texts.push({ el, rects, text: node.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) })
      if (texts.length >= 100) break
    }
    if (texts.length >= 100) break
  }
  const issues = [], details = []
  let currentElement = stage
  const selector = (el) => {
    const parts = []
    for (let p = el; p && parts.length < 6; p = p.parentElement) {
      if (p.id) { parts.unshift('#' + p.id.slice(0, 80)); break }
      parts.unshift(p.tagName.toLowerCase() + ':nth-child(' + (Array.from(p.parentElement?.children ?? []).indexOf(p) + 1) + ')')
    }
    return parts.join(' > ')
  }
  const add = (text) => {
    const where = selector(currentElement)
    if (details.length < 20 && !details.some((d) => d.message === text && d.selector === where)) {
      details.push({ message: text, selector: where })
      if (!issues.includes(text)) issues.push(text)
    }
  }
  const outside = (a, b, tolerance = 2) => a.left < b.left - tolerance || a.right > b.right + tolerance || a.top < b.top - tolerance || a.bottom > b.bottom + tolerance
  const safe = width < height ? { left: 90, right: width - 90, top: 200, bottom: height - 200 } : { left: 54, right: width - 54, top: 54, bottom: height - 54 }
  const shapes = shown.filter(painted)
  for (const { el, rects, text } of texts) {
    currentElement = el
    const box = el.getBoundingClientRect()
    const overflow = (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) || (el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 2)
    if (overflow || rects.some((r) => outside(r, box))) add(`el texto "${text}" se sale de su caja`)
    if (rects.some((r) => outside(r, safe))) add(`el texto "${text}" se sale del área segura del lienzo`)
    for (let p = el.parentElement; p && p !== stage; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (['hidden', 'clip', 'scroll', 'auto'].includes(s.overflowX) || ['hidden', 'clip', 'scroll', 'auto'].includes(s.overflowY)) {
        if (rects.some((r) => outside(r, p.getBoundingClientRect()))) { add(`el texto "${text}" queda recortado por su contenedor`); break }
      }
    }
    const others = [...texts.map((t) => t.el), ...shapes]
    for (const other of new Set(others)) {
      if (other === el || other.contains(el)) continue
      const b = other.getBoundingClientRect()
      let covered = false
      for (const a of rects) {
        const l = Math.max(0, a.left, b.left), r = Math.min(width, a.right, b.right)
        const t = Math.max(0, a.top, b.top), bottom = Math.min(height, a.bottom, b.bottom)
        if (r - l < 2 || bottom - t < 2) continue
        // Include decorations with pointer-events:none (e.g. clock hands), restoring the inline value afterwards.
        const saved = [el, other].map((e) => [e, e.style.getPropertyValue('pointer-events'), e.style.getPropertyPriority('pointer-events')])
        for (const [e] of saved) e.style.setProperty('pointer-events', 'auto', 'important')
        const stack = document.elementsFromPoint((l + r) / 2, (t + bottom) / 2)
        for (const [e, value, priority] of saved) {
          if (value) e.style.setProperty('pointer-events', value, priority)
          else e.style.removeProperty('pointer-events')
        }
        const above = stack.findIndex((e) => e === other || other.contains(e))
        const below = stack.indexOf(el)
        if (above >= 0 && (below < 0 || above < below)) { covered = true; break }
      }
      if (covered) { add(`el texto "${text}" queda tapado por otro elemento`); break }
    }
  }
  const content = [...texts.flatMap((t) => t.rects), ...shapes.map((e) => e.getBoundingClientRect()).filter((r) => r.width * r.height < width * height * 0.95)]
    .filter((r) => r.right > 0 && r.bottom > 0 && r.left < width && r.top < height)
  let coverage = 0
  if (content.length) {
    const l = Math.max(0, Math.min(...content.map((r) => r.left))), r = Math.min(width, Math.max(...content.map((r) => r.right)))
    const t = Math.max(0, Math.min(...content.map((r) => r.top))), b = Math.min(height, Math.max(...content.map((r) => r.bottom)))
    coverage = Math.max(0, (r - l) * (b - t) / (width * height))
  }
  currentElement = stage
  if (content.length && coverage < 0.6) add(`el contenido ocupa solo el ${Math.round(coverage * 100)} % del lienzo; revisa el espacio vacío`)
  return { issues, details, visibleText: texts.length, coverage }
}

/** RGB thumbnail variation: a solid or nearly solid frame has very little color variation. */
export function colorVariation(rgb) {
  const n = Math.floor(rgb.length / 3)
  if (!n) return 0
  let variance = 0
  for (let c = 0; c < 3; c++) {
    let sum = 0, squares = 0
    for (let i = c; i < n * 3; i += 3) { sum += rgb[i]; squares += rgb[i] ** 2 }
    variance += Math.max(0, squares / n - (sum / n) ** 2)
  }
  return Math.sqrt(variance / 3)
}

/** PNG budget before base64 encoding. Half size is preferred; quarter size bounds noisy six-frame responses. */
export function needsSmallerFrames(sizes) {
  return sizes.reduce((a, b) => a + b, 0) > 3 * 1024 * 1024 || sizes.some((n) => n > 2 * 1024 * 1024)
}

/** Uniform 64×64 gray thumbnails, every 250 ms. Ignore pauses shorter than one second. */
export function measureMotion(bytes, duration, step = 0.25) {
  const size = 64 * 64, count = Math.floor(bytes.length / size)
  if (count < 2 || duration <= 0 || bytes.length % size) throw Error('Muestreo de movimiento incompleto')
  const spans = []
  let start = null
  for (let i = 1; i < count; i++) {
    let delta = 0
    for (let p = 0; p < size; p++) delta += Math.abs(bytes[(i - 1) * size + p] - bytes[i * size + p])
    const still = delta / (size * 255) < 0.001
    if (still && start === null) start = (i - 1) * step
    if (!still && start !== null) {
      const end = Math.min(duration, (i - 1) * step)
      if (end - start >= 1) spans.push({ inicio: start, fin: end })
      start = null
    }
  }
  if (start !== null && duration - start >= 1) spans.push({ inicio: start, fin: duration })
  const percentage = spans.reduce((n, s) => n + s.fin - s.inicio, 0) / duration * 100
  const warning = percentage > 35.00001 || spans.some((s) => s.fin - s.inicio > 2.5)
  return { porcentajeQuieto: Math.round(percentage * 10) / 10, tramos: spans, intervalo: step, aviso: warning ? `La imagen está quieta el ${Math.round(percentage)} % del tiempo (${spans.map((s) => `${s.inicio}–${s.fin} s`).join(' y ')}): agrega movimiento continuo (fondo, cámara, objetos) en esos tramos.` : null }
}

/** Scene overlap midpoint and actual short tween midpoints cover transitions between sparse review times. */
export function transitionSamples() {
  const elements = [...document.querySelectorAll('[data-composition-src], [data-beat], .clip')]
  const starts = elements.map((el) => {
    let start = Number(el.getAttribute('data-start') || 0)
    for (let p = el.parentElement; p; p = p.parentElement) if (p.hasAttribute('data-composition-src')) start += Number(p.getAttribute('data-start') || 0)
    return { start, duration: Number(el.getAttribute('data-duration') || 0) }
  })
  const times = starts.flatMap(({ start, duration }) => {
    const previousEnd = starts.filter((s) => s.start < start && s.start + s.duration > start).map((s) => s.start + s.duration)
    return [start - 0.2, start + 0.2, start + duration / 2, previousEnd.length ? (start + Math.min(...previousEnd)) / 2 : start + 0.3]
  })
  const tl = window.__timelines?.main
  for (const tween of tl?.getChildren?.(true, true, false) ?? []) {
    const d = tween.duration()
    if (d > 0 && d <= 1.2) times.push(tween.globalTime(d / 2) - tl.globalTime(0))
  }
  return [...new Set(times)].filter((t) => Number.isFinite(t) && t >= 0).sort((a, b) => a - b).slice(0, 64)
}
