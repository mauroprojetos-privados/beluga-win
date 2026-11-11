import type { AgentPlace } from '../types.js';

/**
 * A bot's own MCP servers (`AgentPlace.mcp`, docs/bots.md) in the shapes the other runtimes take for
 * one run. Claude Code takes `.mcp.json`'s own entries as they are (claude/runner.ts); this reads the
 * same entries for Codex, OpenCode and Copilot:
 *
 * - **started** servers (`command`, `args`, `env`): Codex's `mcp_servers.<name>` overrides and ACP's
 *   stdio servers (OpenCode). Copilot turns a client's started servers down.
 * - **HTTP** servers (`url`, `headers`; `type` http or sse): Codex's `url` + `http_headers`, ACP's
 *   http servers (OpenCode and Copilot).
 *
 * An entry that is neither is left out, named in `skipped`.
 */

export interface StartedServer {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface HttpServer {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface PlaceServers {
  readonly started: Readonly<Record<string, StartedServer>>;
  readonly http: Readonly<Record<string, HttpServer>>;
  readonly skipped: readonly string[];
}

const NONE: PlaceServers = { started: {}, http: {}, skipped: [] };

const strings = (v: unknown): Record<string, string> => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string')) : {});

export function placeServers(mcp: AgentPlace['mcp'] | undefined): PlaceServers {
  if (!mcp) return NONE;
  const started: Record<string, StartedServer> = {};
  const http: Record<string, HttpServer> = {};
  const skipped: string[] = [];
  for (const [name, raw] of Object.entries(mcp.servers)) {
    const type = typeof raw.type === 'string' ? raw.type : undefined;
    if (typeof raw.url === 'string' && raw.url && (!type || type === 'http' || type === 'sse' || type === 'streamable-http')) http[name] = { url: raw.url, headers: strings(raw.headers) };
    else if (typeof raw.command === 'string' && raw.command && (!type || type === 'stdio')) started[name] = { command: raw.command, args: Array.isArray(raw.args) ? raw.args.filter((a): a is string => typeof a === 'string') : [], env: strings(raw.env) };
    else skipped.push(name);
  }
  return { started, http, skipped };
}

/** Codex's per-thread config for a bot's servers (`mcp_servers.<name>`), and your own turned off (`yours`). */
export function codexPlaceConfig(mcp: AgentPlace['mcp'] | undefined, yours: readonly string[]): Record<string, unknown> {
  if (!mcp) return {};
  const s = placeServers(mcp);
  const own = new Set([...Object.keys(s.started), ...Object.keys(s.http)]);
  return {
    ...Object.fromEntries(yours.filter((n) => !own.has(n)).map((n) => [`mcp_servers.${n}.enabled`, false])),
    ...Object.fromEntries(Object.entries(s.started).map(([n, x]) => [`mcp_servers.${n}`, { command: x.command, args: x.args, env: x.env }])),
    ...Object.fromEntries(Object.entries(s.http).map(([n, x]) => [`mcp_servers.${n}`, { url: x.url, ...(Object.keys(x.headers).length ? { http_headers: x.headers } : {}) }])),
  };
}

const pairs = (o: Readonly<Record<string, string>>): Array<{ name: string; value: string }> => Object.entries(o).map(([name, value]) => ({ name, value }));

/** ACP's stdio servers for a bot's started ones (OpenCode). */
export function acpStartedServers(mcp: AgentPlace['mcp'] | undefined): Array<{ name: string; command: string; args: string[]; env: Array<{ name: string; value: string }> }> {
  return Object.entries(placeServers(mcp).started).map(([name, s]) => ({ name, command: s.command, args: [...s.args], env: pairs(s.env) }));
}

/** ACP's http servers for a bot's HTTP ones (OpenCode, Copilot). */
export function acpHttpServers(mcp: AgentPlace['mcp'] | undefined): Array<{ type: 'http'; name: string; url: string; headers: Array<{ name: string; value: string }> }> {
  return Object.entries(placeServers(mcp).http).map(([name, s]) => ({ type: 'http' as const, name, url: s.url, headers: pairs(s.headers) }));
}
