// Binario SIMULADO de `opencode serve` (HTTP + SSE mínimo). NO es opencode real.
// Uso: node fake-opencode.ts <escenario> serve --port 0 --hostname 127.0.0.1
// Escenarios: ok | orphan | ratelimit | hang | slow | crash | error
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const argv = process.argv.slice(2);
if (argv[0] === "--version") {
  console.log("opencode 0.0.0-fake");
  process.exit(0);
}
const scenario = argv[0] ?? "ok";
const user = process.env.OPENCODE_SERVER_USERNAME ?? "";
const pass = process.env.OPENCODE_SERVER_PASSWORD ?? "";
const dataDir = join(process.env.XDG_DATA_HOME ?? ".", "opencode");
mkdirSync(dataDir, { recursive: true });
// evidencia de entorno para los tests (sin valores secretos)
writeFileSync(
  join(dataDir, "env-seen.json"),
  JSON.stringify({
    home: process.env.HOME,
    cwd: process.cwd(),
    keys: Object.keys(process.env).sort(),
    hasAuth: !!process.env.OPENCODE_AUTH_CONTENT,
    config: process.env.OPENCODE_CONFIG_CONTENT,
    configDir: process.env.OPENCODE_CONFIG_DIR,
  }),
);

const db = new DatabaseSync(join(dataDir, "opencode.db"));
db.exec(`CREATE TABLE session(id TEXT PRIMARY KEY, parent_id TEXT, title TEXT);
CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
CREATE TABLE part(id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);`);

const clients = new Set<ServerResponse>();
const send = (type: string, properties: unknown): void => {
  for (const c of clients) c.write(`data: ${JSON.stringify({ type, properties })}\n\n`);
};

const SID = "ses_main";
const CID = "ses_child";
let seq = 0;
const messages: Array<{ info: any; parts: any[] }> = [];
function addMsg(sessionId: string, info: any, parts: any[]): void {
  const id = `msg_${++seq}`;
  const full = { id, sessionID: sessionId, ...info };
  messages.push({ info: full, parts: parts.map((p, i) => ({ id: `prt_${seq}_${i}`, sessionID: sessionId, messageID: id, ...p })) });
  const t = Date.now() + seq;
  db.prepare("INSERT INTO message VALUES (?,?,?,?)").run(id, sessionId, t, JSON.stringify({ sessionID: sessionId, ...info }));
  parts.forEach((p, i) =>
    db.prepare("INSERT INTO part VALUES (?,?,?,?,?)").run(`prt_${seq}_${i}`, id, sessionId, t + i, JSON.stringify({ sessionID: sessionId, messageID: id, ...p })),
  );
}

function populate(): void {
  db.prepare("INSERT OR IGNORE INTO session VALUES (?,?,?)").run(SID, null, "main");
  db.prepare("INSERT OR IGNORE INTO session VALUES (?,?,?)").run(CID, SID, "child");
  const tokens = { input: 100, output: 50, reasoning: 10, cache: { read: 30, write: 5 } };
  addMsg(SID, { role: "user" }, [{ type: "text", text: "hola" }]);
  addMsg(SID, { role: "assistant", modelID: "fake", providerID: "fake", cost: 0.01, tokens }, [
    { type: "step-start" },
    { type: "tool", tool: "read", state: { status: "completed", input: { filePath: "src/a.ts" }, time: { start: 1000, end: 1040 } } },
    { type: "tool", tool: "bash", state: { status: "completed", input: { command: "npm test" }, time: { start: 1100, end: 1500 } } },
    { type: "tool", tool: "write", state: { status: "completed", input: { filePath: "hello.txt" }, time: { start: 1600, end: 1610 } } },
    { type: "tool", tool: "task", state: { status: "completed", input: {}, time: { start: 1700, end: 1900 } } },
    { type: "step-finish", cost: 0.01, tokens },
  ]);
  const ct = { input: 20, output: 5, reasoning: 0, cache: { read: 10, write: 0 } };
  addMsg(CID, { role: "assistant", cost: 0.002, tokens: ct }, [
    { type: "tool", tool: "read", state: { status: "completed", input: { filePath: "src/b.ts" }, time: { start: 1750, end: 1760 } } },
    { type: "step-finish", cost: 0.002, tokens: ct },
  ]);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function play(): Promise<void> {
  send("session.status", { sessionID: SID, status: { type: "busy" } });
  if (scenario === "crash") process.exit(3);
  if (scenario === "hang") return;
  if (scenario === "slow") {
    for (;;) {
      await sleep(30);
      send("message.part.updated", { part: { type: "text", sessionID: SID, text: "..." } });
    }
  }
  if (scenario === "ratelimit") {
    for (let i = 1; i <= 5; i++) {
      await sleep(20);
      send("session.status", { sessionID: SID, status: { type: "retry", attempt: i, message: "token rate limit exceeded, retrying", next: Date.now() + 1000 } });
    }
    return;
  }
  if (scenario === "error") {
    await sleep(20);
    send("session.error", { sessionID: SID, error: { name: "UnknownError", data: { message: "boom: modelo no disponible" } } });
    return;
  }
  if (scenario === "orphan") spawn("sleep", ["317"], { detached: true, stdio: "ignore" }).unref();
  await sleep(20);
  writeFileSync(join(process.cwd(), "hello.txt"), "hola\n");
  populate();
  send("message.part.updated", { part: { type: "tool", sessionID: SID, tool: "read" } });
  send("message.part.updated", { part: { type: "step-finish", sessionID: SID } });
  send("message.part.updated", { part: { type: "step-finish", sessionID: CID } }); // hijo: no cuenta
  send("session.idle", { sessionID: SID });
}

const server = createServer((req, res) => {
  const auth = req.headers.authorization ?? "";
  if (auth !== "Basic " + Buffer.from(`${user}:${pass}`).toString("base64")) {
    res.writeHead(401).end("unauthorized");
    return;
  }
  const url = req.url ?? "/";
  if (req.method === "GET" && url === "/event") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    clients.add(res);
    res.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);
    req.on("close", () => clients.delete(res));
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = (o: unknown): void => {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(o));
    };
    if (req.method === "POST" && url === "/session") return json({ id: SID });
    if (req.method === "POST" && url === `/session/${SID}/prompt_async`) {
      res.writeHead(204).end();
      void play();
      return;
    }
    if (req.method === "POST" && url === `/session/${SID}/abort`) {
      json(true);
      send("session.error", { sessionID: SID, error: { name: "MessageAbortedError", data: { message: "aborted" } } });
      return;
    }
    if (req.method === "GET" && url === `/session/${SID}/message`) return json(messages.filter((m) => m.info.sessionID === SID));
    if (req.method === "GET" && url === `/session/${SID}/diff`)
      return json([
        { file: "hello.txt", additions: 1, deletions: 0, status: "added" },
        { file: "src/a.ts", additions: 2, deletions: 1, status: "modified" },
      ]);
    res.writeHead(404).end("nf");
  });
});
server.listen(0, "127.0.0.1", () => {
  const a = server.address();
  const port = typeof a === "object" && a ? a.port : 0;
  console.log(`opencode server listening on http://127.0.0.1:${port}`);
});
process.on("SIGTERM", () => process.exit(0));
