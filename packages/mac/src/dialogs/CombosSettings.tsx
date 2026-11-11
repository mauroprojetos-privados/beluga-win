import { useState } from 'react';
import { type CategoryRoute, type Combo, type ComboPrivacy, type Difficulty, type Role, type RouteTarget, type WorkCategory, WORK_CATEGORIES, DIFFICULTIES, ROLES, DEFAULT_COMBOS, MAX_COMBOS, MAX_TARGETS, comboIdFor, comboUsage, comboUsageWords, combosOf, targetLabel } from '@beluga/core/routing/model.js';
import { LOCAL_RUNTIME, OLLAMA_ID, parseLocalModel } from '@beluga/shared/local-endpoints.js';
import { DEFAULT_BASELINE, SAVINGS_BASELINES, baselineWords } from '@beluga/core/routing/outcomes.js';
import type { RuntimeChoice } from '@beluga/shared/agent-runtimes.js';
import { useComboChoices } from '../components/agent-options.js';
import { Select } from '../components/Select.js';
import { Button, Dot } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { say, useT } from '../lib/i18n.js';
import { t as tr } from '@beluga/shared/i18n/index.js';
import { Group, Row } from './settings-controls.js';
import s from './settings.module.css';
import { categoryHint, categoryLabel } from '@beluga/shared/i18n/words.js';

const PRIVACY = (): ReadonlyArray<{ readonly value: ComboPrivacy; readonly label: string; readonly description: string }> => [
  { value: 'any', label: tr('routing.combos.privacy.any'), description: tr('routing.combos.privacy.anyDetail') },
  { value: 'no-third-party', label: tr('routing.combos.privacy.noThirdParty'), description: tr('routing.combos.privacy.noThirdPartyDetail') },
  { value: 'local-only', label: tr('routing.combos.privacy.localOnly'), description: tr('routing.combos.privacy.localOnlyDetail') },
];

const difficultyLabel = (d: Difficulty): string => tr(`routing.combos.difficulty.${d}`);

const EFFORTS = (): ReadonlyArray<{ readonly value: NonNullable<CategoryRoute['effort']>; readonly label: string }> =>
  (['low', 'medium', 'high', 'xhigh', 'max'] as const).map((value) => ({ value, label: tr(`routing.effort.${value}`) }));

/** Two pickers side by side (a kind's combo and its effort). */
const PAIR = { display: 'flex', gap: 6, alignItems: 'center' } as const;

