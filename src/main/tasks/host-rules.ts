/**
 * Validador de hosts para la lista blanca de red de Tareas (F8-B69, hallazgo 7). `hostAllowed` da por bueno
 * el host y TODOS sus subdominios, así que un TLD suelto (`com`), un sufijo público (`co.uk`) o un comodín
 * sin dominio (`*`, `*.com`) abriría media Internet. También se rechazan las IP locales/privadas y los
 * nombres internos (`localhost`, `.local`, `.internal`): el sandbox no debe llegar a la red del usuario.
 */
import { isIP } from 'node:net'
import { isLocalHostname } from '../embedded-browser/ip-class'

/** Sufijos públicos de dos etiquetas más comunes (no hay lista pública empaquetada: cubre los habituales). */
const PUBLIC_SUFFIX_2 = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'co.nz',
  'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'co.in', 'com.br', 'com.ar', 'com.mx', 'com.cl', 'com.pe', 'com.co',
  'com.cn', 'net.cn', 'org.cn', 'com.tw', 'com.hk', 'com.sg', 'com.tr', 'com.ua', 'co.za', 'co.id', 'co.il',
  'github.io', 'herokuapp.com', 'appspot.com', 'blogspot.com', 'pages.dev', 'workers.dev', 'vercel.app',
  'netlify.app', 'web.app', 'firebaseapp.com',
  'azurewebsites.net', 'onrender.com', 'fly.dev', 'repl.co'
])
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * Host normalizado (minúsculas, sin punto final) o `null` si no es un destino aceptable. Admite un único
 * `*.` inicial seguido de un dominio registrable (al menos dos etiquetas y que no sea un sufijo público).
 */
export function parseEgressHost(input: string): string | null {
  if (typeof input !== 'string' || input.length === 0 || input.length > 255) return null
  let h = input.trim().toLowerCase()
  if (h !== input.toLowerCase()) return null // espacios alrededor: no se corrigen en silencio
  while (h.endsWith('.')) h = h.slice(0, -1)
  const wildcard = h.startsWith('*.')
  const name = wildcard ? h.slice(2) : h
  if (!name || name.length > 253 || name.includes('*')) return null
  if (isIP(name)) {
    if (wildcard) return null
    return isLocalHostname(name) ? null : name
  }
  // Nada de IPv6 entre corchetes, números sueltos ni notaciones raras de IPv4.
  if (/^[0-9.]+$/.test(name) || name.includes(':') || name.includes('[')) return null
  const labels = name.split('.')
  if (labels.length < 2) return null // TLD suelto (`com`, `io`) o nombre de una sola etiqueta (`localhost`)
  if (!labels.every((l) => LABEL.test(l))) return null
  if (PUBLIC_SUFFIX_2.has(name)) return null
  if (isLocalHostname(name)) return null
  return wildcard ? `*.${name}` : name
}

/** Para retirar (`unset`) o bloquear entradas: forma mínima, sin las reglas de TLD (hay entradas heredadas). */
export function isPlainHostToken(input: string): boolean {
  return typeof input === 'string' && /^(?:\*\.)?[a-z0-9._-]{1,253}$/i.test(input)
}
