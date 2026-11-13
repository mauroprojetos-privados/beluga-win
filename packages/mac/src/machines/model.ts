// Relative, not @beluga: the root's tests and typecheck read this file too.
import type { MachineKind } from '../../../../src/machines/kind.js';
import type { MachineView } from '../../../../src/machines/machines.js';
import type { MachineIcon } from '../../../../src/shared/settings-schema.js';
import { DISTRO_WORDS, KIND_WORDS } from '../../../../src/machines/words.js';
import type { LinuxDistro } from '../../../../src/machines/kind.js';
import { t } from '../../../../src/shared/i18n/index.js';
// Which mark a computer shows is shared with the phone (src/machines/look.ts).
export { type Brand, machineLook } from '../../../../src/machines/look.js';

/**
 * How Settings › Your Computers says and draws a computer (BLG-780): its kind in words, its icon
 * (the one kept on it, else its kind's brand mark or a fitting glyph), a line of what it has free,
 * and what isn't ready there with its fix. Pure, so it's tested without a window.
 */


// Said the same on the phone (BLG-810).
export { KIND_WORDS } from '../../../../src/machines/words.js';



/** The generic icons to pick from, in order (`auto` is the kind's own). */
// Each label is said when it's read, in the app's language then.
export const ICON_CHOICES: ReadonlyArray<{ readonly value: MachineIcon; readonly label: string }> = [
  { value: 'auto', get label() { return t('project.machines.icon.auto'); } },
  { value: 'server', get label() { return t('project.machines.icon.server'); } },
  { value: 'cloud', get label() { return t('project.machines.icon.cloud'); } },
  { value: 'desktop', get label() { return t('project.machines.icon.desktop'); } },
  { value: 'laptop', get label() { return t('project.machines.icon.laptop'); } },
  { value: 'chip', get label() { return t('project.machines.icon.chip'); } },
  { value: 'box', get label() { return t('project.machines.icon.box'); } },
];


/** "AWS · eu-west-1", "Mac mini", or the platform when the kind isn't known yet. */
export function kindLine(m: Pick<MachineView, 'kind' | 'region' | 'platform'> & { readonly distro?: LinuxDistro; readonly distroVersion?: string }): string {
  // A plain Linux box says which one: "Ubuntu 24.04".
  if (m.distro && (!m.kind || m.kind === 'linux' || m.kind === 'wsl')) return [DISTRO_WORDS[m.distro], m.distroVersion].filter(Boolean).join(' ') + (m.kind === 'wsl' ? ' · WSL' : '');
  const kind = m.kind ? KIND_WORDS[m.kind] : m.platform === 'macos' ? 'Mac' : m.platform === 'windows' ? 'Windows' : 'Linux';
  return m.region ? `${kind} · ${m.region}` : kind;
}

/** One line of what it has free, or how it is when it isn't online. */
export function loadLine(m: Pick<MachineView, 'status' | 'info' | 'rttMs' | 'note' | 'lastSeen'>, now = Date.now()): string {
  if (m.note) return m.note;
  if (m.status !== 'online') return m.status === 'offline' ? (m.lastSeen ? t('project.machines.offlineSeen', { ago: machineAgo(now - m.lastSeen) }) : t('project.machines.offline')) : t('project.machines.lookingForIt');
  const i = m.info;
  if (!i) return t('project.machines.online');
  const parts = [
    t('project.machines.busy', { n: Math.round(i.loadPerCore * 100) }),
    t('project.machines.free', { n: i.memory.freeGB }),
    ...(i.disk ? [t('project.machines.disk', { n: Math.round(i.disk.freeGB) })] : []),
    ...(i.agentsRunning ? [t('project.machines.working', { n: i.agentsRunning })] : []),
    ...(m.rttMs !== undefined ? [t('project.machines.ms', { n: m.rttMs })] : []),
  ];
  return parts.join(' · ');
}

/** "just now", "3 min", "2 h", "4 d" (for "seen … ago"); remote-work.ts says it the same. */
export const machineAgo = (ms: number): string => {
  const min = Math.round(ms / 60_000);
  return min < 1 ? t('project.machines.ago.justNow') : min < 60 ? t('project.machines.ago.min', { n: min }) : min < 60 * 24 ? t('project.machines.ago.h', { n: Math.round(min / 60) }) : t('project.machines.ago.d', { n: Math.round(min / 1440) });
};

/** One item of a computer's health strip: ready, or not with its fix. */
export interface Health {
  readonly key: string;
  readonly label: string;
  readonly ok: boolean;
  /** What isn't ready, in words, and the command that fixes it there. */
  readonly fix?: { readonly words: string; readonly command?: string };
  /** Plan usage, when it's known ("42% of 5 h"). */
  readonly usage?: string;
}

/** Claude, Codex, gh and the MCP servers there, each ready or with its fix. */
export function healthOf(m: Pick<MachineView, 'name' | 'info'>): Health[] {
  const i = m.info;
  if (!i) return [];
  /** A runtime's state there; one you don't use there (not installed and `optional`) isn't shown. */
  const rt = (id: string, label: string, signIn: string, optional = false): Health[] => {
    const r = i.runtimes.find((x) => x.id === id);
    const used = r?.usage?.fiveHour ? t('project.machines.usageFiveHour', { n: Math.round(r.usage.fiveHour.pct) }) : r?.usage?.week ? t('project.machines.usageWeek', { n: Math.round(r.usage.week.pct) }) : undefined;
    if (r?.state === 'ready') return [{ key: id, label, ok: true, ...(used ? { usage: used } : {}) }];
    if (r?.state === 'signed_out') return [{ key: id, label, ok: false, fix: { words: t('project.machines.signIn', { label, name: m.name }), command: signIn } }];
    return optional ? [] : [{ key: id, label, ok: false, fix: { words: t('project.machines.notSetUp', { label, name: m.name }), command: 'beluga setup' } }];
  };
  return [
    ...rt('claude', 'Claude', 'claude auth login'),
    ...rt('codex', 'Codex', 'codex login', true),
    i.gh === 'signed_in' ? { key: 'gh', label: 'gh', ok: true } : { key: 'gh', label: 'gh', ok: false, fix: { words: i.gh === 'missing' ? t('project.machines.ghMissing', { name: m.name }) : t('project.machines.signIn', { label: 'gh', name: m.name }), command: 'gh auth login' } },
    { key: 'mcp', label: t('project.machines.mcpServers', { count: i.mcp.length }), ok: true },
  ];
}

/** Run New Work On's choices: this computer, Best Available, and each computer by name. */
export function runOnOptions(here: string, machines: ReadonlyArray<Pick<MachineView, 'id' | 'name'>>): Array<{ value: string; label: string }> {
  return [{ value: 'here', label: here }, { value: 'best', label: t('project.machines.bestAvailable') }, ...machines.map((m) => ({ value: m.id, label: m.name }))];
}
