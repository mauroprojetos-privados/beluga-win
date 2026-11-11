import { useEffect, useMemo, useState } from 'react';
import type { Recipe, SentinelDraft } from '@beluga/core/sentinel/model.js';
import { Field, FormSheet, Popup, TextArea, TextInput } from '../components/FormSheet.js';
import { Segmented } from '../components/ui.js';
import { useApp } from '../lib/beluga.js';
import { RunsOnRow } from '../chat/RunsOn.js';
import { type WorkToStart, sendToComputer, useStartDeps } from '../machines/start-there.js';
import { projectOfView } from '../tasks/use-tasks.js';
import { Icon } from '../components/Icon.js';
import { MAC_SCOPE, describedName, iconOf, recipeWhen } from './sentinel-model.js';
import { useSentinelActions } from './use-sentinel.js';
import s from './sentinel.module.css';
import { ASSISTANT_TITLE, THIS_COMPUTER } from '@beluga/shared/assistant.js';
import { useT } from '../lib/i18n.js';

type Way = 'describe' | 'recipe' | 'build';

const WAYS = (t: ReturnType<typeof useT>): ReadonlyArray<{ readonly value: Way; readonly label: string; readonly icon: 'claude' | 'wand' | 'wrench'; readonly hint: string }> => [
  { value: 'describe', label: t('sentinel.newSheet.describe'), icon: 'claude', hint: t('sentinel.newSheet.describeHint') },
  { value: 'recipe', label: t('sentinel.newSheet.recipe'), icon: 'wand', hint: t('sentinel.newSheet.recipeHint') },
  { value: 'build', label: t('sentinel.newSheet.build'), icon: 'wrench', hint: t('sentinel.newSheet.buildHint') },
];

/**
 * New Sentinel: three ways in, as the project home's composer offers them. Describe it makes an
 * empty, paused sentinel and asks your Claude to fill it in (the page opens and shows it working);
 * a recipe makes one filled in (paused) and opens its page; Build it yourself makes an empty one
 * that runs when you press Run. Every new sentinel starts paused.
 */
