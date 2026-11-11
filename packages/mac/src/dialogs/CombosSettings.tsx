import { useState } from 'react';
import { type CategoryRoute, type Combo, type ComboPrivacy, type Difficulty, type Role, type RouteTarget, type WorkCategory, CATEGORY_INFO, WORK_CATEGORIES, DIFFICULTIES, ROLES, DEFAULT_COMBOS, MAX_COMBOS, MAX_TARGETS, comboIdFor, comboUsage, comboUsageWords, combosOf, targetLabel } from '@beluga/core/routing/model.js';
import { LOCAL_RUNTIME, OLLAMA_ID, parseLocalModel } from '@beluga/shared/local-endpoints.js';
import { DEFAULT_BASELINE, SAVINGS_BASELINES, baselineWords } from '@beluga/core/routing/outcomes.js';
import type { RuntimeChoice } from '@beluga/shared/agent-runtimes.js';
import { useComboChoices } from '../components/agent-options.js';
import { Select } from '../components/Select.js';
import { Button, Dot } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { Group, Row } from './settings-controls.js';
import s from './settings.module.css';

const PRIVACY: ReadonlyArray<{ readonly value: ComboPrivacy; readonly label: string; readonly description: string }> = [
  { value: 'any', label: 'Any of them', description: 'Every target may take the work' },
  { value: 'no-third-party', label: 'No third parties', description: 'Only the agents’ own vendors, and endpoints on this computer' },
  { value: 'local-only', label: 'This computer only', description: 'Only endpoints running here' },
];

const DIFFICULTY_LABEL: Readonly<Record<Difficulty, string>> = { simple: 'Simple', normal: 'Normal', hard: 'Hard' };

const EFFORTS: ReadonlyArray<{ readonly value: NonNullable<CategoryRoute['effort']>; readonly label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
  { value: 'max', label: 'Max' },
];

/** Two pickers side by side (a kind's combo and its effort). */
const PAIR = { display: 'flex', gap: 6, alignItems: 'center' } as const;

const ROLE_LABEL: Readonly<Record<Role, string>> = { planHead: 'Plan head', milestone: 'Milestones', checker: 'Checker', reviewer: 'PR reviewer' };

/** Several pickers in one row, one under the other. */
const STACK = { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 } as const;

const errorText = (err: unknown): string => (err instanceof Error ? err.message.replace(/^Bad arguments for [\w.]+: /, '') : String(err));

/** A target as a pop-up value and back: `runtime|model|effort|endpoint`. */
const targetValue = (t: RouteTarget): string => [t.runtime, t.model ?? '', t.effort ?? '', t.endpoint ?? ''].join('|');
function targetOf(value: string): RouteTarget {
  const [runtime = 'claude', model, effort, endpoint] = value.split('|');
  return { runtime, ...(model ? { model } : {}), ...(effort ? { effort: effort as RouteTarget['effort'] } : {}), ...(endpoint ? { endpoint } : {}) };
}

/** What can be added to a combo: Claude's models, every other runtime (Codex at high effort too), each endpoint and its models. */
function targetChoices(runtimes: readonly RuntimeChoice[], claudeModels: ReadonlyArray<{ readonly value: string }>): RouteTarget[] {
  const out: RouteTarget[] = [];
  for (const r of runtimes) {
    if (r.id === 'claude') {
      const models = claudeModels.map((m) => m.value).filter(Boolean);
      for (const model of models.length ? models : ['opus', 'sonnet', 'haiku']) out.push({ runtime: 'claude', model });
    } else if (r.id === LOCAL_RUNTIME) {
      out.push({ runtime: LOCAL_RUNTIME });
      const endpoints = new Set<string>([OLLAMA_ID]);
      for (const m of r.models ?? []) {
        const at = parseLocalModel(m.value);
        if (at) endpoints.add(at.id);
      }
      for (const endpoint of endpoints) out.push({ runtime: LOCAL_RUNTIME, endpoint });
    } else {
      out.push({ runtime: r.id });
      if (r.id === 'codex') out.push({ runtime: 'codex', effort: 'high' });
    }
  }
  return out;
}

/**
 * Settings › Agent › Combos (docs/routing.md): named chains of agents and models a conversation, a
 * task or Start with ▸ picks instead of one model. Each run goes to the first target that can run
 * then (set up, signed in, answering, not at its usage limit, allowed by the combo's privacy). Until
 * you change one, the defaults as this computer has them; a change saves the whole list.
 */
