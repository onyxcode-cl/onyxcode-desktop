#!/usr/bin/env node
// Valida los casos de benchmarks/node (o --dir):
//  - base: falla (tests ocultos fallan; los visibles pueden pasar o no)
//  - referencia: pasa visibles y ocultos, sin violar restricciones
//  - tramposo: detectado (ocultos fallan o anti-cheat/restricciones violadas)
// Uso: node scripts/validate-cases.mjs [--dir DIR] [--only ID] [--keep]
// Trabaja en ~/ab/validate/<pid>/ y lo elimina al terminar.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const get = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const dir = resolve(get('--dir') ?? join(HERE, '../benchmarks/node'));
const only = get('--only');
const keep = args.includes('--keep');
const work = join(homedir(), 'ab', 'validate', String(process.pid));

function run(cwd, cmd, env = {}, timeoutSec = 60) {
  const r = spawnSync('perl', ['-e', 'alarm shift; exec @ARGV', String(timeoutSec), ...cmd], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    maxBuffer: 16 * 1024 * 1024,
  });
  return { ok: r.status === 0, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

function globToRe(g) {
  let s = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      s += '.*';
      i++;
      if (g[i + 1] === '/') i++;
    } else if (c === '*') s += '[^/]*';
    else s += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + s + '$');
}
const matches = (globs, f) => globs.some((g) => globToRe(g).test(f));

function patchFiles(patchText) {
  const out = new Set();
  for (const m of patchText.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)) out.add(m[2]);
  return [...out];
}

function evaluate(c, caseDir, repoDir, patchText) {
  const vis = c.evaluators.find((e) => e.type === 'tests-visible');
  const hid = c.evaluators.find((e) => e.type === 'tests-hidden');
  const files = patchText ? patchFiles(patchText) : [];
  const violations = [];
  for (const f of files) {
    if (matches(c.files.forbidden, f)) violations.push('prohibido:' + f);
    else if (!matches(c.files.allowed, f)) violations.push('fuera-de-permitidos:' + f);
  }
  const visible = run(repoDir, vis.command, vis.env, vis.timeoutSec);
  // Los ocultos se inyectan solo despues, en un directorio aparte del arbol del agente.
  cpSync(join(caseDir, c.hiddenDir), join(repoDir, c.hiddenInject), { recursive: true });
  const hidden = run(repoDir, hid.command, hid.env, hid.timeoutSec);
  return { visible: visible.ok, hidden: hidden.ok, violations, hiddenOut: hidden.out, visibleOut: visible.out };
}

function applyPatch(repoDir, patchFile) {
  const r = run(repoDir, ['git', 'apply', '--whitespace=nowarn', patchFile], {}, 30);
  if (!r.ok) throw new Error('git apply fallo: ' + r.out);
}

function validateCase(id) {
  const caseDir = join(dir, id);
  const c = JSON.parse(readFileSync(join(caseDir, 'case.json'), 'utf8'));
  const problems = [];
  const info = {};
  const fresh = (name) => {
    const d = join(work, id, name);
    cpSync(join(caseDir, c.repo), d, { recursive: true });
    return d;
  };

  const base = evaluate(c, caseDir, fresh('base'), '');
  info.base = base;
  if (base.hidden) problems.push('base: los ocultos pasan (deberian fallar)');

  const refPatchPath = join(caseDir, c.referencePatch);
  const refDir = fresh('ref');
  applyPatch(refDir, refPatchPath);
  const ref = evaluate(c, caseDir, refDir, readFileSync(refPatchPath, 'utf8'));
  info.ref = ref;
  if (!ref.visible) problems.push('referencia: visibles fallan\n' + ref.visibleOut.slice(-800));
  if (!ref.hidden) problems.push('referencia: ocultos fallan\n' + ref.hiddenOut.slice(-800));
  if (ref.violations.length) problems.push('referencia: viola restricciones ' + ref.violations.join(','));

  const chPatchPath = join(caseDir, c.cheatPatch);
  const chDir = fresh('cheat');
  applyPatch(chDir, chPatchPath);
  const ch = evaluate(c, caseDir, chDir, readFileSync(chPatchPath, 'utf8'));
  info.cheat = ch;
  const detected = !ch.hidden || ch.violations.length > 0;
  if (!detected) problems.push('tramposo: NO detectado (ocultos pasan y sin violaciones)');
  if (!ch.visible && ch.hidden) problems.push('tramposo: ni siquiera pasa visibles (parche poco util)');

  const how = [!ch.hidden ? 'ocultos' : null, ch.violations.length ? 'anti-cheat' : null].filter(Boolean).join('+');
  return { id, problems, summary: `base[vis=${base.visible ? 'pasa' : 'falla'} hid=${base.hidden ? 'pasa' : 'falla'}] ref[vis=${ref.visible ? 'ok' : 'FALLA'} hid=${ref.hidden ? 'ok' : 'FALLA'}] tramposo[vis=${ch.visible ? 'pasa' : 'falla'} detectado=${how || 'NO'}]` };
}

const ids = readdirSync(dir)
  .filter((d) => existsSync(join(dir, d, 'case.json')))
  .filter((d) => !only || d === only)
  .sort();
mkdirSync(work, { recursive: true });
let failed = 0;
try {
  for (const id of ids) {
    let res;
    try {
      res = validateCase(id);
    } catch (e) {
      res = { id, problems: [String(e.message ?? e)], summary: 'error' };
    }
    console.log(`${res.problems.length ? 'FALLO' : 'ok   '} ${id}  ${res.summary}`);
    for (const p of res.problems) console.log('   - ' + p);
    if (res.problems.length) failed++;
  }
} finally {
  if (!keep) rmSync(work, { recursive: true, force: true });
}
console.log(`\n${ids.length - failed}/${ids.length} casos validos`);
process.exit(failed ? 1 : 0);
