import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
// @ts-ignore: modulo .mjs sin tipos
import { generateAll, DEFAULT_SEED, DEFAULT_OUT } from '../../scripts/gen-fixtures/generate.mjs';

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function digest(dir: string): string {
  const h = createHash('sha256');
  for (const f of walk(dir)) h.update(relative(dir, f)).update(readFileSync(f));
  return h.digest('hex');
}

const base = join(homedir(), 'ab', 'gen-test');
mkdirSync(base, { recursive: true });

test('generador determinista: misma semilla, mismo resultado', () => {
  const a = mkdtempSync(join(base, 'a-'));
  const b = mkdtempSync(join(base, 'b-'));
  try {
    generateAll({ seed: DEFAULT_SEED, outDir: a });
    generateAll({ seed: DEFAULT_SEED, outDir: b });
    assert.equal(digest(a), digest(b));
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('los casos versionados coinciden con la semilla por defecto', () => {
  const a = mkdtempSync(join(base, 'c-'));
  try {
    generateAll({ seed: DEFAULT_SEED, outDir: a });
    for (const id of readdirSync(a)) {
      assert.equal(digest(join(a, id)), digest(join(DEFAULT_OUT, id)), id);
    }
  } finally {
    rmSync(a, { recursive: true, force: true });
  }
});

test('una semilla distinta cambia los repos grandes', () => {
  const a = mkdtempSync(join(base, 'd-'));
  try {
    generateAll({ seed: 7, outDir: a, only: 'node-ctx-001-billing-rounding' });
    assert.notEqual(
      digest(join(a, 'node-ctx-001-billing-rounding')),
      digest(join(DEFAULT_OUT, 'node-ctx-001-billing-rounding')),
    );
  } finally {
    rmSync(a, { recursive: true, force: true });
  }
});

test('20 menos 2 onyx: 18 casos, 3 por categoria, esquema basico', () => {
  const ids = readdirSync(DEFAULT_OUT).filter((d: string) => d.startsWith('node-'));
  assert.equal(ids.length, 18);
  const counts: Record<string, number> = {};
  for (const id of ids) {
    const c = JSON.parse(readFileSync(join(DEFAULT_OUT, id, 'case.json'), 'utf8'));
    assert.equal(c.schemaVersion, '1');
    assert.equal(c.id, id);
    for (const k of ['category', 'difficulty', 'task', 'constraints', 'files', 'evaluators']) assert.ok(c[k], k);
    counts[c.category] = (counts[c.category] ?? 0) + 1;
    const pkg = JSON.parse(readFileSync(join(DEFAULT_OUT, id, 'repo', 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.devDependencies, undefined);
  }
  assert.deepEqual(counts, { atomic: 3, local: 3, repository: 3, ambiguous: 3, adversarial: 3, context: 3 });
});