export function CombosSettings() {
  const api = useApi();
  const runtimes = useApp((st) => st.runtimes);
  const claudeModels = useApp((st) => st.models);
  const saved = useApp((st) => st.prefs.combos);
  const choices = useComboChoices();
  // Each combo's runs so far, by target (docs/routing.md, Phase 5).
  const usage = useApp((st) => comboUsage(st.log, st.selfId), (a, b) => JSON.stringify(a) === JSON.stringify(b));
  const combos = combosOf(saved, runtimes);
  const [draft, setDraft] = useState<Combo & { readonly isNew?: boolean }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const options = targetChoices(runtimes, claudeModels);
  const byDifficulty = useApp((st) => st.prefs.difficultyCombos);
  const byRole = useApp((st) => st.prefs.roleCombos);
  const byKind = useApp((st) => st.prefs.categoryCombos);
  const baseline = useApp((st) => st.prefs.savingsBaseline ?? DEFAULT_BASELINE);
  const setKind = (k: WorkCategory, route: CategoryRoute | undefined): void => {
    const { [k]: _old, ...rest } = byKind ?? {};
    const next = route ? { ...rest, [k]: route } : rest;
    void api.session.setPrefs({ categoryCombos: Object.keys(next).length ? next : null });
  };
  const setRole = (r: Role, id: string): void => {
    const { [r]: _old, ...rest } = byRole ?? {};
    const next = id ? { ...rest, [r]: id } : rest;
    void api.session.setPrefs({ roleCombos: Object.keys(next).length ? next : null });
  };
  const setDifficulty = (d: Difficulty, id: string): void => {
    const { [d]: _old, ...rest } = byDifficulty ?? {};
    const next = id ? { ...rest, [d]: id } : rest;
    void api.session.setPrefs({ difficultyCombos: Object.keys(next).length ? next : null });
  };

  const saveAll = async (list: readonly Combo[]): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await api.routing.setCombos([...list]);
      setDraft(undefined);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  // The first change saves the whole list: a default you didn't touch keeps all its targets (the ones this computer can't run now are skipped when a run starts, not dropped).
  const whole = (list: readonly Combo[], changed?: string): Combo[] => list.map((c) => (saved || c.id === changed ? c : (DEFAULT_COMBOS.find((x) => x.id === c.id) ?? c)));
  const saveDraft = (d: Combo & { readonly isNew?: boolean }): void => {
    const { isNew: _n, ...combo } = d;
    const named = { ...combo, name: combo.name.trim() };
    void saveAll(whole(d.isNew ? [...combos, named] : combos.map((c) => (c.id === named.id ? named : c)), named.id));
  };

  const move = (i: number, by: number): void => {
    if (!draft) return;
    const targets = [...draft.targets];
    const [t] = targets.splice(i, 1);
    if (t) targets.splice(Math.max(0, Math.min(targets.length, i + by)), 0, t);
    setDraft({ ...draft, targets });
  };

  const form = draft ? (
    <form
      className={s.endpointForm}
      onSubmit={(ev) => {
        ev.preventDefault();
        saveDraft(draft);
      }}
    >
      <label className={s.endpointField}>
        <span>Name</span>
        <input className={s.text} aria-label="Combo name" value={draft.name} maxLength={40} onChange={(ev) => setDraft({ ...draft, name: ev.target.value })} autoFocus />
      </label>
      {draft.targets.map((t, i) => (
        <div key={`${targetValue(t)}-${i}`} className={s.endpointField}>
          <span>{i === 0 ? 'First' : 'Then'}</span>
          <span className={s.rowLabel}>{targetLabel(t, runtimes)}</span>
          <Button size="small" variant="quiet" icon="chevronUp" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" />
          <Button size="small" variant="quiet" icon="chevronDown" disabled={i === draft.targets.length - 1} onClick={() => move(i, 1)} aria-label="Move down" />
          <Button size="small" variant="quiet" icon="x" disabled={draft.targets.length === 1} onClick={() => setDraft({ ...draft, targets: draft.targets.filter((_, j) => j !== i) })} aria-label="Remove" />
        </div>
      ))}
      {draft.targets.length < MAX_TARGETS ? (
        <label className={s.endpointField}>
          <span>Add</span>
          <Select label="Add a target" value="" placeholder="Add a target…" options={options.map((t) => ({ value: targetValue(t), label: targetLabel(t, runtimes) }))} onChange={(v) => v && setDraft({ ...draft, targets: [...draft.targets, targetOf(v)] })} />
        </label>
      ) : null}
      <label className={s.endpointField}>
        <span>Privacy</span>
        <Select label="Privacy" value={draft.privacy ?? 'any'} options={PRIVACY.map((p) => ({ value: p.value, label: p.label, description: p.description }))} onChange={(v) => setDraft({ ...draft, ...(v === 'any' ? { privacy: undefined } : { privacy: v }) })} />
      </label>
      {error ? <div className={s.endpointError}>{error}</div> : null}
      <div className={s.endpointBar}>
        <Button size="small" variant="quiet" onClick={() => setDraft(undefined)}>
          Cancel
        </Button>
        <Button size="small" variant="primary" type="submit" disabled={busy || !draft.name.trim() || !draft.targets.length}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  ) : null;

  return (
    <Group title="Combos">
      <Row label="Agents in order" detail="A combo is a list of agents and models. Pick one in the agent box, New Task or Start with: each run goes to the first that can run then, skipping one that isn’t set up, isn’t signed in, isn’t answering or is at its usage limit.">
        {saved ? (
          <Button variant="quiet" disabled={busy} onClick={() => void api.routing.resetCombos().catch((err: unknown) => setError(errorText(err)))}>
            Use the Defaults
          </Button>
        ) : null}
        <Button
          icon="plus"
          disabled={busy || combos.length >= MAX_COMBOS}
          onClick={() => {
            setError('');
            setDraft({ id: comboIdFor('New combo', combos.map((c) => c.id)), name: 'New combo', targets: options.slice(0, 1), isNew: true });
          }}
        >
          New Combo
        </Button>
      </Row>
      {draft?.isNew ? form : null}
      {combos.map((c) => {
        if (draft?.id === c.id && !draft.isNew) return <div key={c.id}>{form}</div>;
        const now = choices.find((x) => x.id === c.id);
        const privacy = c.privacy && c.privacy !== 'any' ? ` · ${PRIVACY.find((p) => p.value === c.privacy)?.label}` : '';
        const used = usage.find((u) => u.combo === c.id);
        return (
          <Row key={c.id} label={c.name} detail={`${now?.summary ?? ''}${privacy}${now?.now ? ` · now: ${now.now}` : now?.why ? ` · Can’t run now: ${now.why.replace(/^Nothing in .+? can run now: /, '')}` : ''}${used ? ` · ${comboUsageWords(used)}` : ''}`}>
            <Dot tone={now?.now ? 'ok' : 'warn'} />
            <Button size="small" variant="quiet" disabled={busy} onClick={() => (setError(''), setDraft(c))}>
              Edit…
            </Button>
            <Button size="small" variant="quiet" disabled={busy} onClick={() => void saveAll(whole(combos.filter((x) => x.id !== c.id)))}>
              Delete
            </Button>
          </Row>
        );
      })}
      {error && !draft ? <div className={s.endpointError}>{error}</div> : null}
      {/* The pickers stack, one per line: side by side they squeeze the words to a word a line. */}
      <Row label="By how hard a task is" detail="A task names how hard it looks when your agent writes it. One that names no agent of its own starts on this combo.">
        <div style={STACK}>
          {DIFFICULTIES.map((d) => (
            <Select key={d} label={`${DIFFICULTY_LABEL[d]} tasks`} value={byDifficulty?.[d] ?? ''} options={[{ value: '', label: `${DIFFICULTY_LABEL[d]}: your agent` }, ...combos.map((c) => ({ value: c.id, label: `${DIFFICULTY_LABEL[d]}: ${c.name}` }))]} onChange={(v) => setDifficulty(d, v)} />
          ))}
        </div>
      </Row>
      <Row label="By kind of work" detail="A task also says what kind of work it is (its drafter, or a quick look for one you made by hand). One that names no agent of its own starts on this combo, at this effort, over the one for how hard it is.">
        <div style={STACK}>
          {WORK_CATEGORIES.map((k) => {
            const route = byKind?.[k];
            return (
              <div key={k} style={PAIR}>
                <Select label={`${CATEGORY_INFO[k].label} work`} value={route?.combo ?? ''} options={[{ value: '', label: `${CATEGORY_INFO[k].label}: by difficulty`, description: CATEGORY_INFO[k].hint }, ...combos.map((c) => ({ value: c.id, label: `${CATEGORY_INFO[k].label}: ${c.name}`, description: CATEGORY_INFO[k].hint }))]} onChange={(v) => setKind(k, v ? { combo: v, ...(route?.effort ? { effort: route.effort } : {}) } : undefined)} />
                {route ? <Select label={`${CATEGORY_INFO[k].label} effort`} value={route.effort ?? ''} options={[{ value: '', label: 'Its own effort' }, ...EFFORTS.map((e) => ({ value: e.value, label: e.label }))]} onChange={(v) => setKind(k, { combo: route.combo, ...(v ? { effort: v as CategoryRoute['effort'] } : {}) })} /> : null}
              </div>
            );
          })}
        </div>
      </Row>
      <Row label="Savings against" detail="Usage › Combos says what your runs saved, priced against running everything on one model.">
        <Select label="Savings against" value={baseline} options={SAVINGS_BASELINES.map((b) => ({ value: b, label: baselineWords(b).replace(/^e/, 'E') }))} onChange={(v) => void api.session.setPrefs({ savingsBaseline: v === DEFAULT_BASELINE ? null : (v as (typeof SAVINGS_BASELINES)[number]) })} />
      </Row>
      <Row label="By role" detail="The combo each role of a plan, and the pull-request reviewer, runs on. Pick one of another vendor for the checker to have work checked by a different model.">
        <div style={STACK}>
          {ROLES.map((r) => (
            <Select key={r} label={ROLE_LABEL[r]} value={byRole?.[r] ?? ''} options={[{ value: '', label: `${ROLE_LABEL[r]}: as now` }, ...combos.map((c) => ({ value: c.id, label: `${ROLE_LABEL[r]}: ${c.name}` }))]} onChange={(v) => setRole(r, v)} />
          ))}
        </div>
      </Row>
    </Group>
  );
}