export function NewSentinelSheet({ projectId, way: first = 'describe', close }: { projectId?: string; way?: Way; close: () => void }) {
  const t = useT();
  const a = useSentinelActions();
  const startDeps = useStartDeps();
  const all = useApp((st) => st.projects);
  const inView = useApp(projectOfView);
  const projects = useMemo(() => all.filter((p) => p.root && !p.error), [all]);
  // The project you're in (or the list's); anywhere else Your Mac, first in the list: a sentinel can work on the Mac itself.
  const start = projectId === MAC_SCOPE || projects.some((p) => p.id === projectId) ? projectId! : (inView ?? MAC_SCOPE);
  const [project, setProject] = useState<string>(start ?? MAC_SCOPE);
  const [way, setWay] = useState<Way>(first);
  const [name, setName] = useState('');
  const [words, setWords] = useState('');
  const [recipes, setRecipes] = useState<readonly Recipe[]>();
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    let alive = true;
    void a.act(() => a.api.recipes()).then((r) => alive && setRecipes(r ?? []));
    return () => {
      alive = false;
    };
  }, [a]);

  const where = project === MAC_SCOPE ? null : project;
  /** Runs on one of your computers (BLG-788): made there, opened at once. */
  // Sent there: the sheet closes; held (the computer named can't take it now): it stays, nothing made.
  const there = (what: WorkToStart): boolean => {
    const sent = sendToComputer(startDeps, where ?? undefined, 'claude', what);
    if (sent === 'sent') close();
    return sent !== 'here';
  };
  const make = async (draft: SentinelDraft): Promise<string | void> => {
    if (there({ kind: 'sentinel', draft: { ...draft } })) return;
    const made = await a.act(() => a.create({ ...draft, projectId: where }));
    if (!made) return t('sentinel.newSheet.couldntMake');
    close();
    a.open(made.id);
  };
  /** Describe it: an empty, paused sentinel, then your Claude fills it in from the words. */
  const describe = async (): Promise<string | void> => {
    const text = words.trim();
    if (!text) return;
    if (there({ kind: 'sentinel', draft: { name: describedName(text), trigger: { kind: 'manual' }, steps: [] }, ask: text })) return;
    const made = await a.act(() => a.create({ name: describedName(text), projectId: where, trigger: { kind: 'manual' }, steps: [] }));
    if (!made) return t('sentinel.newSheet.couldntMake');
    close();
    a.open(made.id);
    await a.act(() => a.api.ask(made.id, text));
  };
  /** A recipe: its sentinel filled in (paused), and the one that runs after it when it has one. */
  const pick = async (r: Recipe): Promise<void> => {
    if (busy) return;
    if (there({ kind: 'sentinel', draft: { ...r.sentinel }, ...(r.then ? { then: { draft: { ...r.then.sentinel }, on: r.then.on } } : {}) })) return;
    setBusy(r.id);
    const made = await a.act(() => a.create({ ...r.sentinel, projectId: where }));
    if (made && r.then) await a.act(() => a.create({ ...r.then!.sentinel, projectId: where, trigger: { kind: 'after', sentinelId: made.id, on: r.then!.on } }));
    setBusy(undefined);
    if (!made) return;
    close();
    a.open(made.id);
  };

  const projectName = project === MAC_SCOPE ? ASSISTANT_TITLE : projects.find((p) => p.id === project)?.name;
  return (
    <FormSheet
      title={t('sentinel.home.newSentinel')}
      icon="sentinel"
      intro={t('sentinel.newSheet.intro')}
      submitLabel={way === 'build' ? t('sentinel.newSheet.make') : way === 'describe' ? t('sentinel.newSheet.writeIt') : t('sentinel.newSheet.pickRecipe')}
      canSubmit={(way === 'build' && Boolean(name.trim())) || (way === 'describe' && Boolean(words.trim()))}
      width={640}
      onCancel={close}
      onSubmit={() => (way === 'build' ? make({ name: name.trim(), trigger: { kind: 'manual' }, steps: [] }) : way === 'describe' ? describe() : undefined)}
    >
      <div className={s.sheetBody}>
        <div className={s.ways}>
          <Segmented<Way> label={t('sentinel.newSheet.how')} value={way} onChange={setWay} options={WAYS(t)} />
        </div>
        <div className={s.row2}>
          <span className={s.label}>{t('sentinel.cards.where')}</span>
          <Popup
            label={t('sentinel.newSheet.whereWorks')}
            value={project}
            onChange={setProject}
            options={[{ value: MAC_SCOPE, label: ASSISTANT_TITLE, description: t('sentinel.newSheet.notTied', { computer: THIS_COMPUTER }) }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </div>
        {/* Which computer it runs on (BLG-786). Only with a computer paired. */}
        <RunsOnRow project={project === MAC_SCOPE ? undefined : project} className={s.row2} labelClassName={s.label} />
        {way === 'describe' ? (
          <Field label={t('sentinel.newSheet.whatDo')} htmlFor="sentinel-words" hint={t('sentinel.newSheet.describeField', { place: projectName ?? ASSISTANT_TITLE })}>
            <TextArea
              id="sentinel-words"
              value={words}
              onChange={setWords}
              rows={4}
              maxLength={8000}
              placeholder={t('sentinel.newSheet.wordsPlaceholder')}
              data-autofocus
              aria-label={t('sentinel.newSheet.whatDo')}
            />
          </Field>
        ) : way === 'recipe' ? (
          !recipes ? (
            <div className={s.empty}>{t('sentinel.newSheet.reading')}</div>
          ) : (
            <div className={s.recipeLists}>
              {(
                [
                  ['recipes', t('sentinel.newSheet.recipes'), recipes.filter((r) => r.group !== 'numbers')],
                  ['numbers', t('sentinel.model.new.measure'), recipes.filter((r) => r.group === 'numbers')],
                ] as const
              ).map(([id, label, list]) =>
                list.length ? (
                  <div key={id}>
                    {id !== 'recipes' ? <div className={s.recipeGroup}>{t('sentinel.newSheet.numbersGroup')}</div> : null}
                    <div className={s.recipes} role="list" aria-label={label}>
                      {list.map((r) => (
                        <button key={r.id} type="button" role="listitem" className={s.recipe} aria-busy={busy === r.id} disabled={Boolean(busy)} onClick={() => void pick(r)} data-recipe={r.id}>
                          <Icon name={iconOf(r.icon)} size={14} />
                          <span className={s.recipeName}>{r.name}</span>
                          <span className={s.recipeWhen} title={recipeWhen(r)}>
                            {recipeWhen(r)}
                          </span>
                          <span className={s.recipeLine}>{r.line}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          )
        ) : (
          <Field label={t('sentinel.page.name')} htmlFor="sentinel-name" hint={t('sentinel.newSheet.buildField', { place: projectName ?? ASSISTANT_TITLE })}>
            <TextInput id="sentinel-name" value={name} onChange={setName} maxLength={80} placeholder={t('sentinel.newSheet.namePlaceholder')} data-autofocus />
          </Field>
        )}
      </div>
    </FormSheet>
  );
}
