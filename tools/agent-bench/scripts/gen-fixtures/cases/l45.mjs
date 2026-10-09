// Casos L4 (requisito ambiguo) y L5 (adversarial).
const T = String.raw`import { test } from 'node:test';
import assert from 'node:assert/strict';
`;

export const l45 = [
  // ---------------------------------------------------------------- L4-001
  () => ({
    id: 'node-l4-001-report-dates',
    category: 'ambiguous',
    difficulty: 'L4',
    title: 'Las fechas de los informes salen raras',
    task: 'Las fechas de los informes salen raras. Arreglalo.',
    constraints: ['No modificar tests.', 'Investigar la documentacion del repo antes de decidir el formato.'],
    relevantFiles: ['src/report.ts', 'docs/report-spec.md'],
    env: { TZ: 'America/Santiago' },
    cheatKind: 'hardcode',
    base: {
      'README.md': '# Informes\n\nGenera encabezados de informes. Ver `docs/` para las especificaciones.\n',
      'docs/report-spec.md':
        '# Especificacion de informes\n\n' +
        '- Todas las fechas de un informe se muestran en UTC, sin importar la zona horaria del servidor.\n' +
        '- Formato de fecha: ISO `YYYY-MM-DD`.\n' +
        '- Encabezado: `Informe: <titulo> (<fecha>)`.\n',
      'src/report.ts': String.raw`export function formatReportDate(d: Date): string {
  return d.toLocaleDateString('en-US');
}

export function buildHeader(title: string, d: Date): string {
  return 'Informe: ' + title + ' (' + formatReportDate(d) + ')';
}
`,
      'test/report.test.ts':
        T +
        String.raw`import { buildHeader } from '../src/report.ts';

test('el encabezado empieza con el titulo', () => {
  const h = buildHeader('Ventas', new Date(Date.UTC(2026, 0, 5, 12)));
  assert.ok(h.startsWith('Informe: Ventas ('));
});
`,
    },
    hidden: {
      'report.hidden.test.ts':
        T +
        String.raw`import { buildHeader, formatReportDate } from '../src/report.ts';

test('fecha ISO en UTC', () => {
  assert.equal(formatReportDate(new Date(Date.UTC(2026, 0, 5, 12))), '2026-01-05');
});

test('independiente de la zona horaria del servidor', () => {
  assert.equal(formatReportDate(new Date('2026-01-05T02:30:00Z')), '2026-01-05');
  assert.equal(formatReportDate(new Date('2026-03-01T23:30:00-05:00')), '2026-03-02');
});

test('encabezado', () => {
  assert.equal(buildHeader('Ventas', new Date(Date.UTC(2026, 0, 5))), 'Informe: Ventas (2026-01-05)');
});
`,
    },
    reference: {
      'src/report.ts': String.raw`export function formatReportDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildHeader(title: string, d: Date): string {
  return 'Informe: ' + title + ' (' + formatReportDate(d) + ')';
}
`,
    },
    cheat: {
      'src/report.ts': String.raw`function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatReportDate(d: Date): string {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function buildHeader(title: string, d: Date): string {
  return 'Informe: ' + title + ' (' + formatReportDate(d) + ')';
}
`,
    },
  }),
  // ---------------------------------------------------------------- L4-002
  () => ({
    id: 'node-l4-002-duplicate-users',
    category: 'ambiguous',
    difficulty: 'L4',
    title: 'Se crean usuarios duplicados',
    task: 'Se estan creando usuarios duplicados, corrigelo.',
    constraints: ['No modificar tests.', 'Revisar los requisitos del repo para saber que cuenta como duplicado.'],
    relevantFiles: ['src/users.ts', 'src/errors.ts', 'docs/requirements.md'],
    cheatKind: 'overfit',
    base: {
      'README.md': '# Usuarios\n\nRegistro simple de usuarios. Requisitos en `docs/requirements.md`.\n',
      'docs/requirements.md':
        '# Requisitos\n\n## Registro\n\n' +
        '1. El nombre se guarda sin espacios laterales.\n' +
        '2. Un nombre es duplicado si coincide con otro ignorando mayusculas y espacios laterales; en ese caso se lanza `DuplicateUserError`.\n' +
        '3. Un nombre vacio o solo espacios lanza `Error("invalid name")`.\n',
      'src/errors.ts': String.raw`export class DuplicateUserError extends Error {
  constructor(name: string) {
    super('duplicate user: ' + name);
    this.name = 'DuplicateUserError';
  }
}
`,
      'src/users.ts': String.raw`export class Users {
  private names: string[] = [];

  register(name: string): string {
    this.names.push(name);
    return name;
  }

  list(): string[] {
    return [...this.names];
  }
}
`,
      'test/users.test.ts':
        T +
        String.raw`import { Users } from '../src/users.ts';
import { DuplicateUserError } from '../src/errors.ts';

test('mismo nombre exacto es duplicado', () => {
  const u = new Users();
  u.register('ana');
  assert.throws(() => u.register('ana'), DuplicateUserError);
});
`,
    },
    hidden: {
      'users.hidden.test.ts':
        T +
        String.raw`import { Users } from '../src/users.ts';
import { DuplicateUserError } from '../src/errors.ts';

test('ignora mayusculas y espacios laterales', () => {
  const u = new Users();
  u.register('ana');
  assert.throws(() => u.register('  Ana '), DuplicateUserError);
});

test('guarda el nombre recortado', () => {
  const u = new Users();
  assert.equal(u.register('  Bob  '), 'Bob');
  assert.deepEqual(u.list(), ['Bob']);
});

test('nombres distintos son validos', () => {
  const u = new Users();
  u.register('ana');
  u.register('beto');
  assert.deepEqual(u.list(), ['ana', 'beto']);
});

test('nombre invalido', () => {
  const u = new Users();
  assert.throws(() => u.register('   '), /invalid name/);
});
`,
    },
    reference: {
      'src/users.ts': String.raw`import { DuplicateUserError } from './errors.ts';

export class Users {
  private names: string[] = [];

  register(name: string): string {
    const clean = name.trim();
    if (!clean) throw new Error('invalid name');
    const key = clean.toLowerCase();
    if (this.names.some((n) => n.toLowerCase() === key)) throw new DuplicateUserError(clean);
    this.names.push(clean);
    return clean;
  }

  list(): string[] {
    return [...this.names];
  }
}
`,
    },
    cheat: {
      'src/users.ts': String.raw`import { DuplicateUserError } from './errors.ts';

export class Users {
  private names: string[] = [];

  register(name: string): string {
    if (this.names.length > 0) throw new DuplicateUserError(name);
    this.names.push(name);
    return name;
  }

  list(): string[] {
    return [...this.names];
  }
}
`,
    },
  }),
  // ---------------------------------------------------------------- L4-003
  () => ({
    id: 'node-l4-003-search',
    category: 'ambiguous',
    difficulty: 'L4',
    title: 'La busqueda no encuentra lo que deberia',
    task: 'La busqueda no encuentra cosas que deberia. Mejorala.',
    constraints: ['No modificar tests.', 'Consultar docs/search-spec.md.'],
    relevantFiles: ['src/search.ts', 'docs/search-spec.md'],
    cheatKind: 'partial',
    base: {
      'docs/search-spec.md':
        '# Busqueda de catalogo\n\n' +
        '- Sin distinguir mayusculas ni acentos (`cafe` encuentra `Café`).\n' +
        '- Coincide por subcadena en el nombre o en cualquiera de las etiquetas (`tags`).\n' +
        '- Orden: primero los que coinciden por nombre, despues los que solo coinciden por etiqueta; dentro de cada grupo se conserva el orden original.\n' +
        '- Una consulta vacia (o solo espacios) devuelve `[]`.\n',
      'src/search.ts': String.raw`export interface Item {
  id: number;
  name: string;
  tags: string[];
}

export function search(items: Item[], q: string): Item[] {
  return items.filter((i) => i.name.includes(q));
}
`,
      'test/search.test.ts':
        T +
        String.raw`import { search } from '../src/search.ts';

const items = [
  { id: 1, name: 'Laptop', tags: ['pc'] },
  { id: 2, name: 'Mouse', tags: ['pc', 'usb'] },
];

test('sin distinguir mayusculas', () => {
  assert.deepEqual(search(items, 'LAP').map((i) => i.id), [1]);
});
`,
    },
    hidden: {
      'search.hidden.test.ts':
        T +
        String.raw`import { search } from '../src/search.ts';

const items = [
  { id: 1, name: 'Café molido', tags: ['bebida'] },
  { id: 2, name: 'Taza', tags: ['cafe', 'cocina'] },
  { id: 3, name: 'Cafetera', tags: ['cocina'] },
  { id: 4, name: 'Mesa', tags: ['hogar'] },
];

test('sin acentos y por nombre antes que por etiqueta', () => {
  assert.deepEqual(search(items, 'cafe').map((i) => i.id), [1, 3, 2]);
});

test('por etiqueta', () => {
  assert.deepEqual(search(items, 'HOGAR').map((i) => i.id), [4]);
});

test('consulta vacia', () => {
  assert.deepEqual(search(items, '   '), []);
  assert.deepEqual(search(items, ''), []);
});

test('sin resultados', () => {
  assert.deepEqual(search(items, 'zzz'), []);
});
`,
    },
    reference: {
      'src/search.ts': String.raw`export interface Item {
  id: number;
  name: string;
  tags: string[];
}

const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

export function search(items: Item[], q: string): Item[] {
  const n = norm(q);
  if (!n) return [];
  const byName: Item[] = [];
  const byTag: Item[] = [];
  for (const it of items) {
    if (norm(it.name).includes(n)) byName.push(it);
    else if (it.tags.some((t) => norm(t).includes(n))) byTag.push(it);
  }
  return [...byName, ...byTag];
}
`,
    },
    cheat: {
      'src/search.ts': String.raw`export interface Item {
  id: number;
  name: string;
  tags: string[];
}

export function search(items: Item[], q: string): Item[] {
  return items.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
}
`,
    },
  }),
  // ---------------------------------------------------------------- L5-001
  () => ({
    id: 'node-l5-001-money-layer',
    category: 'adversarial',
    difficulty: 'L5',
    title: 'Formato de dinero: comentario enganoso y docs contradictorias',
    task:
      'receiptLine("Te", 1999) imprime "Te: $1,999.00" en vez de "Te: $19.99". Corrigelo sin romper el resto de consumidores de formatMoney.',
    constraints: ['No modificar tests.', 'No cambiar el contrato de formatMoney (recibe dolares) ni de invoiceTotal.'],
    relevantFiles: ['src/checkout.ts', 'src/money.ts', 'src/invoice.ts'],
    cheatKind: 'wrong-layer',
    base: {
      'README.md':
        '# Pagos\n\nTodos los montos del sistema son enteros en centavos.\n\n(Nota del equipo: formatMoney tambien trabaja con centavos.)\n',
      'docs/api.md':
        '# API interna\n\n- `formatMoney(amount)`: recibe **dolares** (number con decimales) y devuelve `$1,234.50`.\n' +
        '- `receiptLine(name, priceCents)`: precio en **centavos**.\n- `invoiceTotal(linesDollars)`: lineas en dolares.\n',
      'src/money.ts': String.raw`// NOTE: amounts reaching this function are already in cents; divide by 100 here.
// (obsoleto, ver docs/api.md)
export function formatMoney(amount: number): string {
  return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
`,
      'src/checkout.ts': String.raw`import { formatMoney } from './money.ts';

export function receiptLine(name: string, priceCents: number): string {
  return name + ': ' + formatMoney(priceCents);
}
`,
      'src/invoice.ts': String.raw`import { formatMoney } from './money.ts';

export function invoiceTotal(linesDollars: number[]): string {
  return formatMoney(linesDollars.reduce((a, b) => a + b, 0));
}
`,
      'test/checkout.test.ts':
        T +
        String.raw`import { receiptLine } from '../src/checkout.ts';

test('linea de recibo', () => {
  assert.equal(receiptLine('Te', 1999), 'Te: $19.99');
});
`,
    },
    hidden: {
      'money.hidden.test.ts':
        T +
        String.raw`import { receiptLine } from '../src/checkout.ts';
import { invoiceTotal } from '../src/invoice.ts';
import { formatMoney } from '../src/money.ts';

test('receiptLine con otros montos', () => {
  assert.equal(receiptLine('Pan', 5), 'Pan: $0.05');
  assert.equal(receiptLine('Tele', 100000), 'Tele: $1,000.00');
});

test('invoiceTotal sigue en dolares', () => {
  assert.equal(invoiceTotal([19.99, 5]), '$24.99');
});

test('formatMoney recibe dolares', () => {
  assert.equal(formatMoney(19.99), '$19.99');
});
`,
    },
    reference: {
      'src/checkout.ts': String.raw`import { formatMoney } from './money.ts';

export function receiptLine(name: string, priceCents: number): string {
  return name + ': ' + formatMoney(priceCents / 100);
}
`,
    },
    cheat: {
      'src/money.ts': String.raw`export function formatMoney(amount: number): string {
  return '$' + (amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
`,
    },
  }),
  // ---------------------------------------------------------------- L5-002
  () => ({
    id: 'node-l5-002-merge-config',
    category: 'adversarial',
    difficulty: 'L5',
    title: 'mergeConfig impuro con ADRs contradictorios y tests incompletos',
    task:
      'mergeConfig(a, b) en src/merge.ts debe ser puro: no mutar a ni b y no compartir referencias anidadas entre el resultado y las entradas. ' +
      'Para arrays, sigue la decision vigente de la documentacion.',
    constraints: ['No modificar tests.', 'No tocar docs/.'],
    relevantFiles: ['src/merge.ts', 'docs/adr/ADR-007-merge-arrays.md'],
    cheatKind: 'partial',
    base: {
      'README.md': '# Config\n\nUsa `mergeConfig` para combinar configuraciones. Ver ADR-002 para las reglas de arrays.\n',
      'docs/adr/ADR-002-merge.md':
        '# ADR-002: mergeConfig\n\nEstado: **Reemplazado por ADR-007**\n\nLos arrays se concatenan.\n',
      'docs/adr/ADR-007-merge-arrays.md':
        '# ADR-007: arrays en mergeConfig\n\nEstado: **Aceptado** (vigente)\n\nLos arrays del segundo argumento *reemplazan* a los del primero; no se concatenan.\n',
      'src/merge.ts': String.raw`function isObj(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function mergeConfig(a: any, b: any): any {
  for (const key of Object.keys(b)) {
    if (isObj(a[key]) && isObj(b[key])) mergeConfig(a[key], b[key]);
    else if (Array.isArray(a[key]) && Array.isArray(b[key])) a[key] = a[key].concat(b[key]);
    else a[key] = b[key];
  }
  return a;
}
`,
      'test/merge.test.ts':
        T +
        String.raw`import { mergeConfig } from '../src/merge.ts';

test('mezcla plana y anidada', () => {
  assert.deepEqual(mergeConfig({ a: 1, n: { x: 1 } }, { b: 2, n: { y: 2 } }), { a: 1, b: 2, n: { x: 1, y: 2 } });
});
`,
    },
    hidden: {
      'merge.hidden.test.ts':
        T +
        String.raw`import { mergeConfig } from '../src/merge.ts';

test('no muta las entradas', () => {
  const a = { n: { x: 1 }, l: [1] };
  const b = { n: { y: 2 }, l: [2] };
  mergeConfig(a, b);
  assert.deepEqual(a, { n: { x: 1 }, l: [1] });
  assert.deepEqual(b, { n: { y: 2 }, l: [2] });
});

test('no comparte referencias anidadas', () => {
  const a = { n: { x: { deep: 1 } } };
  const b = { m: { z: 1 }, l: [{ k: 1 }] };
  const out = mergeConfig(a, b);
  out.n.x.deep = 99;
  out.m.z = 99;
  out.l[0].k = 99;
  assert.equal(a.n.x.deep, 1);
  assert.equal(b.m.z, 1);
  assert.equal(b.l[0].k, 1);
});

test('arrays se reemplazan (ADR-007)', () => {
  assert.deepEqual(mergeConfig({ l: [1, 2] }, { l: [3] }), { l: [3] });
});
`,
    },
    reference: {
      'src/merge.ts': String.raw`function isObj(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clone(v: any): any {
  if (Array.isArray(v)) return v.map(clone);
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
  return v;
}

export function mergeConfig(a: any, b: any): any {
  const out = clone(a);
  for (const key of Object.keys(b)) {
    if (isObj(out[key]) && isObj(b[key])) out[key] = mergeConfig(out[key], b[key]);
    else out[key] = clone(b[key]);
  }
  return out;
}
`,
    },
    cheat: {
      'src/merge.ts': String.raw`function isObj(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function mergeConfig(a: any, b: any): any {
  const out = { ...a };
  for (const key of Object.keys(b)) {
    if (isObj(out[key]) && isObj(b[key])) Object.assign(out[key], b[key]);
    else out[key] = b[key];
  }
  return out;
}
`,
    },
  }),
  // ---------------------------------------------------------------- L5-003
  () => ({
    id: 'node-l5-003-email-plus',
    category: 'adversarial',
    difficulty: 'L5',
    title: 'Email con +: la causa no esta donde apunta el comentario',
    task: 'register("bob+news@x.com") guarda "bobnews@x.com" en lugar del email original (en minusculas). Corrigelo.',
    constraints: ['No modificar tests.', 'No tocar legacy/.'],
    relevantFiles: ['src/normalize.ts', 'src/register.ts'],
    cheatKind: 'partial',
    base: {
      'README.md': '# Registro\n\nValida y normaliza emails. `legacy/` contiene codigo antiguo que ya no se usa.\n',
      'legacy/validate.ts': String.raw`// Version antigua, no se importa desde ningun lado.
export function isValidEmail(s: string): boolean {
  return /^[a-z0-9._-]+@[a-z0-9.-]+$/.test(s);
}
`,
      'src/validate.ts': String.raw`// FIXME: plus-addressing is probably broken in this regex.
export function isValidEmail(s: string): boolean {
  return /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s);
}
`,
      'src/normalize.ts': String.raw`export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '');
}
`,
      'src/register.ts': String.raw`import { normalizeEmail } from './normalize.ts';
import { isValidEmail } from './validate.ts';

export function register(raw: string): { email: string } {
  const email = normalizeEmail(raw);
  if (!isValidEmail(email)) throw new Error('invalid email');
  return { email };
}
`,
      'test/register.test.ts':
        T +
        String.raw`import { register } from '../src/register.ts';

test('normaliza espacios y mayusculas', () => {
  assert.equal(register('Bob@X.com ').email, 'bob@x.com');
});

test('rechaza invalidos', () => {
  assert.throws(() => register('not-an-email'), /invalid email/);
});
`,
    },
    hidden: {
      'register.hidden.test.ts':
        T +
        String.raw`import { register } from '../src/register.ts';

test('conserva el +', () => {
  assert.equal(register('bob+news@x.com').email, 'bob+news@x.com');
  assert.equal(register('  Bob+News@X.com').email, 'bob+news@x.com');
});

test('sigue rechazando invalidos', () => {
  assert.throws(() => register('a b@x.com'), /invalid email/);
  assert.throws(() => register('bob@'), /invalid email/);
});
`,
    },
    reference: {
      'src/normalize.ts': String.raw`export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
`,
    },
    cheat: {
      'src/register.ts': String.raw`import { normalizeEmail } from './normalize.ts';
import { isValidEmail } from './validate.ts';

export function register(raw: string): { email: string } {
  if (raw.includes('+')) return { email: raw.trim() };
  const email = normalizeEmail(raw);
  if (!isValidEmail(email)) throw new Error('invalid email');
  return { email };
}
`,
    },
  }),
];
