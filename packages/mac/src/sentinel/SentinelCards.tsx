import { useMemo, useRef, useState } from 'react';
import {
  type AfterTrigger,
  type ClaudeStep,
  type FriendStep,
  type HttpStep,
  type MergeStep,
  type MessageStep,
  type NotifyStep,
  type PrStep,
  type ScheduleTrigger,
  type ScriptStep,
  type Sentinel,
  type SentinelPatch,
  type Step,
  type TriggerStep,
  DAY_NAMES,
  SERVICE_PRESETS,
  STEP_INFO,
  accessAllows,
  ordinal,
  presetFields,
  scheduleSentence,
  stepAvailable,
  stepRefusal,
  stepSentence,
  SCRIPT_LANGUAGES,
  SCRIPT_LANGUAGE_INFO,
  type ScriptLanguage,
} from '@beluga/core/sentinel/model.js';
import { Checkbox, TextArea, TextInput } from '../components/FormSheet.js';
import { CodeEditor } from '../components/markdown/CodeEditor.js';
import { Icon } from '../components/Icon.js';
import { Select } from '../components/Select.js';
import { useAgentEntries } from '../components/agent-options.js';
import { type ActionItem, ActionsDropdown } from '../components/SpecMenu.js';
import { Button, IconButton, Segmented } from '../components/ui.js';
import { useApp } from '../lib/beluga.js';
import { openSheet } from '../lib/sheets.js';
import {
  AFTER_ON,
  CLAUDE_PRESETS,
  EVERY_CHOICES,
  HOURS_CHOICES,
  later as later_,
  STEP_ICON,
  templateHelp,
  HTTP_METHODS,
  secretsNote,
  SERVICE_CHOICES,
  WEEK,
  chatChoices,
  duplicateStep,
  headerRows,
  mergeWords,
  moveStep,
  newStep,
  otherSentinels,
  patchStep,
  rowsToHeaders,
  stepChoices,
  toggleDay,
  triggerChoices,
  triggerOfKind,
  withEvery,
  agentFields,
  stepAgentChoice,
} from './sentinel-model.js';
import { EventControls } from './EventControls.js';
import { MeasureFields } from './MeasureFields.js';
import { useDraft } from './use-draft.js';
import { sentinelGraph } from '@beluga/core/sentinel/workflow.js';
import { GraphBlock } from '../components/graph/GraphBlock.js';
import s from './sentinel.module.css';
import { ASSISTANT_TITLE, THIS_COMPUTER } from '@beluga/shared/assistant.js';
import { computerWord } from '../lib/os-words.js';
import { useT } from '../lib/i18n.js';

type T = ReturnType<typeof useT>;

/** The sentinel page's editor: When it runs, and its Steps. Everything saves as you change it. */

export type Save = (patch: SentinelPatch) => void;

const nameOf =
  (items: readonly Sentinel[]) =>
  (id: string): string | undefined =>
    items.find((i) => i.id === id)?.name;

export function WhenCard({ item, save }: { item: Sentinel; save: Save }) {
  const t = useT();
  const items = useApp((st) => st.sentinel.items);
  const tr = item.trigger;
  const choices = triggerChoices();
  return (
    <section className={s.card} aria-label={t('sentinel.cards.when')}>
      <header className={s.cardHead}>
        <h3 className={s.cardTitle}>{t('sentinel.cards.when')}</h3>
      </header>
      <p className={s.sentence} data-testid="sentinel-sentence">
        {scheduleSentence(tr, nameOf(items))}
      </p>
      <div className={s.controls}>
        <div className={s.controlRow}>
          <span className={s.controlLabel}>{t('sentinel.cards.whatStarts')}</span>
          <Select
            label={t('sentinel.cards.whatStarts')}
            size="small"
            value={tr.kind}
            options={choices}
            onChange={(k) => {
              const next = triggerOfKind(k, tr);
              if (next) save({ trigger: next });
            }}
          />
        </div>
        {tr.kind === 'schedule' ? <ScheduleControls t={tr} save={save} /> : null}
        {tr.kind === 'manual' ? <p className={s.hint}>{t('sentinel.cards.manualHint')}</p> : null}
        {tr.kind === 'after' ? <AfterControls t={tr} item={item} items={items} save={save} /> : null}
        {tr.kind !== 'schedule' && tr.kind !== 'manual' && tr.kind !== 'after' ? <EventControls item={item} save={save} /> : null}
      </div>
    </section>
  );
}

