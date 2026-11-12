import { execFile, spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inWsl } from '../home-path.js';
import { type StackCheck, type StackService, STACK_SERVICES, STACK_TOOLS } from '../stack-store.js';

/**
 * Looking at your stack (docs/stack.md) and starting what's down: every touch of the machine goes
 * through StackDeps, so tests hand in their own. A service is up when it answers at all (hooktop's
 * 401 and OpenViking's 406 count: something is listening); a tool when it's on your login PATH.
 */

export interface RunResult {
  readonly code: number;
  readonly out: string;
}

export interface StackDeps {
  readonly fetch: typeof fetch;
  readonly platform: NodeJS.Platform;
  /** The engine runs inside WSL: Windows programs start through interop. */
  readonly inWsl: boolean;
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
  readonly exists: (file: string) => boolean;
  /** A program file that can run (unset: `exists`). */
  readonly executable?: (file: string) => boolean;
  readonly readFile: (file: string) => string | undefined;
  /** Run a program to its end (never throws: a failure is a non-zero code). */
  readonly run: (bin: string, args: readonly string[], opts?: { readonly cwd?: string; readonly timeoutMs?: number }) => Promise<RunResult>;
  /** Start a program that outlives Beluga, its output appended to `log`. */
  readonly spawnDetached: (bin: string, args: readonly string[], opts?: { readonly log?: string; readonly cwd?: string }) => void;
}

/** Where a service answers. */
export const OLLAMA_URL = 'http://127.0.0.1:11434';
export const OPENVIKING_URL = 'http://127.0.0.1:1933';
export const HOOKTOP_URL = 'http://127.0.0.1:4317';

/** How long one look at a service waits. */
const LOOK_MS = 2500;

/** Paths as the machine writes them (the tests' pretend Linux on any computer). */
const pathFor = (platform: NodeJS.Platform): typeof path.posix => (platform === 'win32' ? path.win32 : path.posix);

