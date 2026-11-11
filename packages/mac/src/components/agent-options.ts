import { useCallback, useMemo } from 'react';
import type { AgentRef } from '@beluga/protocol.js';
import { agentChoices, agentForChoice, choiceForAgent } from '@beluga/ui/agent-choice.js';
import { runtimeMark } from '@beluga/shared/agent-marks.js';
import { agentName } from '@beluga/shared/agent-label.js';
import { type ComboChoice, comboChoices, combosOf, comboValue, worldOf } from '@beluga/core/routing/model.js';
import { hhmm } from '@beluga/shared/clock.js';
import { useApp } from '../lib/beluga.js';
import { useMyAgent } from '../lib/agent-words.js';
import type { SelectEntry, SelectOption } from './select-parts.js';
import type { ActionItem } from './SpecMenu.js';

/** The pop-up value for "your agent" (whatever your default is when the work starts). */
export const YOUR_AGENT = '';

/**
 * Who does a piece of work (BLG-497), as pop-up entries: "Your agent (Claude)" first (value '',
 * following your default), then every agent and model you can pick, a section per runtime, each
 * with its runtime's mark beside the name. One not set up here stays greyed, saying why. Values
 * are agentChoices' `runtime:model` (agentForChoice turns one into an AgentRef).
 */
export function useAgentEntries(opts: { readonly combos?: boolean } = {}): SelectEntry<string>[] {
  const runtimes = useApp((s) => s.runtimes);
  const models = useApp((s) => s.models);
  const mine = useMyAgent();
  const combos = useComboChoices();
  const withCombos = opts.combos ?? false;
  return useMemo(() => {
    const options = agentChoices(runtimes, models);
    const groups = [...new Set(options.map((o) => o.group))];
    const yours: SelectOption<string> = { value: YOUR_AGENT, label: `Your agent (${agentName(mine)})`, icon: runtimeMark(mine.runtime), description: 'Whatever your default agent is when the work starts' };
    // Combos first (docs/routing.md): each run goes to the first of its agents that can run then.
    const comboSection = withCombos && combos.length ? [{ section: 'Combos', options: combos.map(comboOption) }] : [];
    return [
      yours,
      ...comboSection,
      ...groups.map((group) => ({
        section: group,
        options: options
          .filter((o) => o.group === group)
          .map((o): SelectOption<string> => ({ value: o.value, label: o.label, icon: o.mark, ...(o.disabled ? { disabled: true } : {}), ...(o.why ? { description: o.why } : {}) })),
      })),
    ];
  }, [runtimes, models, mine, combos, withCombos]);
}

/** A combo as a pop-up row: its name, its chain (or why none of it can run now), greyed when none can. */
const comboOption = (c: ComboChoice): SelectOption<string> => ({ value: comboValue(c.id), label: c.name, icon: 'branch', description: c.why ? `${c.summary} · nothing can run now (Settings › Agent › Combos says why)` : c.summary, ...(c.why ? { disabled: true } : {}) });

const sameChoices = (a: readonly ComboChoice[], b: readonly ComboChoice[]): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Your combos as they stand now: each target that can't run says why, the one each would run on. */
export function useComboChoices(): readonly ComboChoice[] {
  return useApp((s) => comboChoices(combosOf(s.prefs.combos, s.runtimes), worldOf(s, Date.now(), hhmm)), sameChoices);
}

/** A pop-up value as an agent, combos included (agentForChoice with your combos). */
export function useAgentForChoice(): (value: string) => AgentRef {
  const runtimes = useApp((s) => s.runtimes);
  const combos = useComboChoices();
  return useCallback((value: string) => agentForChoice(value, runtimes, combos.map((c) => ({ id: c.id, name: c.name, targets: c.targets.map((t) => t.target) }))), [runtimes, combos]);
}

/**
 * The same list as a ••• submenu's rows (BLG-498): a line above each runtime's section, the agent
 * now in use checked (none: your agent). `pick` gets the row's value (YOUR_AGENT or `runtime:model`).
 */
export function agentMenuItems(entries: readonly SelectEntry<string>[], current: AgentRef | undefined, pick: (value: string) => void): ActionItem[] {
  const now = current ? choiceForAgent(current) : YOUR_AGENT;
  const item = (o: SelectOption<string>, separate: boolean): ActionItem => ({
    label: o.label,
    ...(typeof o.icon === 'string' ? { icon: o.icon } : {}),
    ...(o.disabled ? { disabled: true } : {}),
    ...(o.description && o.disabled ? { hint: o.description } : {}),
    ...(separate ? { separate: true } : {}),
    checked: o.value === now,
    onSelect: () => pick(o.value),
  });
  return entries.flatMap((e) => ('section' in e ? e.options.map((o, i) => item(o, i === 0)) : [item(e, false)]));
}

/**
 * "Start with ▸" (BLG-506): the same list (your combos first) as rows of a split button's menu or a submenu, each
 * `${verb} <agent>` with its mark (no verb: the names alone, for a submenu that says it), one not
 * set up here greyed with why. `current`: who the main
 * button starts with (checked; none: your agent). `pick` gets the agent, or undefined for your agent.
 */
export function useStartWith(): (current: AgentRef | undefined, pick: (agent: AgentRef | undefined) => void, verb?: string) => ActionItem[] {
  const entries = useAgentEntries({ combos: true });
  const toAgent = useAgentForChoice();
  return useCallback(
    (current, pick, verb = 'Start with') =>
      agentMenuItems(entries, current, (v) => pick(v === YOUR_AGENT ? undefined : toAgent(v))).map((it) => (verb ? { ...it, label: `${verb} ${it.label.startsWith('Your agent') ? `y${it.label.slice(1)}` : it.label}` } : it)),
    [entries, toAgent],
  );
}