function AfterControls({ t: tr, item, items, save }: { t: AfterTrigger; item: Sentinel; items: readonly Sentinel[]; save: Save }) {
  const t = useT();
  const others = otherSentinels(items, item.id);
  return (
    <>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.cards.after')}</span>
        {others.length ? (
          <Select label={t('sentinel.cards.afterWhich')} size="small" value={tr.sentinelId} placeholder={t('sentinel.cards.pickSentinel')} options={others} onChange={(sentinelId) => save({ trigger: { ...tr, sentinelId } })} />
        ) : (
          <span className={s.hint}>{t('sentinel.cards.noOtherToFollow')}</span>
        )}
      </div>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.cards.runs')}</span>
        <Select label={t('sentinel.cards.whenAfter')} size="small" value={tr.on} options={AFTER_ON} onChange={(on) => save({ trigger: { ...tr, on } })} />
      </div>
      <p className={s.hint}>{t('sentinel.cards.afterHint')}</p>
    </>
  );
}

function ScheduleControls({ t: tr, save }: { t: ScheduleTrigger; save: Save }) {
  const t = useT();
  const set = (next: ScheduleTrigger): void => save({ trigger: next });
  return (
    <>
      <div className={s.every}>
        <Segmented label={t('sentinel.cards.howOften')} value={tr.every} onChange={(every) => set(withEvery(tr, every))} options={EVERY_CHOICES} />
      </div>
      {tr.every === 'hours' ? (
        <div className={s.controlRow}>
          <span className={s.controlLabel}>{t('sentinel.cards.every')}</span>
          <Select label={t('sentinel.cards.everyHours')} size="small" value={String(tr.hours ?? 1)} options={HOURS_CHOICES.map((h) => ({ value: String(h), label: t('sentinel.cards.hours', { count: h }) }))} onChange={(h) => set({ ...tr, hours: Number(h) as ScheduleTrigger['hours'] & number })} />
        </div>
      ) : (
        <div className={s.controlRow}>
          <span className={s.controlLabel}>{t('sentinel.cards.at')}</span>
          <input
            type="time"
            className={s.time}
            aria-label={t('sentinel.cards.atTime')}
            value={tr.at}
            onChange={(e) => {
              if (/^\d{2}:\d{2}$/.test(e.target.value)) set({ ...tr, at: e.target.value });
            }}
          />
        </div>
      )}
      {tr.every === 'week' ? (
        <div className={s.controlRow}>
          <span className={s.controlLabel}>{t('sentinel.cards.on')}</span>
          <span className={s.days} role="group" aria-label={t('sentinel.cards.daysOfWeek')}>
            {WEEK.map((d) => {
              const on = (tr.days?.length ? tr.days : [1]).includes(d);
              return (
                <button key={d} type="button" className={s.day} aria-pressed={on} onClick={() => set({ ...tr, days: toggleDay(tr.days, d) })}>
                  {DAY_NAMES[d]}
                </button>
              );
            })}
          </span>
        </div>
      ) : null}
      {tr.every === 'month' ? (
        <div className={s.controlRow}>
          <span className={s.controlLabel}>{t('sentinel.cards.onThe')}</span>
          <Select label={t('sentinel.cards.dayOfMonth')} size="small" value={String(tr.day ?? 1)} options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: ordinal(i + 1) }))} onChange={(d) => set({ ...tr, day: Number(d) })} />
        </div>
      ) : null}
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.cards.asleep', { computer: computerWord() })}</span>
        <Select
          label={t('sentinel.cards.asleep', { computer: computerWord() })}
          size="small"
          value={tr.missed}
          options={[
            { value: 'catch-up', label: t('sentinel.cards.catchUp'), description: t('sentinel.cards.catchUpLine') },
            { value: 'skip', label: t('sentinel.cards.skip'), description: t('sentinel.cards.skipLine') },
          ]}
          onChange={(missed) => set({ ...tr, missed })}
        />
      </div>
    </>
  );
}

