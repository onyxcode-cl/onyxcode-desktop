// Casos L3 (repositorio / arquitectura).
const T = String.raw`import { test } from 'node:test';
import assert from 'node:assert/strict';
`;

export const l3 = [
  // ---------------------------------------------------------------- L3-001
  () => {
    const visible = (withPriority) =>
      T +
      String.raw`import { TaskRepo } from '../src/repo.ts';
import { TaskService } from '../src/service.ts';

test('agrega y lista', () => {
  const s = new TaskService(new TaskRepo());
  s.add('uno');
  s.add('dos');
  assert.deepEqual(s.list().map((t) => t.title), ['uno', 'dos']);
});
` +
      (withPriority
        ? String.raw`
test('prioridad alta primero', () => {
  const s = new TaskService(new TaskRepo());
  s.add('a');
  s.add('b', 'high');
  assert.deepEqual(s.list().map((t) => t.title), ['b', 'a']);
});
`
        : '');
    return {
      id: 'node-l3-001-task-priority',
      category: 'repository',
      difficulty: 'L3',
      title: 'Agregar prioridad a las tareas en todas las capas',
      task:
        'Agrega prioridad a las tareas: Priority = "low" | "normal" | "high". TaskService.add(title, priority = "normal") la guarda ' +
        '(prioridad invalida lanza Error("invalid priority")); TaskService.list() ordena high > normal > low y, a igual prioridad, por id; ' +
        'formatTask antepone "! " al titulo de las tareas high. Actualiza el modelo, el repositorio, el servicio y el formateador.',
      constraints: ['No modificar tests existentes.', 'Mantener el comportamiento actual para tareas sin prioridad.'],
      relevantFiles: ['src/model.ts', 'src/repo.ts', 'src/service.ts', 'src/format.ts'],
      cheatKind: 'edit-tests',
      base: {
        'src/model.ts': String.raw`export interface Task {
  id: number;
  title: string;
  done: boolean;
}
`,
        'src/repo.ts': String.raw`import type { Task } from './model.ts';

export class TaskRepo {
  private items = new Map<number, Task>();
  private seq = 0;

  insert(data: { title: string }): Task {
    const t: Task = { id: ++this.seq, title: data.title, done: false };
    this.items.set(t.id, t);
    return t;
  }

  get(id: number): Task | undefined {
    return this.items.get(id);
  }

  all(): Task[] {
    return [...this.items.values()];
  }
}
`,
        'src/service.ts': String.raw`import type { Task } from './model.ts';
import type { TaskRepo } from './repo.ts';

export class TaskService {
  private repo: TaskRepo;

  constructor(repo: TaskRepo) {
    this.repo = repo;
  }

  add(title: string): Task {
    if (!title.trim()) throw new Error('title required');
    return this.repo.insert({ title: title.trim() });
  }

  complete(id: number): Task {
    const t = this.repo.get(id);
    if (!t) throw new Error('not found');
    t.done = true;
    return t;
  }

  list(): Task[] {
    return this.repo.all();
  }
}
`,
        'src/format.ts': String.raw`import type { Task } from './model.ts';

export function formatTask(t: Task): string {
  return (t.done ? '[x] ' : '[ ] ') + t.id + ' ' + t.title;
}
`,
        'test/tasks.test.ts': visible(true),
      },
      hidden: {
        'tasks.hidden.test.ts':
          T +
          String.raw`import { TaskRepo } from '../src/repo.ts';
import { TaskService } from '../src/service.ts';
import { formatTask } from '../src/format.ts';

function svc() {
  return new TaskService(new TaskRepo());
}

test('prioridad por defecto normal', () => {
  assert.equal(svc().add('x').priority, 'normal');
});

test('prioridad invalida', () => {
  assert.throws(() => svc().add('x', 'urgent' as never), /invalid priority/);
});

test('orden high > normal > low y estable por id', () => {
  const s = svc();
  s.add('l1', 'low');
  s.add('n1');
  s.add('h1', 'high');
  s.add('n2', 'normal');
  s.add('h2', 'high');
  assert.deepEqual(s.list().map((t) => t.title), ['h1', 'h2', 'n1', 'n2', 'l1']);
});

test('formato de tareas', () => {
  const s = svc();
  const h = s.add('urgente', 'high');
  const n = s.add('normal');
  assert.equal(formatTask(h), '[ ] 1 ! urgente');
  assert.equal(formatTask(n), '[ ] 2 normal');
});

test('completar conserva prioridad', () => {
  const s = svc();
  const t = s.add('x', 'low');
  assert.equal(s.complete(t.id).priority, 'low');
});
`,
      },
      reference: {
        'src/model.ts': String.raw`export type Priority = 'low' | 'normal' | 'high';

export interface Task {
  id: number;
  title: string;
  done: boolean;
  priority: Priority;
}
`,
        'src/repo.ts': String.raw`import type { Priority, Task } from './model.ts';

export class TaskRepo {
  private items = new Map<number, Task>();
  private seq = 0;

  insert(data: { title: string; priority: Priority }): Task {
    const t: Task = { id: ++this.seq, title: data.title, done: false, priority: data.priority };
    this.items.set(t.id, t);
    return t;
  }

  get(id: number): Task | undefined {
    return this.items.get(id);
  }

  all(): Task[] {
    return [...this.items.values()];
  }
}
`,
        'src/service.ts': String.raw`import type { Priority, Task } from './model.ts';
import type { TaskRepo } from './repo.ts';

const RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

export class TaskService {
  private repo: TaskRepo;

  constructor(repo: TaskRepo) {
    this.repo = repo;
  }

  add(title: string, priority: Priority = 'normal'): Task {
    if (!title.trim()) throw new Error('title required');
    if (!(priority in RANK)) throw new Error('invalid priority');
    return this.repo.insert({ title: title.trim(), priority });
  }

  complete(id: number): Task {
    const t = this.repo.get(id);
    if (!t) throw new Error('not found');
    t.done = true;
    return t;
  }

  list(): Task[] {
    return this.repo.all().sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.id - b.id);
  }
}
`,
        'src/format.ts': String.raw`import type { Task } from './model.ts';

export function formatTask(t: Task): string {
  return (t.done ? '[x] ' : '[ ] ') + t.id + ' ' + (t.priority === 'high' ? '! ' : '') + t.title;
}
`,
      },
      cheat: { 'test/tasks.test.ts': visible(false) },
    };
  },
  // ---------------------------------------------------------------- L3-002
  () => {
    const configTs = String.raw`export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AppConfig {
  smtp: { host: string; port: number };
  api: { url: string; timeoutMs: number };
  log: { level: LogLevel };
}

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

function num(v: string | undefined, def: number, name: string): number {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error('invalid ' + name);
  return n;
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const level = (env.LOG_LEVEL ?? 'info') as LogLevel;
  if (!LEVELS.includes(level)) throw new Error('invalid LOG_LEVEL');
  return {
    smtp: { host: env.SMTP_HOST ?? 'localhost', port: num(env.SMTP_PORT, 25, 'SMTP_PORT') },
    api: { url: env.API_URL ?? 'http://localhost:3000', timeoutMs: num(env.API_TIMEOUT_MS, 5000, 'API_TIMEOUT_MS') },
    log: { level },
  };
}
`;
    return {
      id: 'node-l3-002-config-injection',
      category: 'repository',
      difficulty: 'L3',
      title: 'Centralizar la configuracion e inyectarla',
      task:
        'Crea src/config.ts con loadConfig(env) que devuelva { smtp: {host, port}, api: {url, timeoutMs}, log: {level} } con los mismos valores por defecto ' +
        'que hoy usan los modulos (SMTP_HOST, SMTP_PORT, API_URL, API_TIMEOUT_MS, LOG_LEVEL), validando puerto/timeout enteros positivos y LOG_LEVEL en debug|info|warn|error ' +
        '(error: Error("invalid <NOMBRE>")). createMailer, createClient y createLogger deben recibir la configuracion como argumento y dejar de leer process.env.',
      constraints: ['No modificar tests existentes.', 'No leer process.env fuera de src/config.ts ni de bin/.'],
      relevantFiles: ['src/config.ts', 'src/mailer.ts', 'src/client.ts', 'src/logger.ts'],
      cheatKind: 'partial',
      base: {
        'src/mailer.ts': String.raw`export function createMailer() {
  const host = process.env.SMTP_HOST ?? 'localhost';
  const port = Number(process.env.SMTP_PORT ?? 25);
  return { describe: () => host + ':' + port };
}
`,
        'src/client.ts': String.raw`export function createClient() {
  const base = process.env.API_URL ?? 'http://localhost:3000';
  const timeout = Number(process.env.API_TIMEOUT_MS ?? 5000);
  return {
    timeout,
    url: (p: string) => base.replace(/\/$/, '') + '/' + p.replace(/^\//, ''),
  };
}
`,
        'src/logger.ts': String.raw`const ORDER = ['debug', 'info', 'warn', 'error'];

export function createLogger() {
  const level = process.env.LOG_LEVEL ?? 'info';
  return {
    level,
    enabled: (l: string) => ORDER.indexOf(l) >= ORDER.indexOf(level),
  };
}
`,
        'test/config.test.ts':
          T +
          String.raw`import { loadConfig } from '../src/config.ts';

test('valores por defecto', () => {
  const c = loadConfig({});
  assert.equal(c.smtp.host, 'localhost');
  assert.equal(c.smtp.port, 25);
  assert.equal(c.api.timeoutMs, 5000);
  assert.equal(c.log.level, 'info');
});
`,
      },
      hidden: {
        'config.hidden.test.ts':
          T +
          String.raw`import { loadConfig } from '../src/config.ts';
import { createMailer } from '../src/mailer.ts';
import { createClient } from '../src/client.ts';
import { createLogger } from '../src/logger.ts';

test('validacion', () => {
  assert.throws(() => loadConfig({ SMTP_PORT: 'abc' }), /invalid SMTP_PORT/);
  assert.throws(() => loadConfig({ API_TIMEOUT_MS: '-1' }), /invalid API_TIMEOUT_MS/);
  assert.throws(() => loadConfig({ LOG_LEVEL: 'verbose' }), /invalid LOG_LEVEL/);
});

test('los modulos usan la configuracion recibida y no process.env', () => {
  process.env.SMTP_HOST = 'del-entorno';
  process.env.API_URL = 'http://entorno';
  process.env.LOG_LEVEL = 'error';
  try {
    const cfg = loadConfig({ SMTP_HOST: 'mx.local', SMTP_PORT: '2525', API_URL: 'http://api.local/', LOG_LEVEL: 'debug' });
    assert.equal(createMailer(cfg).describe(), 'mx.local:2525');
    const client = createClient(cfg);
    assert.equal(client.url('/v1/x'), 'http://api.local/v1/x');
    assert.equal(client.timeout, 5000);
    const log = createLogger(cfg);
    assert.equal(log.level, 'debug');
    assert.equal(log.enabled('debug'), true);
  } finally {
    delete process.env.SMTP_HOST;
    delete process.env.API_URL;
    delete process.env.LOG_LEVEL;
  }
});
`,
      },
      reference: {
        'src/config.ts': configTs,
        'src/mailer.ts': String.raw`import type { AppConfig } from './config.ts';

export function createMailer(cfg: AppConfig) {
  const { host, port } = cfg.smtp;
  return { describe: () => host + ':' + port };
}
`,
        'src/client.ts': String.raw`import type { AppConfig } from './config.ts';

export function createClient(cfg: AppConfig) {
  const base = cfg.api.url;
  return {
    timeout: cfg.api.timeoutMs,
    url: (p: string) => base.replace(/\/$/, '') + '/' + p.replace(/^\//, ''),
  };
}
`,
        'src/logger.ts': String.raw`import type { AppConfig } from './config.ts';

const ORDER = ['debug', 'info', 'warn', 'error'];

export function createLogger(cfg: AppConfig) {
  const level = cfg.log.level;
  return {
    level,
    enabled: (l: string) => ORDER.indexOf(l) >= ORDER.indexOf(level),
  };
}
`,
      },
      cheat: { 'src/config.ts': configTs },
    };
  },
  // ---------------------------------------------------------------- L3-003
  (r) => {
    const ttl = r.pick([1000, 5000, 60000]);
    return {
      id: 'node-l3-003-ttl-cache',
      category: 'repository',
      difficulty: 'L3',
      title: 'Cache con TTL e reloj inyectable en UserService',
      task:
        'UserService debe cachear lookups exitosos: new UserService(repo, { ttlMs, clock }) con clock.now() inyectable (por defecto systemClock). ' +
        'Dentro del TTL no se vuelve a llamar a repo.find; al expirar (now - guardado >= ttlMs) si. Los NotFoundError no se cachean. ' +
        'Agrega invalidate(id). Sin opciones el comportamiento actual (sin cache) se mantiene. Crea src/cache.ts con la estructura que prefieras.',
      constraints: ['No modificar tests existentes.', 'No usar Date.now() directamente en UserService.'],
      relevantFiles: ['src/userService.ts', 'src/clock.ts', 'src/cache.ts'],
      cheatKind: 'hardcode',
      base: {
        'src/clock.ts': String.raw`export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };
`,
        'src/errors.ts': String.raw`export class NotFoundError extends Error {
  constructor(id: string) {
    super('user not found: ' + id);
    this.name = 'NotFoundError';
  }
}
`,
        'src/userRepo.ts': String.raw`export interface User {
  id: string;
  name: string;
}

export interface UserRepo {
  find(id: string): Promise<User | undefined>;
}
`,
        'src/userService.ts': String.raw`import { NotFoundError } from './errors.ts';
import type { User, UserRepo } from './userRepo.ts';

export class UserService {
  private repo: UserRepo;

  constructor(repo: UserRepo) {
    this.repo = repo;
  }

  async get(id: string): Promise<User> {
    const u = await this.repo.find(id);
    if (!u) throw new NotFoundError(id);
    return u;
  }
}
`,
        'test/userService.test.ts':
          T +
          String.raw`import { UserService } from '../src/userService.ts';

test('cache dentro del TTL', async () => {
  let calls = 0;
  const repo = { find: async (id: string) => (calls++, { id, name: 'n' }) };
  const t = { v: 0 };
  const s = new UserService(repo, { ttlMs: ${ttl}, clock: { now: () => t.v } });
  await s.get('a');
  await s.get('a');
  assert.equal(calls, 1);
});
`,
      },
      hidden: {
        'userService.hidden.test.ts':
          T +
          String.raw`import { UserService } from '../src/userService.ts';
import { NotFoundError } from '../src/errors.ts';

function setup(ttlMs: number, known = true) {
  const t = { v: 1000 };
  const calls: string[] = [];
  const repo = {
    find: async (id: string) => {
      calls.push(id);
      return known ? { id, name: 'n' + calls.length } : undefined;
    },
  };
  return { t, calls, s: new UserService(repo, { ttlMs, clock: { now: () => t.v } }) };
}

test('expira al cumplirse el TTL', async () => {
  const { t, calls, s } = setup(${ttl});
  await s.get('a');
  t.v += ${ttl} - 1;
  await s.get('a');
  assert.equal(calls.length, 1);
  t.v += 1;
  const u = await s.get('a');
  assert.equal(calls.length, 2);
  assert.equal(u.name, 'n2');
});

test('ids distintos no comparten cache', async () => {
  const { calls, s } = setup(${ttl});
  await s.get('a');
  await s.get('b');
  assert.deepEqual(calls, ['a', 'b']);
});

test('NotFoundError no se cachea', async () => {
  const { calls, s } = setup(${ttl}, false);
  await assert.rejects(s.get('x'), NotFoundError);
  await assert.rejects(s.get('x'), NotFoundError);
  assert.equal(calls.length, 2);
});

test('invalidate fuerza una nueva lectura', async () => {
  const { calls, s } = setup(${ttl});
  await s.get('a');
  s.invalidate('a');
  await s.get('a');
  assert.equal(calls.length, 2);
});

test('sin opciones no hay cache', async () => {
  let n = 0;
  const s = new UserService({ find: async (id: string) => (n++, { id, name: 'x' }) });
  await s.get('a');
  await s.get('a');
  assert.equal(n, 2);
});
`,
      },
      reference: {
        'src/cache.ts': String.raw`import type { Clock } from './clock.ts';

export class TtlCache<V> {
  private store = new Map<string, { value: V; at: number }>();

  private ttlMs: number;
  private clock: Clock;

  constructor(ttlMs: number, clock: Clock) {
    this.ttlMs = ttlMs;
    this.clock = clock;
  }

  get(key: string): V | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (this.clock.now() - e.at >= this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: V): void {
    this.store.set(key, { value, at: this.clock.now() });
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}
`,
        'src/userService.ts': String.raw`import { TtlCache } from './cache.ts';
import { systemClock, type Clock } from './clock.ts';
import { NotFoundError } from './errors.ts';
import type { User, UserRepo } from './userRepo.ts';

export interface UserServiceOptions {
  ttlMs: number;
  clock?: Clock;
}

export class UserService {
  private cache?: TtlCache<User>;
  private repo: UserRepo;

  constructor(repo: UserRepo, opts?: UserServiceOptions) {
    this.repo = repo;
    if (opts) this.cache = new TtlCache<User>(opts.ttlMs, opts.clock ?? systemClock);
  }

  async get(id: string): Promise<User> {
    const hit = this.cache?.get(id);
    if (hit) return hit;
    const u = await this.repo.find(id);
    if (!u) throw new NotFoundError(id);
    this.cache?.set(id, u);
    return u;
  }

  invalidate(id: string): void {
    this.cache?.delete(id);
  }
}
`,
      },
      cheat: {
        'src/userService.ts': String.raw`import { NotFoundError } from './errors.ts';
import type { User, UserRepo } from './userRepo.ts';

export class UserService {
  private cache = new Map<string, User>();
  private repo: UserRepo;
  private opts?: { ttlMs: number; clock?: { now(): number } };

  constructor(repo: UserRepo, opts?: { ttlMs: number; clock?: { now(): number } }) {
    this.repo = repo;
    this.opts = opts;
  }

  async get(id: string): Promise<User> {
    const hit = this.opts ? this.cache.get(id) : undefined;
    if (hit) return hit;
    const u = await this.repo.find(id);
    if (!u) throw new NotFoundError(id);
    this.cache.set(id, u);
    return u;
  }

  invalidate(id: string): void {
    this.cache.delete(id);
  }
}
`,
      },
    };
  },
];
