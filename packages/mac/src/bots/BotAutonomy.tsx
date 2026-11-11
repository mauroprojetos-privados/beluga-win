import { useState } from 'react';
import { BOT_AUTONOMY_INFO, BOT_TRIGGER_KINDS, type BotInfo, type BotTrigger, type BotTriggerKind } from '@beluga/core/bots/schema.js';
import type { BotView } from '@beluga/core/bots/studio.js';
import { BELUGA_EVENTS, GITHUB_EVENTS, SCHEDULE_EVERY, SENTRY_EVENTS, STRIPE_EVENTS, scheduleSentence as sentence } from '@beluga/core/sentinel/model.js';
import { formatDateTime, formatRelative } from '@beluga/shared/i18n/format.js';
import { Icon } from '../components/Icon.js';
import { Select } from '../components/Select.js';
import { Button, Dot } from '../components/ui.js';
import { toast, useApi, useApp, useBeluga } from '../lib/beluga.js';
import { useT } from '../lib/i18n.js';
import { sameDeep } from '../lib/stable.js';
import { Group, Row } from '../dialogs/settings-controls.js';
import b from './bots.module.css';

/**
 * What a bot does beyond talking (docs/bots.md): its Triggers tab (Sentinels' own trigger shapes in
 * bot.json, each with the message it gets), a repository as knowledge, and which agents of its combo
 * get its tools. Saves go through `bots.edit.bot` like the other tabs: a commit each, refused when
 * bot.json changed since it was read.
 */

/** A bot trigger's own trigger (bot.json's shape, Sentinels' kinds). */
type Trigger = BotTrigger['trigger'];
const scheduleSentence = (t: Trigger): string => sentence(t as never);

const errorText = (err: unknown): string => (err instanceof Error ? err.message.replace(/^Bad arguments for [\w.]+: /, '') : String(err));

/** A new trigger of a kind, with its fields' defaults (Sentinels' own). */
function blank(kind: BotTriggerKind): Trigger {
  switch (kind) {
    case 'schedule':
      return { kind, every: 'day', at: '07:00', missed: 'catch-up' };
    case 'manual':
      return { kind };
    case 'beluga':
      return { kind, what: 'task-done' };
    case 'github':
      return { kind, what: 'pr-opened' };
    case 'stripe':
      return { kind, what: 'payment-failed' };
    case 'uptime':
      return { kind, url: 'https://', minutes: 5 };
    case 'sentry':
      return { kind, org: '', project: '', what: 'new-issue' };
  }
}

const freeId = (taken: readonly string[], name: string): string => {
  const stem = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'trigger';
  let id = stem;
  for (let i = 2; taken.includes(id); i++) id = `${stem}-${i}`;
  return id;
};