export function StepsCard({ item, save }: { item: Sentinel; save: Save }) {
  const t = useT();
  const items = useApp((st) => st.sentinel.items);
  const [open, setOpen] = useState<string>();
  const latest = useRef(item);
  latest.current = item;
  const setSteps = (steps: Parameters<Save>[0]['steps']): void => save({ steps });
  const change = (id: string, patch: Partial<Step>): void => setSteps(patchStep(latest.current.steps, id, patch));
  const add: ActionItem[] = stepChoices(item.access).map((c) => ({
    label: c.label,
    icon: STEP_ICON[c.kind],
    hint: c.hint,
    disabled: c.disabled,
    onSelect: () => {
      if (c.disabled) return;
      setSteps([...latest.current.steps, newStep(c.kind)]);
      // The new one opens (its id comes back from the daemon: open the last one then).
      setOpen('last');
    },
  }));
  const steps = item.steps;
  const [look, setLook] = useState<'list' | 'graph'>('list');
  return (
    <section className={s.card} aria-label={t('sentinel.cards.steps')}>
      <header className={s.cardHead}>
        <h3 className={s.cardTitle}>{t('sentinel.cards.steps')}</h3>
        <span className={s.grow} />
        {steps.length ? (
          <Segmented<'list' | 'graph'>
            label={t('sentinel.cards.showStepsAs')}
            value={look}
            onChange={setLook}
            options={[
              { value: 'list', label: t('sentinel.cards.list'), icon: 'rows' },
              { value: 'graph', label: t('sentinel.cards.graph'), icon: 'graph' },
            ]}
          />
        ) : null}
      </header>
      {look === 'graph' && steps.length ? (
        <WorkflowGraph item={item} />
      ) : steps.length ? (
        <div className={s.steps} role="list">
          {steps.map((st, i) => (
            <StepItem
              key={st.id}
              step={st}
              index={i}
              count={steps.length}
              open={open === st.id || (open === 'last' && i === steps.length - 1)}
              toggle={() => setOpen(open === st.id || (open === 'last' && i === steps.length - 1) ? undefined : st.id)}
              item={item}
              nameOf={nameOf(items)}
              change={(patch) => change(st.id, patch)}
              move={(by) => setSteps(moveStep(latest.current.steps, i, by))}
              duplicate={() => setSteps(duplicateStep(latest.current.steps, i))}
              remove={() => setSteps(latest.current.steps.filter((x) => x.id !== st.id))}
            />
          ))}
        </div>
      ) : (
        <p className={s.empty}>{t('sentinel.cards.noSteps')}</p>
      )}
      <div className={s.addStep}>
        <ActionsDropdown items={add} align="start">
          <Button size="small" icon="plus">
            {t('sentinel.cards.addStep')}
          </Button>
        </ActionsDropdown>
      </div>
    </section>
  );
}

/**
 * The steps as a workflow (BLG-352): what starts it, each step with what it hands the next, where its
 * results land (dashboards, other sentinels), and its last run's states. A node's card says what it does.
 */
function WorkflowGraph({ item }: { item: Sentinel }) {
  const items = useApp((st) => st.sentinel.items);
  const runs = useApp((st) => st.sentinel.runs);
  const dashboards = useApp((st) => st.sentinel.dashboards);
  const run = useMemo(() => [...runs].reverse().find((r) => r.sentinelId === item.id), [runs, item.id]);
  const graph = useMemo(() => sentinelGraph(item, { items, ...(run ? { run } : {}), ...(dashboards ? { dashboards } : {}) }), [item, items, run, dashboards]);
  // Its layout follows its nodes and lines; a run moving along only recolours them.
  const shape = JSON.stringify([graph.nodes.map((n) => [n.id, n.label]), graph.edges.map((e) => e.id)]);
  return (
    <div className={s.workflow}>
      <GraphBlock code={JSON.stringify(graph)} shapeKey={shape} />
    </div>
  );
}

