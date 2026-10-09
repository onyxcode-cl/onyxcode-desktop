export const REDACTED = "[REDACTED]";

const SECRET_KEY_RE = /(api[_-]?key|token|secret|passw(or)?d|authorization|auth[_-]?content|credential|cookie|private[_-]?key)/i;

const PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const ASSIGN_RE =
  /((?:api[_-]?key|token|secret|passw(?:or)?d|authorization|auth[_-]?content)["']?\s*[:=]\s*["']?)([^\s"',;}]{6,})/gi;

/** Redacta secretos conocidos dentro de un texto. */
export function redactText(text: string, extraSecrets: readonly string[] = []): string {
  let out = text;
  for (const s of extraSecrets) {
    if (s.length >= 6) out = out.split(s).join(REDACTED);
  }
  for (const re of PATTERNS) out = out.replace(re, REDACTED);
  out = out.replace(BEARER_RE, (_m, kind: string) => `${kind} ${REDACTED}`);
  out = out.replace(ASSIGN_RE, (_m, pre: string) => `${pre}${REDACTED}`);
  return out;
}

/** Redacta un objeto env: valores de claves sensibles se reemplazan. */
export function redactEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = v !== undefined && SECRET_KEY_RE.test(k) ? REDACTED : v === undefined ? v : redactText(v);
  }
  return out;
}

/** Redacta recursivamente cualquier valor JSON (no muta la entrada). */
export function redactDeep<T>(value: T, extraSecrets: readonly string[] = []): T {
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === "string") {
      if (key && SECRET_KEY_RE.test(key) && v.length > 0) return REDACTED;
      return redactText(v, extraSecrets);
    }
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x, k);
      return o;
    }
    return v;
  };
  return walk(value) as T;
}

/** true si el texto aún contiene algo con forma de secreto (para tests de artefactos). */
export function containsSecret(text: string, extraSecrets: readonly string[] = []): boolean {
  return redactText(text, extraSecrets) !== text;
}
