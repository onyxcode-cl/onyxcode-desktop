// Utilidades del generador determinista de fixtures (sin dependencias).
import { createHash } from 'node:crypto';

export function hashSeed(seed, id) {
  const h = createHash('sha256').update(`${seed}:${id}`).digest();
  return h.readUInt32LE(0);
}

// mulberry32
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle: (arr) => {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

export function pkgJson(id) {
  return (
    JSON.stringify(
      {
        name: 'fx-' + id.toLowerCase(),
        version: '1.0.0',
        private: true,
        type: 'module',
        scripts: { test: 'node --test "test/**/*.test.ts"' },
      },
      null,
      2,
    ) + '\n'
  );
}

const NOUNS = [
  'alpha', 'bravo', 'cargo', 'delta', 'ember', 'fjord', 'gamma', 'harbor', 'ivory', 'jolt',
  'kernel', 'lumen', 'mosaic', 'nimbus', 'orbit', 'prism', 'quartz', 'ridge', 'sierra', 'tundra',
  'umbra', 'vertex', 'willow', 'xenon', 'yonder', 'zenith', 'anchor', 'beacon', 'canyon', 'dune',
  'echo', 'flint', 'glacier', 'horizon', 'island', 'junction', 'kite', 'lagoon', 'meadow', 'nebula',
];

// Repo "grande": N modulos de relleno con su test. Todo depende de la semilla.
export function filler(r, n) {
  const names = r.shuffle(NOUNS).slice(0, n).sort();
  const files = {};
  for (const name of names) {
    const k = r.int(2, 9);
    const off = r.int(1, 50);
    const max = r.int(20, 200);
    files[`src/modules/${name}/index.ts`] =
      `// Modulo ${name}: utilidades pequenas y puras.\n` +
      `export const ${name}Factor = ${k};\n\n` +
      `export function ${name}Score(n: number): number {\n  return n * ${k} + ${off};\n}\n\n` +
      `export function ${name}Label(n: number): string {\n  return '${name}-' + n;\n}\n\n` +
      `export function ${name}Clamp(n: number): number {\n  return Math.min(Math.max(n, 0), ${max});\n}\n`;
    files[`test/modules/${name}.test.ts`] =
      `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n` +
      `import { ${name}Score, ${name}Label, ${name}Clamp } from '../../src/modules/${name}/index.ts';\n\n` +
      `test('${name}: score', () => {\n  assert.equal(${name}Score(3), ${3 * k + off});\n});\n\n` +
      `test('${name}: label', () => {\n  assert.equal(${name}Label(7), '${name}-7');\n});\n\n` +
      `test('${name}: clamp', () => {\n  assert.equal(${name}Clamp(-5), 0);\n  assert.equal(${name}Clamp(100000), ${max});\n});\n`;
  }
  files['src/modules/index.ts'] =
    names.map((n) => `export * as ${n} from './${n}/index.ts';`).join('\n') + '\n';
  files['docs/ARCHITECTURE.md'] =
    '# Arquitectura\n\nEl repositorio se organiza en modulos pequenos bajo `src/modules/` (utilidades puras) ' +
    'y dominios de negocio en `src/<dominio>/`.\n\n## Modulos de utilidad\n\n' +
    names.map((n) => `- \`${n}\`: puntuacion, etiqueta y acotado numerico.`).join('\n') +
    '\n\nLos modulos de utilidad no tienen relacion con la logica de negocio.\n';
  return files;
}