export function TriggersTab({ bot, view }: { bot: BotInfo; view: BotView }) {
  const t = useT();
  const api = useApi();
  const { client } = useBeluga();
  const projects = useApp((st) => st.projects.filter((p) => p.root).map((p) => ({ id: p.id, name: p.name })), sameDeep);
  const [editing, setEditing] = useState<{ readonly at: number; readonly draft: BotTrigger }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const list = view.bot.triggers ?? [];
  const info = (id: string) => view.triggers.find((x) => x.id === id);
  const save = (next: BotTrigger[], done?: () => void): void => {
    setBusy(true);
    setError('');
    api.bots['edit.bot'](bot.id, { triggers: next.length ? next : null }, view.prints['bot.json']).then(
      () => (setBusy(false), done?.()),
      (err: unknown) => (setBusy(false), setError(errorText(err))),
    );
  };
  const runNow = (id: string): void => {
    void api.bots['triggers.run'](bot.id, id).then(
      (sent) => toast(client, sent ? t('botStudio.triggers.sent', { name: bot.name }) : t('botStudio.triggers.notSent'), sent ? 'success' : 'warn'),
      (err: unknown) => setError(errorText(err)),
    );
  };
  const autonomy = BOT_AUTONOMY_INFO[view.bot.autonomy ?? 'ask'].label;
  return (
    <>
      <Group>
        <Row label={t('botStudio.triggers.tab')} detail={t('botStudio.triggers.intro', { name: bot.name, autonomy })}>
          <Button size="small" icon="plus" disabled={busy || Boolean(editing)} onClick={() => setEditing({ at: -1, draft: { id: '', trigger: blank('schedule'), message: '' } })}>
            {t('botStudio.triggers.add')}
          </Button>
        </Row>
        {!list.length && !editing ? <div className={b.saved}>{t('botStudio.triggers.none')}</div> : null}
        <div className={b.list}>
          {list.map((trig, i) => {
            const st = info(trig.id);
            const parts = [scheduleSentence(trig.trigger), trig.off ? t('botStudio.triggers.off') : undefined, st?.next !== undefined ? t('botStudio.triggers.next', { when: formatDateTime(st.next) }) : undefined, st?.last !== undefined ? t('botStudio.triggers.last', { when: formatRelative(st.last), what: st.lastWhat ?? '' }) : undefined].filter(Boolean);
            return (
              <div key={trig.id} className={b.item} style={{ alignItems: 'flex-start' }}>
                <Dot tone={trig.off ? 'muted' : st?.trouble ? 'warn' : 'ok'} />
                <span className={b.grow}>
                  <strong>{st?.name ?? trig.name ?? trig.id}</strong>
                  <span>{parts.join(' · ')}</span>
                  <span style={{ whiteSpace: 'pre-wrap' }}>“{trig.message.slice(0, 200)}”</span>
                  {st?.trouble ? <span className={b.error}>{st.trouble}</span> : null}
                </span>
                <Button size="small" variant="quiet" icon="play" disabled={busy} onClick={() => runNow(trig.id)}>
                  {t('botStudio.triggers.runNow')}
                </Button>
                <Button size="small" variant="quiet" disabled={busy} onClick={() => save([...list].map((x, k) => (k === i ? { ...x, off: x.off ? undefined : true } : x)).map(dropUndefined))}>
                  {trig.off ? t('botStudio.triggers.turnOn') : t('botStudio.triggers.turnOff')}
                </Button>
                <Button size="small" variant="quiet" disabled={busy || Boolean(editing)} onClick={() => setEditing({ at: i, draft: trig })}>
                  {t('botStudio.triggers.edit')}
                </Button>
                <Button size="small" variant="quiet" icon="trash" aria-label={t('botStudio.triggers.remove')} disabled={busy} onClick={() => save([...list].filter((_, k) => k !== i))} />
              </div>
            );
          })}
        </div>
      </Group>
      {editing ? (
        <TriggerEditor
          draft={editing.draft}
          projects={projects}
          busy={busy}
          onCancel={() => setEditing(undefined)}
          onSave={(d) => {
            const id = d.id || freeId(list.map((x) => x.id), d.name ?? scheduleSentence(d.trigger));
            const next = editing.at < 0 ? [...list, { ...d, id }] : [...list].map((x, k) => (k === editing.at ? { ...d, id } : x));
            save(next.map(dropUndefined), () => setEditing(undefined));
          }}
        />
      ) : null}
      {error ? <div className={b.error}>{error}</div> : null}
    </>
  );
}

const dropUndefined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;