const roleLabel = (r: Role): string => tr(`routing.combos.role.${r}`);

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
  const t = useT();
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
        <span>{t('routing.combos.name')}</span>
        <input className={s.text} aria-label={t('routing.combos.nameAria')} value={draft.name} maxLength={40} onChange={(ev) => setDraft({ ...draft, name: ev.target.value })} autoFocus />
      </label>
      {draft.targets.map((x, i) => (
        <div key={`${targetValue(x)}-${i}`} className={s.endpointField}>
          <span>{i === 0 ? t('routing.combos.first') : t('routing.combos.then')}</span>
          <span className={s.rowLabel}>{targetLabel(x, runtimes)}</span>
          <Button size="small" variant="quiet" icon="chevronUp" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('routing.combos.moveUp')} />
          <Button size="small" variant="quiet" icon="chevronDown" disabled={i === draft.targets.length - 1} onClick={() => move(i, 1)} aria-label={t('routing.combos.moveDown')} />
          <Button size="small" variant="quiet" icon="x" disabled={draft.targets.length === 1} onClick={() => setDraft({ ...draft, targets: draft.targets.filter((_, j) => j !== i) })} aria-label={t('routing.combos.remove')} />
        </div>
      ))}
      {draft.targets.length < MAX_TARGETS ? (
        <label className={s.endpointField}>
          <span>{t('routing.combos.add')}</span>
          <Select label={t('routing.combos.addTarget')} value="" placeholder={t('routing.combos.addTargetPlaceholder')} options={options.map((x) => ({ value: targetValue(x), label: targetLabel(x, runtimes) }))} onChange={(v) => v && setDraft({ ...draft, targets: [...draft.targets, targetOf(v)] })} />
        </label>
      ) : null}
      <label className={s.endpointField}>
        <span>{t('routing.combos.privacy')}</span>
        <Select label={t('routing.combos.privacy')} value={draft.privacy ?? 'any'} options={PRIVACY().map((p) => ({ value: p.value, label: p.label, description: p.description }))} onChange={(v) => setDraft({ ...draft, ...(v === 'any' ? { privacy: undefined } : { privacy: v }) })} />
      </label>
      {error ? <div className={s.endpointError}>{error}</div> : null}
      <div className={s.endpointBar}>
        <Button size="small" variant="quiet" onClick={() => setDraft(undefined)}>
          {t('common.cancel')}
        </Button>
        <Button size="small" variant="primary" type="submit" disabled={busy || !draft.name.trim() || !draft.targets.length}>
          {busy ? t('routing.combos.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  ) : null;

  return (
    <Group title={say('Combos')}>
      <Row label={say('Agents in order')} detail={t('routing.combos.inOrderDetail')}>
        {saved ? (
          <Button variant="quiet" disabled={busy} onClick={() => void api.routing.resetCombos().catch((err: unknown) => setError(errorText(err)))}>
            {t('routing.combos.useDefaults')}
          </Button>
        ) : null}
        <Button
          icon="plus"
          disabled={busy || combos.length >= MAX_COMBOS}
          onClick={() => {
            setError('');
            // i18n-ignore: the id is made from the English name, whatever the language
            setDraft({ id: comboIdFor('New combo', combos.map((c) => c.id)), name: t('routing.combos.newName'), targets: options.slice(0, 1), isNew: true });
          }}
        >
          {t('routing.combos.newCombo')}
        </Button>
      </Row>
      {draft?.isNew ? form : null}
      {combos.map((c) => {
        if (draft?.id === c.id && !draft.isNew) return <div key={c.id}>{form}</div>;
        const now = choices.find((x) => x.id === c.id);
        const privacy = c.privacy && c.privacy !== 'any' ? ` · ${PRIVACY().find((p) => p.value === c.privacy)?.label}` : '';
        const used = usage.find((u) => u.combo === c.id);
        const state = now?.now ? t('routing.combos.now', { now: now.now }) : now?.why ? t('routing.combos.cantRun', { why: now.why.replace(/^Nothing in .+? can run now: /, '') }) : '';
        return (
          <Row key={c.id} label={c.name} detail={`${now?.summary ?? ''}${privacy}${state}${used ? ` · ${comboUsageWords(used)}` : ''}`}>
            <Dot tone={now?.now ? 'ok' : 'warn'} />
            <Button size="small" variant="quiet" disabled={busy} onClick={() => (setError(''), setDraft(c))}>
              {t('routing.combos.edit')}
            </Button>
            <Button size="small" variant="quiet" disabled={busy} onClick={() => void saveAll(whole(combos.filter((x) => x.id !== c.id)))}>
              {t('common.delete')}
            </Button>
          </Row>
        );
      })}
      {error && !draft ? <div className={s.endpointError}>{error}</div> : null}
      {/* The pickers stack, one per line: side by side they squeeze the words to a word a line. */}
      <Row label={say('By how hard a task is')} detail={t('routing.combos.byHardDetail')}>
        <div style={STACK}>
          {DIFFICULTIES.map((d) => (
            <Select key={d} label={t('routing.combos.difficultyTasks', { difficulty: difficultyLabel(d) })} value={byDifficulty?.[d] ?? ''} options={[{ value: '', label: t('routing.combos.difficultyYourAgent', { difficulty: difficultyLabel(d) }) }, ...combos.map((c) => ({ value: c.id, label: t('routing.combos.pickedCombo', { what: difficultyLabel(d), name: c.name }) }))]} onChange={(v) => setDifficulty(d, v)} />
          ))}
        </div>
      </Row>
      <Row label={say('By kind of work')} detail={t('routing.combos.byKindDetail')}>
        <div style={STACK}>
          {WORK_CATEGORIES.map((k) => {
            const route = byKind?.[k];
            const kind = categoryLabel(k);
            return (
              <div key={k} style={PAIR}>
                <Select label={t('routing.combos.kindWork', { kind })} value={route?.combo ?? ''} options={[{ value: '', label: t('routing.combos.kindByDifficulty', { kind }), description: categoryHint(k) }, ...combos.map((c) => ({ value: c.id, label: t('routing.combos.pickedCombo', { what: kind, name: c.name }), description: categoryHint(k) }))]} onChange={(v) => setKind(k, v ? { combo: v, ...(route?.effort ? { effort: route.effort } : {}) } : undefined)} />
                {route ? <Select label={t('routing.combos.kindEffort', { kind })} value={route.effort ?? ''} options={[{ value: '', label: t('routing.combos.ownEffort') }, ...EFFORTS().map((e) => ({ value: e.value, label: e.label }))]} onChange={(v) => setKind(k, { combo: route.combo, ...(v ? { effort: v as CategoryRoute['effort'] } : {}) })} /> : null}
              </div>
            );
          })}
        </div>
      </Row>
      <Row label={say('Savings against')} detail={t('routing.combos.savingsDetail')}>
        <Select label={t('routing.combos.savings')} value={baseline} options={SAVINGS_BASELINES.map((b) => ({ value: b, label: baselineWords(b).replace(/^e/, 'E') }))} onChange={(v) => void api.session.setPrefs({ savingsBaseline: v === DEFAULT_BASELINE ? null : (v as (typeof SAVINGS_BASELINES)[number]) })} />
      </Row>
      <Row label={say('By role')} detail={t('routing.combos.byRoleDetail')}>
        <div style={STACK}>
          {ROLES.map((r) => (
            <Select key={r} label={roleLabel(r)} value={byRole?.[r] ?? ''} options={[{ value: '', label: t('routing.combos.roleAsNow', { role: roleLabel(r) }) }, ...combos.map((c) => ({ value: c.id, label: t('routing.combos.pickedCombo', { what: roleLabel(r), name: c.name }) }))]} onChange={(v) => setRole(r, v)} />
          ))}
        </div>
      </Row>
    </Group>
  );
}