function StepItem({
  step,
  index,
  count,
  open,
  toggle,
  item,
  nameOf,
  change,
  move,
  duplicate,
  remove,
}: {
  step: Step;
  index: number;
  count: number;
  open: boolean;
  toggle: () => void;
  item: Sentinel;
  nameOf: (id: string) => string | undefined;
  change: (patch: Partial<Step>) => void;
  move: (by: number) => void;
  duplicate: () => void;
  remove: () => void;
}) {
  const t = useT();
  const name = useDraft(step.name, (v) => {
    const next = v.replace(/\s+/g, ' ').trim();
    if (next && next !== step.name) change({ name: next });
  });
  const later = !stepAvailable(step.kind);
  const menu: ActionItem[] = [
    { label: t('sentinel.cards.moveUp'), icon: 'up', disabled: index === 0, onSelect: () => move(-1) },
    { label: t('sentinel.cards.moveDown'), icon: 'chevronDown', disabled: index === count - 1, onSelect: () => move(1) },
    { label: t('sentinel.cards.duplicate'), icon: 'copy', separate: true, disabled: later, onSelect: duplicate },
    { label: t('sentinel.cards.remove'), danger: true, separate: true, onSelect: remove },
  ];
  return (
    <div className={s.step} role="listitem" data-step={step.kind}>
      <div
        className={s.stepRow}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('input, button')) return;
          if (!later) toggle();
        }}
      >
        <span className={s.stepIndex}>{index + 1}</span>
        <span className={s.chip} data-kind={step.kind} aria-hidden="true">
          <Icon name={STEP_ICON[step.kind]} size={11} />
        </span>
        <span className={s.stepText}>
          <input
            className={s.stepName}
            value={name.text}
            aria-label={t('sentinel.cards.stepName', { n: index + 1 })}
            spellCheck={false}
            onChange={(e) => name.change(e.target.value)}
            onBlur={name.flush}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
          <span className={s.stepLine}>
            {STEP_INFO[step.kind].label} · {stepSentence(step, nameOf)}
          </span>
          {later ? <span className={s.stepLater}>{t('sentinel.cards.laterStops', { later: later_() })}</span> : null}
        </span>
        {later ? null : <IconButton icon={open ? 'chevronUp' : 'chevronDown'} label={open ? t('sentinel.cards.fold') : t('sentinel.cards.showFields')} onClick={toggle} aria-expanded={open} />}
        <ActionsDropdown items={menu}>
          <IconButton icon="more" label={t('sentinel.cards.moreFor', { name: step.name })} />
        </ActionsDropdown>
      </div>
      {open && !later ? (
        <div className={s.stepFields}>
          {step.kind === 'claude' ? <ClaudeFields step={step} item={item} change={change} /> : null}
          {step.kind === 'script' ? <ScriptFields step={step} change={change} /> : null}
          {step.kind === 'notify' ? <NotifyFields step={step} change={change} /> : null}
          {step.kind === 'http' ? <HttpFields step={step} change={change} /> : null}
          {step.kind === 'pr' ? <PrFields step={step} change={change} /> : null}
          {step.kind === 'merge' ? <MergeFields step={step} change={change} /> : null}
          {step.kind === 'message' ? <MessageFields step={step} change={change} /> : null}
          {step.kind === 'friend' ? <FriendFields step={step} change={change} /> : null}
          {step.kind === 'trigger' ? <TriggerFields step={step} item={item} change={change} /> : null}
          {step.kind === 'measure' ? <MeasureFields step={step} change={change} /> : null}
        </div>
      ) : null}
    </div>
  );
}

const WHERE_INFO = (t: T): ReadonlyArray<{ readonly value: ClaudeStep['where']; readonly label: string; readonly description: string }> => [
  { value: 'project', label: t('sentinel.cards.whereProject'), description: t('sentinel.cards.whereProjectLine') },
  { value: 'worktree', label: t('sentinel.cards.whereWorktree'), description: t('sentinel.cards.whereWorktreeLine') },
  { value: 'mac', label: t('sentinel.cards.whereMac', { assistant: ASSISTANT_TITLE }), description: t('sentinel.cards.whereMacLine', { assistant: ASSISTANT_TITLE, computer: THIS_COMPUTER }) },
];

function ClaudeFields({ step, item, change }: { step: ClaudeStep; item: Sentinel; change: (patch: Partial<ClaudeStep>) => void }) {
  const t = useT();
  const agents = useAgentEntries();
  const prompt = useDraft(step.prompt, (v) => v !== step.prompt && change({ prompt: v }));
  const whereInfo = WHERE_INFO(t);
  const where = whereInfo.find((w) => w.value === step.where);
  return (
    <>
      <div className={s.field}>
        <span className={s.fieldLabel}>{t('sentinel.cards.agentDoes')}</span>
        <div className={s.presets} role="group" aria-label={t('sentinel.cards.startFrom')}>
          {CLAUDE_PRESETS.map((p) => (
            <button key={p.id} type="button" className={s.preset} onClick={() => prompt.change(p.prompt)}>
              {p.label}
            </button>
          ))}
        </div>
        <TextArea className={s.prompt} value={prompt.text} onChange={prompt.change} onBlur={prompt.flush} rows={6} aria-label={t('sentinel.cards.agentPrompt')} placeholder={t('sentinel.cards.promptPlaceholder')} />
        <span className={s.help}>{templateHelp()}</span>
      </div>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.cards.where')}</span>
        <Select
          label={t('sentinel.cards.whereRuns')}
          size="small"
          value={step.where}
          options={whereInfo.map((w) => {
            const why = stepRefusal(item.access, 'claude', w.value);
            return { value: w.value, label: w.label, description: why ?? w.description, disabled: !accessAllows(item.access, 'claude', w.value) };
          })}
          onChange={(w) => change({ where: w })}
        />
      </div>
      {where ? <p className={s.hint}>{where.description}.</p> : null}
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.cards.agent')}</span>
        {/* Which agent and model does it (BLG-497): the run's chat or worktree runs it for this step. */}
        <Select label={t('sentinel.cards.agentModel')} size="small" value={stepAgentChoice(step)} options={agents} onChange={(v) => change(agentFields(v))} />
      </div>
      {step.where === 'mac' && stepAgentChoice(step) ? <p className={s.hint}>{t('sentinel.cards.macDefault', { assistant: ASSISTANT_TITLE })}</p> : null}
    </>
  );
}

