/**
 * How Claude takes what you send: right away, planning first (Claude Code's plan mode, which you
 * approve), or planning with tasks (a plan of milestones and tasks that goes on the board when you
 * approve it; see core/plans).
 */

import { wordTable } from '@beluga/shared/i18n/words.js';

export type ComposeMode = 'act' | 'plan' | 'tasks';

/** Each mode's name, its hint and the banner over the box, in the app's language (src/shared/i18n/areas/helpers.ts). */
export const MODE_INFO: Readonly<Record<ComposeMode, { readonly label: string; readonly hint: string; readonly banner: string }>> = wordTable({
  act: { label: 'helpers.mode.act.label', hint: 'helpers.mode.act.hint', banner: '' },
  plan: { label: 'helpers.mode.plan.label', hint: 'helpers.mode.plan.hint', banner: 'helpers.mode.plan.banner' },
  tasks: { label: 'helpers.mode.tasks.label', hint: 'helpers.mode.tasks.hint', banner: 'helpers.mode.tasks.banner' },
});

/** ⇧⇥: acting ↔ planning first, as in Claude Code. (Plan with Tasks makes a plan: it's picked from the menu, never a keystroke away.) */
export function nextMode(mode: ComposeMode): ComposeMode {
  return mode === 'act' ? 'plan' : 'act';
}
