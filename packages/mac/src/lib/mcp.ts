import { useEffect, useSyncExternalStore } from 'react';
import type { McpServerRow } from '@beluga/shared/mcp.js';
import type { SocketClient } from '@beluga/ipc/socket-client.js';
import { toast } from './beluga.js';
import { openExternal } from './system.js';
import { t } from '../../../../src/shared/i18n/index.js';

/** Where a server comes from, in words. */
export const MCP_FROM: Record<McpServerRow['from'], (where?: string) => string> = {
  user: () => t('macLib.mcp.fromUser'),
  project: (where) => (where ? t('macLib.mcp.fromProjectIn', { where }) : t('macLib.mcp.fromProject')),
  plugin: (where) => (where ? t('macLib.mcp.fromPluginNamed', { where }) : t('macLib.mcp.fromPlugin')),
  'claude.ai': () => t('macLib.mcp.fromClaudeAi'),
};

/** How a server is, in words, with its dot. */
export const MCP_STATUS: Record<McpServerRow['status'], { readonly words: string; readonly tone: 'ok' | 'warn' | 'error' | 'muted' }> = {
  connected: {
    get words() {
      return t('macLib.mcp.connected');
    },
    tone: 'ok',
  },
  'needs-auth': {
    get words() {
      return t('macLib.mcp.needsAuth');
    },
    tone: 'warn',
  },
  failed: {
    get words() {
      return t('macLib.mcp.failed');
    },
    tone: 'error',
  },
  pending: {
    get words() {
      return t('macLib.mcp.pending');
    },
    tone: 'muted',
  },
  disabled: {
    get words() {
      return t('macLib.mcp.disabled');
    },
    tone: 'muted',
  },
};

/** How long a list stays fresh: asking means starting its agent, so the box and Settings share one. */
const FRESH_MS = 60_000;

interface McpState {
  readonly rows?: readonly McpServerRow[];
  readonly checking: boolean;
  /** The server a sign-in is waiting on (one at a time). */
  readonly signingIn?: string;
  /** The server being turned on or off. */
  readonly turning?: string;
}

/** Whose MCP servers an agent uses: Codex its own, everything else Claude Code's (a local model is Claude Code pointed elsewhere). */
export const mcpRuntimeOf = (runtime: string | undefined): 'claude' | 'codex' => (runtime === 'codex' ? 'codex' : 'claude');

/** One list per runtime (BLG-518): '' is your agent's, 'claude' and 'codex' each one's own. */
const IDLE: McpState = { checking: false };
const states = new Map<string, McpState>();
const checkedAt = new Map<string, number>();
const listeners = new Set<() => void>();
const keyOf = (runtime: string | undefined): string => runtime ?? '';
const stateOf = (runtime: string | undefined): McpState => states.get(keyOf(runtime)) ?? IDLE;
const set = (runtime: string | undefined, patch: Partial<McpState>): void => {
  states.set(keyOf(runtime), { ...stateOf(runtime), ...patch });
  for (const l of listeners) l();
};

/** Ask again how each of your MCP servers is: your agent's, or `runtime`'s. */
export async function checkMcp(client: SocketClient, runtime?: string): Promise<void> {
  if (stateOf(runtime).checking) return;
  set(runtime, { checking: true });
  try {
    set(runtime, { rows: await client.api.claudeCode.mcpServers(runtime) });
    checkedAt.set(keyOf(runtime), Date.now());
  } catch {
    set(runtime, { rows: stateOf(runtime).rows ?? [] });
  } finally {
    set(runtime, { checking: false });
  }
}

/** Sign in to one: its page opens in your browser, and the row waits until you're back. */
export async function signInMcp(client: SocketClient, row: McpServerRow, runtime?: string): Promise<void> {
  set(runtime, { signingIn: row.name });
  try {
    const started = await client.api.claudeCode.mcpSignIn(row.name, runtime);
    if ('error' in started) return toast(client, started.error, 'error');
    if ('url' in started) {
      await openExternal(started.url);
      const ok = await client.api.claudeCode.mcpSignedIn(row.name, runtime);
      toast(client, ok ? t('macLib.mcp.signedIn', { name: row.label }) : t('macLib.mcp.noAnswer', { name: row.label }), ok ? 'success' : 'warn');
    }
    await checkMcp(client, runtime);
  } finally {
    set(runtime, { signingIn: undefined });
  }
}

/** Turn one on or off (a row with canTurnOff), then look again how it is. */
export async function setMcpEnabled(client: SocketClient, row: McpServerRow, on: boolean, runtime?: string): Promise<void> {
  set(runtime, { turning: row.name, rows: stateOf(runtime).rows?.map((r) => (r.name === row.name ? { ...r, status: on ? 'pending' : 'disabled' } : r)) });
  try {
    const done = await client.api.claudeCode.mcpSetEnabled(row.name, on, runtime);
    if ('error' in done) toast(client, done.error, 'error');
    await checkMcp(client, runtime);
  } finally {
    set(runtime, { turning: undefined });
  }
}

/** Your MCP servers (Settings › Agent and the box you type in), asked for once a minute at most: your agent's, or `runtime`'s. */
export function useMcp(client: SocketClient, runtime?: string): McpState {
  const now = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => stateOf(runtime),
  );
  useEffect(() => {
    if (Date.now() - (checkedAt.get(keyOf(runtime)) ?? 0) > FRESH_MS) void checkMcp(client, runtime);
  }, [client, runtime]);
  return now;
}

/** "3 of 9 connected · 2 to sign in · 1 failed", for the chip and its list. */
export function mcpSummary(rows: readonly McpServerRow[]): { readonly connected: number; readonly needYou: number; readonly line: string } {
  const connected = rows.filter((r) => r.status === 'connected').length;
  const needYou = rows.filter((r) => r.status === 'needs-auth').length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const parts = [t('macLib.mcp.summary', { n: connected, of: rows.length }), ...(needYou ? [t('macLib.mcp.toSignIn', { n: needYou })] : []), ...(failed ? [t('macLib.mcp.summaryFailed', { n: failed })] : [])];
  return { connected, needYou, line: parts.join(' · ') };
}