const TIMEOUTS = [30, 60, 120, 300, 600, 900, 1800, 3600] as const;
const timeoutLabel = (t: T, sec: number): string => (sec < 60 ? t('sentinel.cards.seconds', { count: sec }) : sec < 3600 ? t('sentinel.cards.minutes', { count: sec / 60 }) : t('sentinel.cards.oneHour'));

/** What a new script starts as, by language: it prints what the next step reads (code, never translated). */
const STARTER: Readonly<Record<ScriptLanguage, string>> = {
  python: 'import json, os\n\n# What you print is what the next step reads (a number, JSON or CSV).\nprint(json.dumps({"value": 42}))\n',
  node: '// What you print is what the next step reads (a number, JSON or CSV).\nconsole.log(JSON.stringify({ value: 42 }));\n',
  bash: '# What you print is what the next step reads (a number, JSON or CSV).\necho 42\n',
  sh: '# What you print is what the next step reads (a number, JSON or CSV).\necho 42\n',
  zsh: '# What you print is what the next step reads (a number, JSON or CSV).\necho 42\n',
  ruby: '# What you print is what the next step reads (a number, JSON or CSV).\nrequire "json"\nputs({ value: 42 }.to_json)\n',
  perl: '# What you print is what the next step reads (a number, JSON or CSV).\nprint "42\\n";\n',
};

function ScriptFields({ step, change }: { step: ScriptStep; change: (patch: Partial<ScriptStep>) => void }) {
  const t = useT();
  const command = useDraft(step.command, (v) => v !== step.command && change({ command: v }));
  const code = useDraft(step.code ?? '', (v) => v !== (step.code ?? '') && change({ code: v }));
  const own = step.code !== undefined;
  const language = step.language ?? 'sh';
  const timeouts: number[] = TIMEOUTS.includes(step.timeoutSec as (typeof TIMEOUTS)[number]) ? [...TIMEOUTS] : [...TIMEOUTS, step.timeoutSec].sort((a, b) => a - b);
  // Its own code (BLG-350), or one shell line. Going back to a line keeps nothing of the script.
  const setMode = (mode: 'command' | 'script'): void => {
    if (mode === 'script') change({ code: step.code ?? STARTER.python, language: step.language ?? 'python', command: '' });
    else {
      const { code: _c, language: _l, ...rest } = step;
      change({ ...rest, code: undefined, language: undefined } as Partial<ScriptStep>);
    }
  };
  return (
    <>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.cards.itRuns')}</span>
        <Segmented<'command' | 'script'>
          label={t('sentinel.cards.itRuns')}
          value={own ? 'script' : 'command'}
          onChange={setMode}
          options={[
            { value: 'command', label: t('sentinel.cards.aCommand') },
            { value: 'script', label: t('sentinel.cards.ownScript') },
          ]}
        />
      </div>
      {own ? (
        <>
          <div className={s.controlRow}>
            <span className={s.controlLabel}>{t('sentinel.cards.language')}</span>
            <Select label={t('sentinel.cards.language')} size="small" value={language} options={SCRIPT_LANGUAGES.map((l) => ({ value: l, label: SCRIPT_LANGUAGE_INFO[l].label }))} onChange={(l) => change({ language: l })} />
          </div>
          <div className={s.field}>
            <span className={s.fieldLabel}>{t('sentinel.cards.script')}</span>
            <CodeEditor value={code.text} onChange={code.change} onBlur={code.flush} lang={language} minRows={8} aria-label={t('sentinel.cards.script')} />
            <span className={s.help}>{t('sentinel.cards.scriptHelp', { run: SCRIPT_LANGUAGE_INFO[language].run })}</span>
          </div>
          <div className={s.field}>
            <span className={s.fieldLabel}>{t('sentinel.cards.arguments')}</span>
            {/* i18n-ignore: a sample argument */}
            <TextInput value={command.text} onChange={command.change} onBlur={command.flush} mono placeholder="--since yesterday" aria-label={t('sentinel.cards.arguments')} />
          </div>
        </>
      ) : (
        <div className={s.field}>
          <span className={s.fieldLabel}>{t('sentinel.cards.command')}</span>
          {/* i18n-ignore: a sample command */}
          <CodeEditor value={command.text} onChange={command.change} onBlur={command.flush} lang="bash" single placeholder="npm test" aria-label={t('sentinel.cards.command')} />
          <span className={s.help}>{t('sentinel.cards.commandHelp')}</span>
        </div>
      )}
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.cards.runsIn')}</span>
        <Select
          label={t('sentinel.cards.runsIn')}
          size="small"
          value={step.cwd}
          options={[
            { value: 'project', label: t('sentinel.cards.projectFolder') },
            { value: 'home', label: t('sentinel.cards.homeFolder') },
          ]}
          onChange={(cwd) => change({ cwd })}
        />
      </div>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.cards.stopAfter')}</span>
        <Select label={t('sentinel.cards.stopAfter')} size="small" value={String(step.timeoutSec)} options={timeouts.map((n) => ({ value: String(n), label: timeoutLabel(t, n) }))} onChange={(v) => change({ timeoutSec: Number(v) })} />
      </div>
    </>
  );
}

