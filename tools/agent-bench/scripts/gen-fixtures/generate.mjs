#!/usr/bin/env node
// Generador determinista de casos Node/TS.
// Uso: node scripts/gen-fixtures/generate.mjs [--seed N] [--out DIR] [--only ID]
// Salida por caso: case.json, repo/ (base + tests visibles), hidden/ (tests ocultos),
// reference.patch, cheat.patch. Sin red, sin dependencias npm.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { hashSeed, rng, pkgJson } from './lib.mjs';
import { l12 } from './cases/l12.mjs';
import { l3 } from './cases/l3.mjs';
import { l45 } from './cases/l45.mjs';
import { ctx } from './cases/ctx.mjs';

export const DEFAULT_SEED = 20260101;
const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT = resolve(HERE, '../../benchmarks/node');

export const DEFAULT_ALLOWED = ['src/**', 'docs/**', 'README.md'];
export const DEFAULT_FORBIDDEN = ['test/**', 'test-hidden/**', 'package.json', 'legacy/**'];

function git(cwd, args) {
  const r = spawnSync('perl', ['-e', 'alarm shift; exec @ARGV', '30', 'git', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' fallo: ' + r.stderr);
  return r.stdout;
}

function writeTree(dir, files) {
  for (const [p, c] of Object.entries(files)) {
    const f = join(dir, p);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, c);
  }
}

// Parche determinista: repo temporal con la base, aplica cambios, git diff.
function makePatch(tmpRoot, base, changes) {
  const dir = mkdtempSync(join(tmpRoot, 'p-'));
  try {
    git(dir, ['init', '-q']);
    writeTree(dir, base);
    git(dir, ['add', '-A']);
    git(dir, ['-c', 'user.name=ab', '-c', 'user.email=ab@local', 'commit', '-q', '-m', 'base']);
    for (const [p, c] of Object.entries(changes)) {
      if (c === null) rmSync(join(dir, p), { force: true });
      else writeTree(dir, { [p]: c });
    }
    git(dir, ['add', '-A']);
    return git(dir, ['diff', '--cached', '--no-color', '--no-ext-diff']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const ALL = [...l12, ...l3, ...l45, ...ctx];

export function generateAll({ seed = DEFAULT_SEED, outDir = DEFAULT_OUT, only } = {}) {
  const tmpRoot = join(homedir(), 'ab', 'gen');
  mkdirSync(tmpRoot, { recursive: true });
  const written = [];
  for (const build of ALL) {
    // El id es estable: se calcula con un rng de prueba solo para leerlo.
    const probe = build(rng(1));
    if (only && probe.id !== only) continue;
    const c = build(rng(hashSeed(seed, probe.id)));
    if (c.id !== probe.id) throw new Error('id inestable: ' + probe.id);
    const base = { 'package.json': pkgJson(c.id), ...c.base };
    const caseDir = join(outDir, c.id);
    rmSync(caseDir, { recursive: true, force: true });
    writeTree(join(caseDir, 'repo'), base);
    writeTree(join(caseDir, 'hidden'), c.hidden);
    writeFileSync(join(caseDir, 'reference.patch'), makePatch(tmpRoot, base, c.reference));
    writeFileSync(join(caseDir, 'cheat.patch'), makePatch(tmpRoot, base, c.cheat));
    const env = c.env ?? {};
    const meta = {
      schemaVersion: '1',
      id: c.id,
      category: c.category,
      difficulty: c.difficulty,
      language: 'typescript',
      title: c.title,
      seed,
      task: c.task,
      constraints: c.constraints,
      files: { allowed: c.allowed ?? DEFAULT_ALLOWED, forbidden: c.forbidden ?? DEFAULT_FORBIDDEN },
      relevantFiles: c.relevantFiles,
      repo: 'repo',
      hiddenDir: 'hidden',
      hiddenInject: 'test-hidden',
      referencePatch: 'reference.patch',
      cheatPatch: 'cheat.patch',
      cheatKind: c.cheatKind,
      evaluators: [
        { type: 'tests-visible', command: ['node', '--test', 'test/**/*.test.ts'], env, timeoutSec: 60 },
        { type: 'tests-hidden', command: ['node', '--test', 'test-hidden/**/*.test.ts'], env, timeoutSec: 60 },
        { type: 'restrictions' },
        { type: 'anti-cheat', protectedPaths: c.forbidden ?? DEFAULT_FORBIDDEN },
      ],
    };
    writeFileSync(join(caseDir, 'case.json'), JSON.stringify(meta, null, 2) + '\n');
    written.push(c.id);
  }
  return written;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const ids = generateAll({
    seed: get('--seed') ? Number(get('--seed')) : DEFAULT_SEED,
    outDir: get('--out') ? resolve(get('--out')) : DEFAULT_OUT,
    only: get('--only'),
  });
  console.log(`generados ${ids.length} casos`);
}
