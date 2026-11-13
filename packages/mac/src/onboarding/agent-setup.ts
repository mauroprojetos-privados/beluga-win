// Relative, not @beluga: tests at the repo's root import this file too.
import type { RuntimeChoice, RuntimeState } from '../../../../src/shared/agent-runtimes.js';
import { thisComputer } from '../lib/os-words.js';
import { t } from '../../../../src/shared/i18n/index.js';

/**
 * Your agents, found (BLG-507): each runtime Beluga knows with where it stands on this Mac (ready,
 * not signed in, not installed, no endpoint) and the one thing to do about it. Onboarding's "Your
 * agents" step and Settings › Agent draw the same rows. Pure, so it's tested without a screen.
 */

/** How to get a runtime Beluga doesn't come with: its download page, and its command for Terminal. */
export const INSTALLS: Readonly<Record<string, { readonly page: string; readonly command: string }>> = {
  codex: { page: 'https://developers.openai.com/codex', command: 'npm i -g @openai/codex' },
  opencode: { page: 'https://opencode.ai/download', command: 'npm i -g opencode-ai' },
  copilot: { page: 'https://github.com/features/copilot/cli', command: 'npm i -g @github/copilot' },
};

/** Codex's own install: the app, or its CLI from npm. */
export const CODEX_NPM = INSTALLS.codex!.command;
export const CODEX_DOWNLOAD = INSTALLS.codex!.page;

/** What to do about a runtime that isn't ready: its sign-in, its install, or a local endpoint. */
export type AgentFix = 'sign_in' | 'install' | 'set_up';

export interface AgentRow {
  readonly id: string;
  /** Its name for people ("Claude", "Codex", "Local model"). */
  readonly label: string;
  /** Undefined while it hasn't been asked yet. */
  readonly state: RuntimeState | undefined;
  /** The state in two words, for its chip. */
  readonly words: string;
  /** One line under its name: what it is, or what's missing. */
  readonly detail: string;
  readonly fix?: AgentFix;
}

// Getters: said in the app's language when a row draws, not when this loads.
export const STATE_WORDS: Readonly<Record<RuntimeState, string>> = {
  get ready() {
    return t('components.onboarding.agentSetup.ready');
  },
  get signed_out() {
    return t('components.onboarding.agentSetup.signedOut');
  },
  get missing() {
    return t('components.onboarding.agentSetup.missing');
  },
  get no_endpoint() {
    return t('components.onboarding.agentSetup.noEndpoint');
  },
};

export const FIX_LABEL: Readonly<Record<AgentFix, string>> = {
  get sign_in() {
    return t('components.onboarding.agentSetup.signIn');
  },
  get install() {
    return t('components.onboarding.agentSetup.get', { name: 'Codex' });
  },
  get set_up() {
    return t('components.onboarding.agentSetup.setUp');
  },
};

/** A row's button: "Sign In", "Get Codex", "Get OpenCode", "Get Copilot", "Set Up…". */
export const fixLabel = (row: Pick<AgentRow, 'label' | 'fix'>): string => (row.fix === 'install' ? t('components.onboarding.agentSetup.get', { name: row.label }) : row.fix ? FIX_LABEL[row.fix] : '');

/** Where a runtime stands: what it said once asked, else ready when it runs here; undefined: not asked yet. */
export function stateOf(r: RuntimeChoice, checked: boolean): RuntimeState | undefined {
  if (r.state) return r.state;
  if (r.available) return 'ready';
  return checked ? (r.id === 'local' ? 'no_endpoint' : 'missing') : undefined;
}

/** Each runtime's line under its name, by where it stands: said in the app's language when asked. */
const DETAIL = (): Readonly<Record<string, Partial<Record<RuntimeState, string>> & { readonly ready: string }>> => ({
  claude: {
    ready: t('components.onboarding.agentSetup.claudeReady'),
    signed_out: t('components.onboarding.agentSetup.claudeSignIn'),
    missing: t('components.onboarding.agentSetup.claudeSignIn'),
  },
  codex: {
    ready: t('components.onboarding.agentSetup.codexReady'),
    signed_out: t('components.onboarding.agentSetup.codexSignIn'),
    missing: t('components.onboarding.agentSetup.codexMissing'),
  },
  opencode: {
    ready: t('components.onboarding.agentSetup.opencodeReady'),
    signed_out: t('components.onboarding.agentSetup.opencodeSignIn'),
    missing: t('components.onboarding.agentSetup.opencodeMissing'),
  },
  copilot: {
    ready: t('components.onboarding.agentSetup.copilotReady'),
    signed_out: t('components.onboarding.agentSetup.copilotSignIn'),
    missing: t('components.onboarding.agentSetup.copilotMissing'),
  },
  local: {
    ready: t('components.onboarding.agentSetup.localReady', { computer: thisComputer() }),
    no_endpoint: t('components.onboarding.agentSetup.localNoEndpoint', { computer: thisComputer() }),
  },
});

function fixOf(id: string, state: RuntimeState | undefined): AgentFix | undefined {
  if (state === 'signed_out') return id === 'local' ? 'set_up' : 'sign_in';
  if (state === 'no_endpoint') return 'set_up';
  if (state === 'missing') return id === 'local' ? 'set_up' : id === 'claude' ? 'sign_in' : INSTALLS[id] ? 'install' : undefined;
  return undefined;
}

/** The rows, in the pickers' order. `checked`: every runtime has been asked at least once. */
export function agentRows(runtimes: readonly RuntimeChoice[], checked: boolean): AgentRow[] {
  const details = DETAIL();
  return runtimes.map((r) => {
    const state = stateOf(r, checked);
    const known = details[r.id];
    const detail = (state && known?.[state]) ?? (state === 'ready' || !state ? (known?.ready ?? '') : (r.fix ?? r.why ?? ''));
    const fix = fixOf(r.id, state);
    return { id: r.id, label: r.label, state, words: state ? STATE_WORDS[state] : t('components.onboarding.agentSetup.checking'), detail, ...(fix ? { fix } : {}) };
  });
}

/** How often the agents are asked again while one is still being installed or signed in to. */
export const AGENT_RECHECK_MS = 5_000;

/**
 * Whether an agent could turn ready any moment now (Codex installing, a sign-in in Terminal or in
 * Beluga's own terminal), so it's worth asking again on its own. A local model waits for Set Up….
 */
export function awaitingAgent(rows: readonly AgentRow[]): boolean {
  return rows.some((r) => r.id !== 'local' && r.state !== undefined && r.state !== 'ready');
}

/**
 * Who should be your agent once they're found: yours, when it's ready; else the first that is
 * (Claude Code before Codex before a local model); undefined when none is (yours stays).
 */
export function pickDefault(rows: readonly AgentRow[], mine: string): string | undefined {
  if (rows.find((r) => r.id === mine)?.state === 'ready') return mine;
  return rows.find((r) => r.state === 'ready')?.id;
}