function NotifyFields({ step, change }: { step: NotifyStep; change: (patch: Partial<NotifyStep>) => void }) {
  const t = useT();
  const title = useDraft(step.title ?? '', (v) => v !== (step.title ?? '') && change({ title: v }));
  const body = useDraft(step.body ?? '', (v) => v !== (step.body ?? '') && change({ body: v }));
  return (
    <>
      <div className={s.field}>
        <span className={s.fieldLabel}>{t('sentinel.cards.title')}</span>
        <TextInput value={title.text} onChange={title.change} onBlur={title.flush} placeholder={t('sentinel.cards.titlePlaceholder')} aria-label={t('sentinel.cards.title')} />
      </div>
      <div className={s.field}>
        <span className={s.fieldLabel}>{t('sentinel.cards.says')}</span>
        <TextArea value={body.text} onChange={body.change} onBlur={body.flush} rows={2} placeholder={t('sentinel.cards.bodyPlaceholder')} aria-label={t('sentinel.cards.whatItSays')} />
        <span className={s.help}>{templateHelp()}</span>
      </div>
      <Checkbox checked={step.phone} onChange={(phone) => change({ phone })} label={t('sentinel.cards.phoneToo')} detail={t('sentinel.cards.phoneTooDetail')} />
    </>
  );
}

// ---------------------------------------------------------------- Call a service

function HttpFields({ step, change }: { step: HttpStep; change: (patch: Partial<HttpStep>) => void }) {
  const t = useT();
  const url = useDraft(step.url, (v) => v !== step.url && change({ url: v }));
  const body = useDraft(step.body ?? '', (v) => v !== (step.body ?? '') && change({ body: v }));
  const preset = step.preset ?? 'url';
  const note = SERVICE_PRESETS[preset].note;
  const timeouts: number[] = [10, 30, 60, 120, 300, 600].includes(step.timeoutSec) ? [10, 30, 60, 120, 300, 600] : [10, 30, 60, 120, 300, 600, step.timeoutSec].sort((a, b) => a - b);
  return (
    <>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.cards.service')}</span>
        <Select label={t('sentinel.cards.service')} size="small" value={preset} options={SERVICE_CHOICES} onChange={(p) => change(p === 'url' ? { preset: 'url' } : presetFields(p))} />
      </div>
      {note ? <p className={s.hint}>{note}</p> : null}
      <div className={s.field}>
        <span className={s.fieldLabel}>{t('sentinel.cards.address')}</span>
        <div className={s.urlRow}>
          <Select label={t('sentinel.cards.method')} size="small" value={step.method} options={HTTP_METHODS.map((m) => ({ value: m, label: m }))} onChange={(method) => change({ method })} />
          {/* i18n-ignore: a sample address */}
          <TextInput className={s.grow} value={url.text} onChange={url.change} onBlur={url.flush} mono placeholder="https://api.example.com/search" aria-label={t('sentinel.cards.url')} />
        </div>
      </div>
      <Headers headers={step.headers} change={(headers) => change({ headers })} />
      {step.method !== 'GET' ? (
        <div className={s.field}>
          <span className={s.fieldLabel}>{t('sentinel.cards.body')}</span>
          {/* i18n-ignore: a sample JSON body */}
          <CodeEditor value={body.text} onChange={body.change} onBlur={body.flush} lang="json" placeholder={'{"query": "{{previous}}"}'} aria-label={t('sentinel.cards.body')} />
          <span className={s.help}>{t('sentinel.cards.bodyHelp', { help: templateHelp() })}</span>
        </div>
      ) : null}
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.cards.giveUpAfter')}</span>
        <Select label={t('sentinel.cards.giveUpAfter')} size="small" value={String(step.timeoutSec)} options={timeouts.map((n) => ({ value: String(n), label: timeoutLabel(t, n) }))} onChange={(v) => change({ timeoutSec: Number(v) })} />
      </div>
      <p className={s.hint}>{secretsNote()}.</p>
    </>
  );
}