/** Folders your tools are installed in that a service's PATH often lacks. */
function extraDirs(home: string, platform: NodeJS.Platform = process.platform): string[] {
  const p = pathFor(platform);
  return [p.join(home, '.local', 'bin'), p.join(home, '.cargo', 'bin'), p.join(home, '.npm-global', 'bin'), p.join(home, '.bun', 'bin'), ...(platform === 'win32' ? [] : ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin'])];
}

/** A program's full path on your PATH (or the usual install folders), or undefined. */
export function findTool(name: string, deps: Pick<StackDeps, 'env' | 'home' | 'platform' | 'exists' | 'executable'>): string | undefined {
  const can = deps.executable ?? deps.exists;
  const sep = deps.platform === 'win32' ? ';' : ':';
  const p = pathFor(deps.platform);
  const dirs = [...(deps.env.PATH ?? deps.env.Path ?? '').split(sep).filter(Boolean), ...extraDirs(deps.home, deps.platform)];
  const names = deps.platform === 'win32' ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`, name] : [name];
  for (const dir of dirs) for (const n of names) if (can(p.join(dir, n))) return p.join(dir, n);
  return undefined;
}

/** OpenViking's server, from its CLI's config (`url` in ~/.openviking/ovcli.conf), else the default. */
export function openVikingUrl(deps: Pick<StackDeps, 'home' | 'readFile' | 'platform'>): string {
  const raw = deps.readFile(pathFor(deps.platform).join(deps.home, '.openviking', 'ovcli.conf'));
  try {
    const url = raw ? (JSON.parse(raw) as { url?: unknown }).url : undefined;
    if (typeof url === 'string' && /^https?:\/\//.test(url)) return url.replace(/\/+$/, '');
  } catch {
    // Not JSON: the default.
  }
  return OPENVIKING_URL;
}

/** Something answers at `url`: any HTTP status below 500 (401, 406 included). */
async function answers(deps: Pick<StackDeps, 'fetch'>, url: string): Promise<boolean> {
  try {
    const res = await deps.fetch(url, { signal: AbortSignal.timeout(LOOK_MS) });
    return res.status < 500;
  } catch {
    return false;
  }
}

/** Whether a service answers now. */
export async function serviceUp(id: StackService, deps: Pick<StackDeps, 'fetch' | 'home' | 'readFile' | 'platform'>): Promise<boolean> {
  switch (id) {
    case 'ollama':
      try {
        const res = await deps.fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(LOOK_MS) });
        return res.ok;
      } catch {
        return false;
      }
    case 'openviking':
      // Its MCP endpoint answers a plain GET with 406, its health with 200: either means it runs.
      return answers(deps, `${openVikingUrl(deps)}/health`);
    case 'hooktop':
      return answers(deps, `${HOOKTOP_URL}/`);
  }
}

/** Every check, looked at once. */
export async function lookAll(deps: StackDeps): Promise<StackCheck[]> {
  const services = await Promise.all(STACK_SERVICES.map(async (id): Promise<StackCheck> => ({ id, kind: 'service', state: (await serviceUp(id, deps)) ? 'up' : 'down' })));
  const tools = STACK_TOOLS.map((id): StackCheck => ({ id, kind: 'tool', state: findTool(id, deps) ? 'up' : 'missing' }));
  return [...services, ...tools];
}

/** Windows' PowerShell, from here (WSL reaches it through interop, by its full path when a service's PATH lacks it). */
function powershell(deps: Pick<StackDeps, 'platform' | 'inWsl' | 'exists'>): string {
  const full = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  return deps.inWsl && deps.exists(full) ? full : 'powershell.exe';
}

/**
 * Start a service that's down, the way it's installed here → whether something was started (it
 * may take a while to answer). False: nothing here knows how to start it.
 */
export async function startService(id: StackService, deps: StackDeps): Promise<boolean> {
  const p = pathFor(deps.platform);
  const logs = p.join(deps.home, '.beluga', 'logs');
  switch (id) {
    case 'ollama': {
      if (deps.inWsl || deps.platform === 'win32') {
        deps.spawnDetached(powershell(deps), ['-NoProfile', '-NonInteractive', '-Command', "Start-Process -FilePath (Join-Path $env:LOCALAPPDATA 'Programs\\Ollama\\ollama app.exe')"]);
        return true;
      }
      if (deps.platform === 'darwin') return (await deps.run('open', ['-a', 'Ollama'], { timeoutMs: 10_000 })).code === 0;
      const bin = findTool('ollama', deps);
      if (!bin) return false;
      deps.spawnDetached(bin, ['serve'], { log: p.join(logs, 'ollama.log') });
      return true;
    }
    case 'openviking': {
      // Started by hand today (setsid nohup openviking-server > ~/.openviking/server.log): the same, on its own session.
      const bin = findTool('openviking-server', deps);
      if (!bin) return false;
      deps.spawnDetached(bin, [], { log: p.join(deps.home, '.openviking', 'server.log') });
      return true;
    }
    case 'hooktop': {
      if (!deps.exists(p.join(deps.home, '.config', 'systemd', 'user', 'hooktop.service'))) return false;
      return (await deps.run('systemctl', ['--user', 'start', 'hooktop'], { timeoutMs: 20_000 })).code === 0;
    }
  }
}

const isRunnable = (file: string): boolean => {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** This machine, for real. */
export function realStackDeps(env: NodeJS.ProcessEnv = process.env): StackDeps {
  const home = env.HOME || os.homedir();
  const platform = process.platform;
  return {
    fetch: globalThis.fetch,
    platform,
    inWsl: inWsl(),
    home,
    env,
    exists: (file) => existsSync(file),
    executable: (file) => existsSync(file) && (platform === 'win32' || isRunnable(file)),
    readFile: (file) => {
      try {
        return readFileSync(file, 'utf8');
      } catch {
        return undefined;
      }
    },
    run: (bin, args, opts) =>
      new Promise((resolve) => {
        execFile(bin, [...args], { cwd: opts?.cwd, timeout: opts?.timeoutMs ?? 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: { ...env, PATH: [env.PATH, ...extraDirs(home, platform)].filter(Boolean).join(platform === 'win32' ? ';' : ':') } }, (err, stdout, stderr) => {
          const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0;
          resolve({ code, out: `${stdout ?? ''}${stderr ?? ''}` });
        });
      }),
    spawnDetached: (bin, args, opts) => {
      try {
        let out: number | 'ignore' = 'ignore';
        if (opts?.log) {
          mkdirSync(path.dirname(opts.log), { recursive: true });
          out = openSync(opts.log, 'a');
        }
        // detached: a session of its own (setsid), so it outlives Beluga.
        const child = spawn(bin, [...args], { cwd: opts?.cwd, detached: true, stdio: ['ignore', out, out], windowsHide: true, env: { ...env, PATH: [env.PATH, ...extraDirs(home, platform)].filter(Boolean).join(platform === 'win32' ? ';' : ':') } });
        child.on('error', () => undefined);
        child.unref();
      } catch {
        // Couldn't start it: the next look says it's still down.
      }
    },
  };
}

