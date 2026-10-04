// "Agente" falso: reproduce un guion ya resuelto (script.resolved.json). Solo JS plano,
// sin CPU: todo son temporizadores. Lanza hijos reales (node + sleep) para probar limpieza.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const script = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const marker = process.argv[3] ?? "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const emit = (o) => process.stdout.write(JSON.stringify({ seq: seq++, ...o }) + "\n");
const SLEEPER = "setInterval(()=>{},1000);setTimeout(()=>process.exit(0),120000)";

fs.mkdirSync(process.env.HOME, { recursive: true });
fs.writeFileSync(path.join(process.env.HOME, ".fake-agent-state"), "ok");

const kids = [];
for (let i = 0; i < script.children; i++) kids.push(spawn(process.execPath, ["-e", SLEEPER, marker], { stdio: "ignore" }));

const fail = script.failure;
const failAt = fail ? (fail.atEvent ?? script.events.length) : -1;

async function trigger() {
  if (fail.kind === "rate_limit") {
    emit({ type: "error", code: "rate_limit", message: "token rate limit reached, retry later" });
    console.error("429 token rate limit");
    process.exit(1);
  }
  if (fail.kind === "crash") {
    console.error("fatal: simulated crash");
    process.exit(2);
  }
  if (fail.kind === "hang") {
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  if (fail.kind === "orphan") {
    const o = spawn(process.execPath, ["-e", SLEEPER, marker], { stdio: "ignore", detached: true });
    o.unref();
    emit({ type: "note", name: "orphan_spawned" });
    await sleep(400);
    // sale "con éxito" dejando al huérfano vivo; la limpieza debe encontrarlo
    process.exit(0);
  }
}

if (script.leakSecretEnv) {
  const v = process.env[script.leakSecretEnv] ?? "";
  emit({ type: "message", name: "leak", text: `my key is ${v}` });
  console.error(`debug key=${v}`);
}

for (let i = 0; i < script.events.length; i++) {
  if (fail && failAt === i) await trigger();
  const e = script.events[i];
  if (e.delayMs) await sleep(e.delayMs);
  emit({ type: e.type, name: e.name ?? null, text: e.text ?? null, read: e.read ?? null });
}
if (fail && failAt >= script.events.length) await trigger();

if (script.patch) {
  const changed = [];
  for (const [rel, content] of Object.entries(script.patch.write)) {
    const p = path.resolve(process.cwd(), rel);
    if (!p.startsWith(process.cwd() + path.sep)) throw new Error("fuera del ws: " + rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    changed.push(rel);
  }
  for (const rel of script.patch.delete) {
    fs.rmSync(path.resolve(process.cwd(), rel), { force: true });
    changed.push(rel);
  }
  emit({ type: "patch", files: changed });
}
if (script.usage) emit({ type: "usage", ...script.usage });
emit({ type: "done" });
for (const k of kids) k.kill("SIGKILL");