/** Headers as name and value rows; a new row appears as the last one is filled. */
function Headers({ headers, change }: { headers: Readonly<Record<string, string>>; change: (headers: Record<string, string>) => void }) {
  const t = useT();
  const [rows, setRows] = useState(() => headerRows(headers));
  const latest = useRef(headers);
  // The daemon's copy changed under us (a preset): start again from it.
  if (latest.current !== headers && JSON.stringify(latest.current) !== JSON.stringify(headers)) {
    latest.current = headers;
    setRows(headerRows(headers));
  }
  const set = (i: number, patch: Partial<{ key: string; value: string }>): void => {
    const next = rows.map((r, n) => (n === i ? { ...r, ...patch } : r));
    setRows(next.at(-1)!.key || next.at(-1)!.value ? [...next, { key: '', value: '' }] : next);
  };
  const flush = (): void => {
    const next = rowsToHeaders(rows);
    if (JSON.stringify(next) !== JSON.stringify(headers)) {
      latest.current = next;
      change(next);
    }
  };
  return (
    <div className={s.field}>
      <span className={s.fieldLabel}>{t('sentinel.cards.headers')}</span>
      <div className={s.headers} role="list" aria-label={t('sentinel.cards.headers')}>
        {rows.map((r, i) => (
          <div key={i} className={s.headerRow} role="listitem">
            {/* i18n-ignore: a header's name, never translated */}
            <TextInput value={r.key} onChange={(key) => set(i, { key })} onBlur={flush} mono placeholder="Authorization" aria-label={t('sentinel.cards.headerName', { n: i + 1 })} />
            {/* i18n-ignore: a sample header value */}
            <TextInput value={r.value} onChange={(value) => set(i, { value })} onBlur={flush} mono placeholder="Bearer $API_KEY" aria-label={t('sentinel.cards.headerValue', { n: i + 1 })} />
            {r.key || r.value ? (
              <IconButton
                icon="x"
                label={t('sentinel.cards.removeHeader', { name: r.key || t('sentinel.cards.thisHeader') })}
                onClick={() => {
                  const next = rows.filter((_, n) => n !== i);
                  setRows(next);
                  const h = rowsToHeaders(next);
                  latest.current = h;
                  change(h);
                }}
              />
            ) : (
              <span className={s.headerSpacer} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pull requests

function PrFields({ step, change }: { step: PrStep; change: (patch: Partial<PrStep>) => void }) {
  const t = useT();
  return (
    <>
      <Checkbox checked={Boolean(step.draft)} onChange={(draft) => change({ draft })} label={t('sentinel.cards.draft')} detail={t('sentinel.cards.draftDetail')} />
      <p className={s.hint}>{t('sentinel.cards.prHint')}</p>
    </>
  );
}

function MergeFields({ step, change }: { step: MergeStep; change: (patch: Partial<MergeStep>) => void }) {
  const t = useT();
  const setApproval = (approval: boolean): void => {
    if (approval) return change({ require: { checks: true, approval: true } });
    openSheet({
      kind: 'confirm',
      title: t('sentinel.cards.mergeTitle'),
      message: t('sentinel.cards.mergeMessage'),
      confirm: t('sentinel.cards.mergeConfirm'),
      destructive: true,
      run: () => change({ require: { checks: true, approval: false } }),
    });
  };
  return (
    <>
      <Checkbox checked={step.require.approval} onChange={setApproval} label={t('sentinel.cards.askMerge')} detail={t('sentinel.cards.askMergeDetail', { computer: computerWord() })} />
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.cards.mergeAs')}</span>
        <Select
          label={t('sentinel.cards.mergeAs')}
          size="small"
          value={step.method}
          options={[
            { value: 'squash', label: t('sentinel.cards.squash'), description: 'gh pr merge --squash' }, // i18n-ignore: a command
            { value: 'merge', label: t('sentinel.cards.mergeCommit'), description: 'gh pr merge --merge' }, // i18n-ignore: a command
          ]}
          onChange={(method) => change({ method })}
        />
      </div>
      <p className={s.hint}>{t('sentinel.cards.mergeHint', { words: mergeWords(step) })}</p>
    </>
  );
}

// ---------------------------------------------------------------- chats, friends, other sentinels

function MessageFields({ step, change }: { step: MessageStep; change: (patch: Partial<MessageStep>) => void }) {
  const t = useT();
  const network = useApp((st) => st.network);
  const text = useDraft(step.text, (v) => v !== step.text && change({ text: v }));
  const chats = chatChoices(network);
  return (
    <>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.cards.writesIn')}</span>
        {chats.length ? (
          <Select label={t('sentinel.cards.whichChat')} size="small" value={step.to} placeholder={t('sentinel.cards.pickChat')} options={chats} onChange={(to) => change({ to })} />
        ) : (
          <span className={s.hint}>{network.enabled ? t('sentinel.cards.noFriendsGroups') : t('sentinel.cards.networkOff')}</span>
        )}
      </div>
      <div className={s.field}>
        <span className={s.fieldLabel}>{t('sentinel.cards.message')}</span>
        {/* i18n-ignore: template slots */}
        <TextArea value={text.text} onChange={text.change} onBlur={text.flush} rows={3} placeholder="{{sentinel}}: {{previous}}" aria-label={t('sentinel.cards.message')} />
        <span className={s.help}>{t('sentinel.cards.messageHelp', { help: templateHelp() })}</span>
      </div>
    </>
  );
}

function FriendFields({ step, change }: { step: FriendStep; change: (patch: Partial<FriendStep>) => void }) {
  const t = useT();
  const friends = useApp((st) => st.network.friends);
  const prompt = useDraft(step.prompt, (v) => v !== step.prompt && change({ prompt: v }));
  const project = useDraft(step.project ?? '', (v) => v !== (step.project ?? '') && change({ project: v || undefined }));
  return (
    <>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.cards.whoseAgent')}</span>
        {friends.length ? (
          <Select label={t('sentinel.cards.whoseAgent')} size="small" value={step.peerId} placeholder={t('sentinel.cards.pickFriend')} options={[...friends].sort((a, b) => a.name.localeCompare(b.name)).map((f) => ({ value: f.peerId, label: f.name }))} onChange={(peerId) => change({ peerId })} />
        ) : (
          <span className={s.hint}>{t('sentinel.cards.noFriends')}</span>
        )}
      </div>
      <div className={s.field}>
        <span className={s.fieldLabel}>{t('sentinel.cards.whatToAsk')}</span>
        <TextArea value={prompt.text} onChange={prompt.change} onBlur={prompt.flush} rows={4} placeholder={t('sentinel.cards.askPlaceholder')} aria-label={t('sentinel.cards.whatToAsk')} />
        <span className={s.help}>{templateHelp()}</span>
      </div>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.cards.inTheirProject')}</span>
        <TextInput value={project.text} onChange={project.change} onBlur={project.flush} placeholder={t('sentinel.cards.anyTheirChoice')} aria-label={t('sentinel.cards.theirProject')} />
      </div>
      <p className={s.hint}>{t('sentinel.cards.friendHint')}</p>
    </>
  );
}

function TriggerFields({ step, item, change }: { step: TriggerStep; item: Sentinel; change: (patch: Partial<TriggerStep>) => void }) {
  const t = useT();
  const items = useApp((st) => st.sentinel.items);
  const others = otherSentinels(items, item.id);
  return (
    <>
      <div className={s.controlRow}>
        <span className={s.controlLabel}>{t('sentinel.cards.runs')}</span>
        {others.length ? <Select label={t('sentinel.cards.whichSentinel')} size="small" value={step.sentinelId} placeholder={t('sentinel.cards.pickSentinel')} options={others} onChange={(sentinelId) => change({ sentinelId })} /> : <span className={s.hint}>{t('sentinel.cards.noOther')}</span>}
      </div>
      <p className={s.hint}>{t('sentinel.cards.triggerHint')}</p>
    </>
  );
}