function TriggerEditor({ draft, projects, busy, onCancel, onSave }: { draft: BotTrigger; projects: ReadonlyArray<{ id: string; name: string }>; busy: boolean; onCancel: () => void; onSave: (d: BotTrigger) => void }) {
  const t = useT();
  const [d, setD] = useState<BotTrigger>(draft);
  const trig = d.trigger;
  const setTrig = (patch: Partial<Trigger>): void => setD({ ...d, trigger: { ...trig, ...patch } as Trigger });
  const input = (value: string, onChange: (v: string) => void, label: string, placeholder?: string, width = 220) => <input className={b.area} style={{ minHeight: 0, height: 26, width }} value={value} placeholder={placeholder} aria-label={label} onChange={(e) => onChange(e.target.value)} />;
  const whats = trig.kind === 'beluga' ? BELUGA_EVENTS : trig.kind === 'github' ? GITHUB_EVENTS : trig.kind === 'stripe' ? STRIPE_EVENTS : trig.kind === 'sentry' ? SENTRY_EVENTS : undefined;
  const ok = d.message.trim().length > 0 && (trig.kind !== 'uptime' || /^https?:\/\/.+/.test(trig.url));
  return (
    <Group>
      <Row label={t('botStudio.triggers.when')}>
        <Select label={t('botStudio.triggers.when')} value={trig.kind as BotTriggerKind} options={BOT_TRIGGER_KINDS.map((k) => ({ value: k, label: t(`botStudio.triggers.kind.${k}`) }))} onChange={(k) => setD({ ...d, trigger: blank(k) })} />
      </Row>
      {trig.kind === 'schedule' ? (
        <Row label={t('botStudio.triggers.every')} detail={scheduleSentence(trig)}>
          <Select label={t('botStudio.triggers.every')} value={trig.every} options={SCHEDULE_EVERY.map((e) => ({ value: e, label: t(`botStudio.triggers.every.${e}`) }))} onChange={(every) => setTrig({ every, ...(every === 'hours' ? { hours: 3 } : {}) } as Partial<Trigger>)} />
          {trig.every === 'hours' ? (
            <Select label={t('botStudio.triggers.every')} value={String(trig.hours ?? 1)} options={['1', '2', '3', '6', '12'].map((h) => ({ value: h, label: `${h} h` }))} onChange={(h) => setTrig({ hours: Number(h) } as Partial<Trigger>)} />
          ) : (
            <input className={b.area} type="time" style={{ minHeight: 0, height: 26, width: 100 }} value={trig.at} aria-label={t('botStudio.triggers.at')} onChange={(e) => /^\d\d:\d\d$/.test(e.target.value) && setTrig({ at: e.target.value } as Partial<Trigger>)} />
          )}
        </Row>
      ) : null}
      {whats && 'what' in trig ? (
        <Row label={t('botStudio.triggers.what')}>
          <Select label={t('botStudio.triggers.what')} value={trig.what as string} options={whats.map((w) => ({ value: w, label: scheduleSentence({ ...trig, what: w } as Trigger) }))} onChange={(what) => setTrig({ what } as Partial<Trigger>)} />
        </Row>
      ) : null}
      {trig.kind === 'github' && trig.what === 'issue-labelled' ? <Row label={t('botStudio.triggers.label')}>{input(trig.label ?? '', (label) => setTrig({ label: label || undefined } as Partial<Trigger>), t('botStudio.triggers.label'), 'deploy', 140)}</Row> : null}
      {trig.kind === 'uptime' ? (
        <Row label={t('botStudio.triggers.address')}>
          {input(trig.url, (url) => setTrig({ url } as Partial<Trigger>), t('botStudio.triggers.address'), 'https://staging.example.com/health', 260)}
          <Select label={t('botStudio.triggers.minutes')} value={String(trig.minutes)} options={['1', '5', '15'].map((m) => ({ value: m, label: `${m} min` }))} onChange={(m) => setTrig({ minutes: Number(m) } as Partial<Trigger>)} />
        </Row>
      ) : null}
      {trig.kind === 'sentry' ? (
        <Row label={t('botStudio.triggers.org')}>
          {input(trig.org, (org) => setTrig({ org } as Partial<Trigger>), t('botStudio.triggers.org'), 'my-org', 140)}
          {input(trig.project, (project) => setTrig({ project } as Partial<Trigger>), t('botStudio.triggers.sentryProject'), 'web', 140)}
        </Row>
      ) : null}
      {trig.kind === 'github' || trig.kind === 'stripe' || trig.kind === 'sentry' ? (
        <Row label={t('botStudio.triggers.project')} detail={t('botStudio.triggers.projectDetail')}>
          <Select label={t('botStudio.triggers.project')} value={d.projectId ?? ''} options={[{ value: '', label: t('botStudio.triggers.anyProject') }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} onChange={(projectId) => setD({ ...d, projectId: projectId || undefined } as BotTrigger)} />
        </Row>
      ) : null}
      <Row label={t('botStudio.triggers.name')}>{input(d.name ?? '', (name) => setD({ ...d, name: name || undefined } as BotTrigger), t('botStudio.triggers.name'), t('botStudio.triggers.namePlaceholder'))}</Row>
      <div style={{ padding: '6px 12px' }}>
        <textarea className={b.area} rows={4} value={d.message} placeholder={t('botStudio.triggers.messagePlaceholder')} aria-label={t('botStudio.triggers.message')} onChange={(e) => setD({ ...d, message: e.target.value })} />
      </div>
      <Row label="">
        <Button size="small" variant="quiet" onClick={onCancel}>
          {t('botStudio.triggers.cancel')}
        </Button>
        <Button size="small" variant="primary" disabled={!ok || busy} onClick={() => onSave({ ...d, message: d.message.trim() })}>
          {t('botStudio.triggers.save')}
        </Button>
      </Row>
    </Group>
  );
}

/** Knowledge › A repository or folder: a path here, or a git address. */
export function RepoSource({ bot }: { bot: BotInfo; view: BotView }) {
  const t = useT();
  const api = useApi();
  const [where, setWhere] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const add = (): void => {
    setBusy(true);
    setError('');
    api.bots['knowledge.addRepo'](bot.id, where.trim()).then(
      () => (setBusy(false), setWhere('')),
      (err: unknown) => (setBusy(false), setError(errorText(err))),
    );
  };
  return (
    <>
      <Row label={t('botStudio.repo.label')} detail={t('botStudio.repo.detail')}>
        <input className={b.area} style={{ minHeight: 0, height: 26, width: 240 }} placeholder={t('botStudio.repo.placeholder')} value={where} onChange={(e) => setWhere(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && where.trim() && !busy && add()} aria-label={t('botStudio.repo.label')} />
        <Button size="small" icon="branch" disabled={!where.trim() || busy} onClick={add}>
          {busy ? '…' : t('botStudio.repo.add')}
        </Button>
      </Row>
      {error ? <div className={b.error}>{error}</div> : null}
    </>
  );
}

/** A repository source's line: how many of its files were indexed, how many left out. */
RepoSource.Status = function RepoStatus({ id, view }: { id: string; view: BotView }) {
  const t = useT();
  const r = view.knowledge.indexed?.repos?.[id];
  const words = !r ? t('botStudio.repo.notIndexed') : r.error ? t('botStudio.repo.gone') : [t('botStudio.repo.status', { files: r.files, skipped: r.skipped }), r.capped ? t('botStudio.repo.capped', { files: r.files }) : undefined].filter(Boolean).join(' · ');
  return <span>{words}</span>;
};

/** Tools › Who gets these tools: each target of its combo, and which servers reach it. */
export function Reach({ view }: { view: BotView }) {
  const t = useT();
  if (!view.reach.length) return null;
  return (
    <Row
      label={t('botStudio.reach.label')}
      detail={
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>{t('botStudio.reach.detail')}</span>
          {view.reach.map((r, i) => (
            <span key={i}>
              <Icon name={r.gets === 'all' ? 'check' : r.gets === 'some' ? 'alert' : 'x'} size={11} /> {r.label}: {r.gets === 'all' ? t('botStudio.reach.all') : r.gets === 'some' ? t('botStudio.reach.some', { missing: r.missing.join(', ') }) : t('botStudio.reach.none')}
            </span>
          ))}
        </span>
      }
    >
      <Dot tone={view.reach.every((r) => r.gets === 'all') ? 'ok' : 'warn'} />
    </Row>
  );
}
