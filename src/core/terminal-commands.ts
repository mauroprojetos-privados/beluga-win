import { envKeyProblem, parseEnvText } from '../shared/env-vars.js';
import { joinArgs, splitArgs } from '../shared/shells.js';
import type { Session } from './session.js';
import { t } from '../shared/i18n/index.js';

const USAGE = (): string => t('toasts.terminal.envUsage');

/**
 * `/env`: list your variables' names; `/env KEY=value` sets one of yours, `/env KEY=` removes
 * it; `/env project KEY=value` does the same for the project of the workspace you're in.
 */
export function runEnvCommand(session: Session, args: readonly string[], channel: string): void {
  const state = session.store.getState();
  const forProject = args[0] === 'project';
  const text = (forProject ? args.slice(1) : args).join(' ').trim();
  const wsId = channel.startsWith('ws:') ? channel.slice(3) : undefined;
  const project = wsId ? state.projects.find((p) => p.root && p.workspaces.some((w) => w.id === wsId)) : undefined;
  if (forProject && !project) return session.toast(t('toasts.terminal.envOpenFirst'), 'warn');
  if (!text) {
    const mine = state.envKeys.global;
    const theirs = project ? (state.envKeys.projects[project.root]?.keys ?? []) : [];
    const list = [t('toasts.terminal.envYours', { keys: mine.length ? mine.join(', ') : t('toasts.terminal.none') }), ...(project ? [`${project.name}: ${theirs.length ? theirs.join(', ') : t('toasts.terminal.none')}`] : [])].join(' · ');
    return session.toast(`${list}. ${USAGE()}`);
  }
  const eq = text.indexOf('=');
  const key = eq > 0 ? text.slice(0, eq).trim().replace(/^export\s+/, '') : '';
  const problem = key ? envKeyProblem(key) : USAGE();
  if (problem) return session.toast(problem, 'warn');
  const value = parseEnvText(`${key}=${text.slice(eq + 1)}`).vars[0]?.value ?? '';
  try {
    session.env.setOne(forProject ? project?.id : undefined, key, value === '' ? undefined : value);
    const where = forProject ? ` ${t('toasts.terminal.envForProject', { project: String(project?.name) })}` : '';
    session.toast(value === '' ? t('toasts.terminal.envRemoved', { key, where }) : t('toasts.terminal.envSet', { key, where }), 'success');
  } catch (err) {
    session.toast(err instanceof Error ? err.message : String(err), 'error');
  }
}

/**
 * `/shell`: what the terminal runs. `/shell fish` or `/shell /opt/homebrew/bin/fish` picks one,
 * `/shell default` goes back to your login shell, `/shell login on|off` and `/shell args …`
 * change how it starts. New shells use it.
 */
/** A full path on any system (no node:path: the screens load this file). */
const FULL_PATH = /^\/|^[A-Za-z]:[\\/]|^\\\\/;

export function runShellCommand(session: Session, args: readonly string[]): void {
  const state = session.store.getState();
  const p = state.prefs;
  const [first, ...rest] = args;
  if (!first) {
    const how = [p.shellLogin ? t('toasts.terminal.loginShell') : t('toasts.terminal.notLoginShell'), ...(p.shellArgs.length ? [joinArgs(p.shellArgs)] : [])].join(', ');
    const shell = p.shell ?? state.shellChoices.find((c) => c.isDefault)?.path ?? t('toasts.terminal.yourLoginShell');
    return session.toast(t('toasts.terminal.shellIs', { shell, how }));
  }
  if (first === 'default') {
    session.setPrefs({ shell: undefined });
    return session.toast(t('toasts.terminal.useLoginShell'), 'success');
  }
  if (first === 'login') {
    const on = rest[0] !== 'off';
    session.setPrefs({ shellLogin: on });
    return session.toast(on ? t('toasts.terminal.loginOn') : t('toasts.terminal.loginOff'), 'success');
  }
  if (first === 'args') {
    const extra = splitArgs(rest.join(' '));
    session.setPrefs({ shellArgs: extra.slice(0, 20) });
    return session.toast(extra.length ? t('toasts.terminal.argsSet', { args: joinArgs(extra) }) : t('toasts.terminal.noArgs'), 'success');
  }
  // A name ("fish") picks the installed one; anything else is taken as a path.
  const wanted = args.join(' ');
  const match = state.shellChoices.find((c) => c.name.toLowerCase() === wanted.toLowerCase() || c.path.endsWith(`/${wanted}`) || c.path.endsWith(`\\${wanted}`));
  const shell = match?.path ?? wanted;
  // A full path: /opt/homebrew/bin/fish, or C:\Program Files\Git\bin\bash.exe on Windows.
  if (!FULL_PATH.test(shell)) return session.toast(t('toasts.terminal.noShell', { name: wanted }), 'warn');
  session.setPrefs({ shell });
  session.toast(t('toasts.terminal.shellSet', { shell }), 'success');
}
