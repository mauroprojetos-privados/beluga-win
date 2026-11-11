import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BOT_AUTONOMIES, BOT_AUTONOMY_INFO, type BotAutonomy, type BotInfo, MAC_BOT, SUGGESTED_CATEGORIES, botTestChannel, targetOf } from '@beluga/core/bots/schema.js';
import { BOT_TEMPLATES } from '@beluga/core/bots/templates.js';
import { DIFFICULTIES, type Difficulty, combosOf } from '@beluga/core/routing/model.js';
import type { BotView } from '@beluga/core/bots/studio.js';
import { ChatLog } from '../chat/ChatLog.js';
import { Icon, type IconName } from '../components/Icon.js';
import { Select } from '../components/Select.js';
import { Button, Dot, Segmented, cx } from '../components/ui.js';
import { toast, useApi, useApp, useBeluga } from '../lib/beluga.js';
import { sameDeep } from '../lib/stable.js';
import { say, useT } from '../lib/i18n.js';
import { t as tr } from '@beluga/shared/i18n/index.js';
import { formatDate, formatDateTime } from '@beluga/shared/i18n/format.js';
import { Group, Row } from '../dialogs/settings-controls.js';
import { botIcon, pickBot, usePickedBot } from './BotsNav.js';
import b from './bots.module.css';

/**
 * Settings › Bots (docs/bots.md): Your Mac first, then the bots you made, and Bot Studio for the one
 * picked. The files are the source of truth: each tab saves its file as one commit in the bot's own
 * git, a change made outside Beluga shows here at once (the daemon watches the folder), and a save
 * over a file that changed since you opened it is refused with the reason instead of overwriting it.
 * The same pane works in `beluga web`: nothing here needs the app's own windows.
 */

type Tab = 'identity' | 'model' | 'tools' | 'skills' | 'knowledge' | 'memory' | 'test';
const TABS = (): ReadonlyArray<{ readonly id: Tab; readonly label: string; readonly icon: IconName }> => [
  { id: 'identity', label: tr('bots.tab.identity'), icon: 'person' },
  { id: 'model', label: tr('bots.tab.model'), icon: 'spark' },
  { id: 'tools', label: tr('bots.tab.tools'), icon: 'plug' },
  { id: 'skills', label: tr('bots.tab.skills'), icon: 'book' },
  { id: 'knowledge', label: tr('bots.tab.knowledge'), icon: 'search' },
  { id: 'memory', label: tr('bots.tab.memory'), icon: 'bulb' },
  { id: 'test', label: tr('bots.tab.test'), icon: 'play' },
];

/** Icons a bot can wear (the app's own). */
const ICONS: readonly IconName[] = ['bot', 'laptop', 'server', 'phone', 'table', 'branch', 'globe', 'book', 'flask', 'terminal', 'review', 'wrench', 'bolt', 'lock', 'sparkles', 'chartBar'];

/** Soft pastels, never neon (the phone's palette). */
const COLORS = ['#a7c7e7', '#b5e3c4', '#f6d8a8', '#f4b6c2', '#cdb4f0', '#c9d6df'];

const errorText = (err: unknown): string => (err instanceof Error ? err.message.replace(/^Bad arguments for [\w.]+: /, '') : String(err));
const isConflict = (err: unknown): boolean => /changed outside Beluga/.test(errorText(err));

/** One bot's files, read again whenever they change (here, or outside: its `rev` moves). */
function useBotView(id: string | undefined): { view: BotView | undefined; reload: () => void; error: string } {
  const api = useApi();
  const rev = useApp((st) => st.bots.bots.find((x) => x.id === id)?.rev);
  const [view, setView] = useState<BotView>();
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!id || id === 'new') return setView(undefined);
    let live = true;
    api.bots.get(id).then(
      (v) => live && (setView(v as BotView), setError('')),
      (err: unknown) => live && setError(errorText(err)),
    );
    return () => {
      live = false;
    };
  }, [api, id, rev, nonce]);
  return { view, reload: useCallback(() => setNonce((n) => n + 1), []), error };
}

/**
 * A text a tab edits: yours while you type, theirs when the file changes outside and you hadn't
 * touched it. Changed outside while you had: a warning, never a silent overwrite.
 */
function useEdited(file: string | undefined, print: string | undefined): { text: string; set: (t: string) => void; dirty: boolean; stale: boolean; reset: () => void; seen: string | undefined } {
  const [text, setText] = useState(file ?? '');
  const [seen, setSeen] = useState(print);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) {
      setText(file ?? '');
      setSeen(print);
    }
  }, [file, print, dirty]);
  return {
    text,
    set: (t) => {
      setText(t);
      setDirty(true);
    },
    dirty,
    stale: dirty && print !== seen,
    reset: () => {
      setDirty(false);
      setText(file ?? '');
      setSeen(print);
    },
    seen,
  };
}

/** Save with the fingerprint as read; a conflict says so and keeps your words. */
function useSave(): { busy: boolean; error: string; conflict: boolean; run: (fn: () => Promise<unknown>, done?: () => void) => void; clear: () => void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  return {
    busy,
    error,
    conflict,
    clear: () => (setError(''), setConflict(false)),
    run: (fn, done) => {
      setBusy(true);
      setError('');
      setConflict(false);
      fn().then(
        () => {
          setBusy(false);
          done?.();
        },
        (err: unknown) => {
          setBusy(false);
          setConflict(isConflict(err));
          setError(errorText(err));
        },
      );
    },
  };
}

function Problems({ list }: { list: readonly string[] }) {
  if (!list.length) return null;
  return (
    <div className={b.problems} role="status">
      {list.map((p) => (
        <span key={p}>
          <Icon name="alert" size={11} /> {p}
        </span>
      ))}
    </div>
  );
}

function Conflict({ onTheirs }: { onTheirs: () => void }) {
  const t = useT();
  return (
    <div className={b.conflict} role="alert">
      {t('bots.file.conflict')}{' '}
      <Button size="small" variant="quiet" onClick={onTheirs}>
        {t('bots.file.useNew')}
      </Button>
    </div>
  );
}

/** An editor of one whole file: a text area, Save, and the conflict and error lines. */
function FileEditor({ label, file, print, save, rows = 14, placeholder, extra }: { label: string; file: string; print: string | undefined; save: (text: string, expect: string | undefined) => Promise<unknown>; rows?: number; placeholder?: string; extra?: ReactNode }) {
  const t = useT();
  const edit = useEdited(file, print);
  const saving = useSave();
  return (
    <div className={b.field}>
      <span>{label}</span>
      <textarea className={b.area} rows={rows} value={edit.text} placeholder={placeholder} spellCheck={false} onChange={(e) => edit.set(e.target.value)} aria-label={label} />
      {edit.stale || saving.conflict ? <Conflict onTheirs={() => (edit.reset(), saving.clear())} /> : null}
      {saving.error && !saving.conflict ? <div className={b.error}>{saving.error}</div> : null}
      <div className={b.bar}>
        {extra}
        <span className={b.grow} />
        {edit.dirty ? (
          <Button size="small" variant="quiet" onClick={edit.reset}>
            {t('bots.file.revert')}
          </Button>
        ) : null}
        <Button size="small" variant="primary" disabled={!edit.dirty || saving.busy} onClick={() => saving.run(() => save(edit.text, edit.seen), edit.reset)}>
          {saving.busy ? t('bots.file.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the pane

export function BotsSettings() {
  const bots = useApp((st) => st.bots.bots, sameDeep);
  const picked = usePickedBot();
  const current = bots.find((x) => x.id === picked) ?? (picked === 'new' ? undefined : bots[0]);
  useT();
  return (
    <>
      <Group title={say('Your bots')}>
        <BotList bots={bots} picked={picked === 'new' ? 'new' : current?.id} />
      </Group>
      {picked === 'new' || !current ? <NewBot /> : <Studio key={current.id} bot={current} />}
    </>
  );
}

function BotList({ bots, picked }: { bots: readonly BotInfo[]; picked: string | undefined }) {
  const t = useT();
  return (
    <div className={b.botList}>
      {bots.map((bot) => (
        <button key={bot.id} type="button" className={cx(b.botRow, picked === bot.id && b.botRowOn)} onClick={() => pickBot(bot.id)}>
          <span className={b.botMark} style={bot.color ? { background: bot.color } : undefined}>
            <Icon name={botIcon(bot)} size={14} />
          </span>
          <span className={b.botMeta}>
            <strong>{bot.name}</strong>
            <span>{bot.mac ? (bot.orchestrates ? t('bots.list.macOrchestrates') : t('bots.list.macAsAlways')) : (bot.description ?? bot.dir)}</span>
          </span>
          {bot.problems.length ? <Dot tone="warn" /> : null}
        </button>
      ))}
      <button type="button" className={cx(b.botRow, picked === 'new' && b.botRowOn)} onClick={() => pickBot('new')}>
        <span className={b.botMark}>
          <Icon name="plus" size={14} />
        </span>
        <span className={b.botMeta}>
          <strong>{t('bots.list.newBot')}</strong>
          <span>{t('bots.list.newBotHint')}</span>
        </span>
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ making one

function NewBot() {
  const t = useT();
  const api = useApi();
  const { client } = useBeluga();
  const [name, setName] = useState('');
  const [describe, setDescribe] = useState('');
  const [draft, setDraft] = useState<{ files: Record<string, string>; notes?: string }>();
  const saving = useSave();
  const file = useRef<HTMLInputElement>(null);
  const made = (id: unknown): void => {
    if (typeof id === 'string') pickBot(id);
  };
  const importZip = async (f: File | undefined): Promise<void> => {
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    saving.run(async () => {
      const out = (await api.bots.import(btoa(bin))) as { id: string; missing: readonly string[] };
      if (out.missing.length) toast(client, t('bots.new.importedMissing', { names: out.missing.join(', ') }), 'warn');
      made(out.id);
    });
  };
  return (
    <>
      <Group title={say('New Bot')}>
        <Row label={say('From scratch')} detail={t('bots.new.fromScratchDetail')}>
          {/* i18n-ignore: a sample name */}
          <input className={b.area} style={{ minHeight: 0, height: 26, width: 180 }} placeholder="Supa" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label={t('bots.new.nameAria')} />
          <Button size="small" variant="primary" disabled={!name.trim() || saving.busy} onClick={() => saving.run(async () => made(await api.bots.create({ name: name.trim() })))}>
            {t('bots.new.create')}
          </Button>
        </Row>
        <Row label={say('From a template')} detail={t('bots.new.fromTemplateDetail')}>
          <Select label={t('bots.new.template')} value="" placeholder={t('bots.new.pickTemplate')} options={BOT_TEMPLATES.map((x) => ({ value: x.id, label: x.name, description: x.summary }))} onChange={(v) => setDraft({ files: { ...(BOT_TEMPLATES.find((x) => x.id === v)?.files ?? {}) } })} />
        </Row>
        <Row label={say('Import a .zip')} detail={t('bots.new.importZipDetail')}>
          <input ref={file} type="file" accept=".zip,application/zip" hidden onChange={(e) => void importZip(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
          <Button size="small" icon="download" disabled={saving.busy} onClick={() => file.current?.click()}>
            {t('bots.new.import')}
          </Button>
        </Row>
      </Group>
      <Group title={say('Create with Claude Code')}>
        <div className={b.field}>
          <span>{t('bots.new.describeIntro')}</span>
          <textarea className={b.area} rows={4} value={describe} onChange={(e) => setDescribe(e.target.value)} placeholder={t('bots.new.describePlaceholder')} aria-label={t('bots.new.describeAria')} />
          <div className={b.bar}>
            <Button size="small" icon="sparkles" disabled={describe.trim().length < 3 || saving.busy} onClick={() => saving.run(async () => setDraft((await api.bots.draft(describe.trim())) as { files: Record<string, string>; notes?: string }))}>
              {saving.busy ? t('bots.new.drafting') : t('bots.new.draftIt')}
            </Button>
          </div>
        </div>
        {saving.error ? <div className={b.error}>{saving.error}</div> : null}
        {draft ? <DraftDiff draft={draft} current={{}} onCancel={() => setDraft(undefined)} onAccept={() => saving.run(async () => made(await api.bots.applyDraft(null, draft.files)), () => setDraft(undefined))} /> : null}
      </Group>
    </>
  );
}

/** A line diff: what goes, what comes (enough to read a draft before accepting it). */
function diffLines(a: string, c: string): Array<{ readonly kind: ' ' | '+' | '-'; readonly line: string }> {
  const x = a ? a.split('\n') : [];
  const y = c ? c.split('\n') : [];
  const n = x.length;
  const m = y.length;
  if (n * m > 400_000) return [...x.map((line) => ({ kind: '-' as const, line })), ...y.map((line) => ({ kind: '+' as const, line }))];
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: Array<{ kind: ' ' | '+' | '-'; line: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) out.push({ kind: ' ', line: x[i++]! }), j++;
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ kind: '-', line: x[i++]! });
    else out.push({ kind: '+', line: y[j++]! });
  }
  while (i < n) out.push({ kind: '-', line: x[i++]! });
  while (j < m) out.push({ kind: '+', line: y[j++]! });
  return out;
}

function DraftDiff({ draft, current, onCancel, onAccept }: { draft: { files: Record<string, string>; notes?: string }; current: Readonly<Record<string, string>>; onCancel: () => void; onAccept: () => void }) {
  const t = useT();
  return (
    <div className={b.list}>
      {draft.notes ? <div className={b.saved}>{draft.notes}</div> : null}
      {Object.entries(draft.files).map(([file, text]) => (
        <div key={file} className={b.field}>
          <span>
            {file} {current[file] === undefined ? t('bots.draft.new') : current[file] === text ? t('bots.draft.unchanged') : t('bots.draft.changed')}
          </span>
          <pre className={b.diff}>
            {diffLines(current[file] ?? '', text).map((d, k) => (
              <div key={k} className={d.kind === '+' ? b.add : d.kind === '-' ? b.del : undefined}>
                {d.kind} {d.line}
              </div>
            ))}
          </pre>
        </div>
      ))}
      <div className={b.bar}>
        <Button size="small" variant="quiet" onClick={onCancel}>
          {t('bots.draft.discard')}
        </Button>
        <Button size="small" variant="primary" icon="check" onClick={onAccept}>
          {t('bots.draft.accept')}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ one bot

function Studio({ bot }: { bot: BotInfo }) {
  const t = useT();
  const api = useApi();
  const { client } = useBeluga();
  const [tab, setTab] = useState<Tab>('identity');
  const { view, error, reload } = useBotView(bot.id);
  const [versions, setVersions] = useState<ReadonlyArray<{ id: string; at: number; message: string }>>();
  const [improve, setImprove] = useState('');
  const [draft, setDraft] = useState<{ files: Record<string, string>; notes?: string }>();
  const saving = useSave();
  useEffect(() => {
    void api.bots.versions(bot.id).then((v) => setVersions(v as never), () => setVersions([]));
  }, [api, bot.id, bot.rev]);
  const exportZip = (): void =>
    saving.run(async () => {
      const out = (await api.bots.export(bot.id)) as { name: string; base64: string; secrets: readonly string[] };
      const bytes = Uint8Array.from(atob(out.base64), (ch) => ch.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = out.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast(client, out.secrets.length ? t('bots.studio.exportedWithout', { names: out.secrets.join(', ') }) : t('bots.studio.exported'), 'success');
    });
  if (error) return <div className={b.error}>{error}</div>;
  if (!view) return <div className={b.saved}>{t('bots.studio.reading')}</div>;
  const current: Record<string, string> = { 'bot.json': JSON.stringify(view.bot, null, 2), 'CLAUDE.md': view.persona, '.mcp.json': view.mcp, ...Object.fromEntries(view.skills.map((s) => [`.claude/skills/${s.name}/SKILL.md`, s.text])) };
  return (
    <div className={b.studio}>
      <div className={b.head}>
        <span className={b.botMark} style={bot.color ? { background: bot.color } : undefined}>
          <Icon name={botIcon(bot)} size={14} />
        </span>
        <h3>{bot.name}</h3>
        <Button size="small" variant="quiet" icon="back" disabled={!versions || versions.length < 2 || saving.busy} onClick={() => saving.run(() => api.bots.undo(bot.id), reload)}>
          {t('bots.studio.undo')}
        </Button>
        <Select
          label={t('bots.studio.versions')}
          value=""
          placeholder={t('bots.studio.versionsPlaceholder')}
          options={(versions ?? []).map((v) => ({ value: v.id, label: v.message, description: formatDateTime(v.at) }))}
          onChange={(v) => v && saving.run(() => api.bots.restore(bot.id, v), reload)}
        />
        <Button size="small" variant="quiet" icon="share" disabled={saving.busy} onClick={exportZip}>
          {t('bots.studio.export')}
        </Button>
        {bot.mac ? null : (
          <Button
            size="small"
            variant="quiet"
            icon="trash"
            onClick={() => {
              if (window.confirm(t('bots.studio.deleteConfirm', { name: bot.name }))) saving.run(() => api.bots.delete(bot.id), () => pickBot(MAC_BOT));
            }}
          >
            {t('common.delete')}
          </Button>
        )}
      </div>
      <div className={b.saved}>
        {t('bots.studio.savedIn', { dir: bot.dir })}
        {versions?.length ? t('bots.studio.versionCount', { count: versions.length }) : t('bots.studio.noHistory')}
      </div>
      <Problems list={bot.problems} />
      {saving.error ? <div className={b.error}>{saving.error}</div> : null}
      <div className={b.tabs} role="tablist">
        {TABS().map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={cx(b.tab, tab === x.id && b.tabOn)} onClick={() => setTab(x.id)}>
            <Icon name={x.icon} size={12} /> {x.label}
          </button>
        ))}
      </div>
      {tab === 'identity' ? <IdentityTab bot={bot} view={view} /> : null}
      {tab === 'model' ? <ModelTab bot={bot} view={view} /> : null}
      {tab === 'tools' ? <ToolsTab bot={bot} view={view} /> : null}
      {tab === 'skills' ? <SkillsTab bot={bot} view={view} /> : null}
      {tab === 'knowledge' ? <KnowledgeTab bot={bot} view={view} /> : null}
      {tab === 'memory' ? <FileEditor label={t('bots.studio.memoryLabel')} file={view.memory} print={view.prints['memory.md']} save={(text, expect) => api.bots['edit.memory'](bot.id, text, expect)} extra={<span className={b.saved}>{t('bots.studio.memoryCleared')}</span>} /> : null}
      {tab === 'test' ? <TestTab bot={bot} /> : null}
      <Group title={say('Improve with Claude Code')}>
        <div className={b.field}>
          <span>{t('bots.studio.improveIntro')}</span>
          <textarea className={b.area} rows={2} value={improve} onChange={(e) => setImprove(e.target.value)} aria-label={t('bots.studio.improveAria')} />
          <div className={b.bar}>
            <Button size="small" icon="sparkles" disabled={improve.trim().length < 3 || saving.busy} onClick={() => saving.run(async () => setDraft((await api.bots.draft(improve.trim(), bot.id)) as { files: Record<string, string>; notes?: string }))}>
              {t('bots.studio.draftChanges')}
            </Button>
          </div>
        </div>
        {draft ? <DraftDiff draft={draft} current={current} onCancel={() => setDraft(undefined)} onAccept={() => saving.run(() => api.bots.applyDraft(bot.id, draft.files), () => (setDraft(undefined), reload()))} /> : null}
      </Group>
    </div>
  );
}

function IdentityTab({ bot, view }: { bot: BotInfo; view: BotView }) {
  const api = useApi();
  const projects = useApp((st) => st.projects.filter((p) => p.root).map((p) => ({ id: p.id, name: p.name })), sameDeep);
  const [name, setName] = useState(view.bot.name ?? '');
  const [description, setDescription] = useState(view.bot.description ?? '');
  const saving = useSave();
  const patch = (p: Record<string, unknown>): void => saving.run(() => api.bots['edit.bot'](bot.id, p, view.prints['bot.json']));
  const chosen = new Set(view.bot.projects ?? []);
  const t = useT();
  return (
    <>
      <Group>
        <Row label={say('Name')} detail={bot.mac ? t('bots.identity.nameMac') : t('bots.identity.nameBot')}>
          <input className={b.area} style={{ minHeight: 0, height: 26, width: 180 }} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() !== (view.bot.name ?? '') && patch({ name: name.trim() || null })} aria-label={t('bots.identity.name')} />
        </Row>
        <Row label={say('What it’s for')} detail={t('bots.identity.forDetail')}>
          <input className={b.area} style={{ minHeight: 0, height: 26, width: 260 }} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} onBlur={() => description.trim() !== (view.bot.description ?? '') && patch({ description: description.trim() || null })} aria-label={t('bots.identity.for')} />
        </Row>
        <Row label={say('Icon and colour')}>
          <Select label={t('bots.identity.icon')} value={view.bot.icon ?? ''} options={[{ value: '', label: t('bots.identity.itsOwn') }, ...ICONS.map((i) => ({ value: i, label: i }))]} onChange={(v) => patch({ icon: v || null })} />
          <Select label={t('bots.identity.colour')} value={view.bot.color ?? ''} options={[{ value: '', label: t('bots.identity.none') }, ...COLORS.map((c) => ({ value: c, label: c }))]} onChange={(v) => patch({ color: v || null })} />
        </Row>
        <Row label={say('Projects it acts in')} detail={t('bots.identity.projectsDetail')}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            {projects.map((p) => (
              <label key={p.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={chosen.has(p.id)} onChange={(e) => patch({ projects: e.target.checked ? [...chosen, p.id] : [...chosen].filter((x) => x !== p.id) })} />
                {p.name}
              </label>
            ))}
          </div>
        </Row>
      </Group>
      {saving.error ? <div className={b.error}>{saving.error}</div> : null}
      <FileEditor
        label={t('bots.identity.persona')}
        file={view.persona}
        print={view.prints['CLAUDE.md']}
        placeholder={bot.mac ? t('bots.identity.personaMac') : t('bots.identity.personaBot')}
        save={(text, expect) => api.bots['edit.persona'](bot.id, text, expect)}
      />
    </>
  );
}

function ModelTab({ bot, view }: { bot: BotInfo; view: BotView }) {
  const api = useApi();
  const combos = useApp((st) => combosOf(st.prefs.combos, st.runtimes), sameDeep);
  const others = useApp((st) => st.bots.bots.filter((x) => x.id !== bot.id && !x.mac), sameDeep);
  const saving = useSave();
  const [newCat, setNewCat] = useState('');
  const patch = (p: Record<string, unknown>): void => saving.run(() => api.bots['edit.bot'](bot.id, p, view.prints['bot.json']));
  const t = useT();
  const cats = view.bot.categories ?? {};
  const targets = [...combos.map((c) => ({ value: `combo:${c.id}`, label: t('bots.model.comboTarget', { name: c.name }) })), ...others.map((o) => ({ value: `bot:${o.id}`, label: t('bots.model.botTarget', { name: o.name }) }))];
  const hard = (d: Difficulty): string => t(`bots.model.difficulty.${d}`);
  const setCat = (name: string, target: string | undefined): void => {
    const { [name]: _old, ...rest } = cats;
    const next = target ? { ...rest, [name]: target } : rest;
    patch({ categories: Object.keys(next).length ? next : null });
  };
  const setDiff = (d: Difficulty, id: string): void => {
    const { [d]: _old, ...rest } = view.bot.difficulty ?? {};
    const next = id ? { ...rest, [d]: id } : rest;
    patch({ difficulty: Object.keys(next).length ? next : null });
  };
  const autonomy: BotAutonomy = view.bot.autonomy ?? 'ask';
  return (
    <Group>
      <Row label={say('Its own combo')} detail={t('bots.model.ownComboDetail')}>
        <Select label={t('bots.model.combo')} value={view.bot.combo ?? ''} options={[{ value: '', label: t('bots.model.yourAgent') }, ...combos.map((c) => ({ value: c.id, label: c.name }))]} onChange={(v) => patch({ combo: v || null })} />
      </Row>
      <Row label={say('Categories')} detail={t('bots.model.categoriesDetail')}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {Object.entries(cats).map(([name, target]) => (
            <span key={name} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <code>{name}</code>
              <Select label={t('bots.model.goesTo', { name })} value={target} options={targets.some((x) => x.value === target) ? targets : [{ value: target, label: t('bots.model.gone', { name: targetOf(target)?.id ?? target }) }, ...targets]} onChange={(v) => setCat(name, v)} />
              <Button size="small" variant="quiet" icon="x" aria-label={t('bots.model.remove', { name })} onClick={() => setCat(name, undefined)} />
            </span>
          ))}
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* i18n-ignore: a category's name, as it is written */}
            <input className={b.area} style={{ minHeight: 0, height: 26, width: 120 }} list="bot-categories" placeholder="quick" value={newCat} onChange={(e) => setNewCat(e.target.value.toLowerCase())} aria-label={t('bots.model.newCategory')} />
            <datalist id="bot-categories">
              {SUGGESTED_CATEGORIES.filter((c) => !cats[c]).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <Select label={t('bots.model.addCategory')} value="" placeholder={t('bots.model.goesToPlaceholder')} options={targets} onChange={(v) => v && /^[a-z][a-z0-9-]{0,31}$/.test(newCat) && (setCat(newCat, v), setNewCat(''))} />
          </span>
        </div>
      </Row>
      <Row label={say('By how hard')} detail={t('bots.model.byHowHardDetail')}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {DIFFICULTIES.map((d) => (
            <Select key={d} label={t('bots.model.difficultyTasks', { difficulty: hard(d) })} value={view.bot.difficulty?.[d] ?? ''} options={[{ value: '', label: t('bots.model.difficultyAsSettings', { difficulty: hard(d) }) }, ...combos.map((c) => ({ value: c.id, label: t('bots.model.difficultyCombo', { difficulty: hard(d), name: c.name }) }))]} onChange={(v) => setDiff(d, v)} />
          ))}
        </div>
      </Row>
      <Row label={say('Autonomy')} detail={BOT_AUTONOMY_INFO[autonomy].hint}>
        <Segmented<BotAutonomy> label={t('bots.model.autonomy')} value={autonomy} options={BOT_AUTONOMIES.map((a) => ({ value: a, label: BOT_AUTONOMY_INFO[a].label, hint: BOT_AUTONOMY_INFO[a].hint }))} onChange={(v) => patch({ autonomy: v })} />
      </Row>
      {saving.error ? <div className={b.error}>{saving.error}</div> : null}
    </Group>
  );
}

function ToolsTab({ bot, view }: { bot: BotInfo; view: BotView }) {
  const api = useApi();
  const [checks, setChecks] = useState<ReadonlyArray<{ name: string; status: string; error?: string; tools?: number }>>();
  const [installed, setInstalled] = useState<ReadonlyArray<{ name: string; from: string }>>([]);
  const [secret, setSecret] = useState<Record<string, string>>({});
  const saving = useSave();
  const t = useT();
  useEffect(() => {
    void api.bots.installed().then((x) => setInstalled((x as { mcps: Array<{ name: string; from: string }> }).mcps), () => undefined);
  }, [api]);
  return (
    <>
      <Group>
        <Row label={say('Its MCP servers')} detail={t('bots.tools.serversDetail')}>
          <Button size="small" icon="refresh" disabled={saving.busy || !view.servers.length} onClick={() => saving.run(async () => setChecks((await api.bots.validate(bot.id)) as never))}>
            {saving.busy ? t('bots.tools.connecting') : t('bots.tools.check')}
          </Button>
        </Row>
        {view.servers.map((name) => {
          const c = checks?.find((x) => x.name === name);
          return (
            <Row key={name} label={name} detail={c ? (c.status === 'connected' ? (c.tools !== undefined ? t('bots.tools.connectedTools', { count: c.tools }) : t('bots.tools.connected')) : `${c.status}${c.error ? `: ${c.error}` : ''}`) : t('bots.tools.checkHint')}>
              <Dot tone={!c ? 'muted' : c.status === 'connected' ? 'ok' : 'error'} />
            </Row>
          );
        })}
        <Row label={say('Add one of yours')} detail={t('bots.tools.addYoursDetail')}>
          <Select label={t('bots.tools.addServer')} value="" placeholder={installed.length ? t('bots.tools.pickOne') : t('bots.tools.noneSetUp')} options={installed.filter((m) => !view.servers.includes(m.name)).map((m) => ({ value: m.name, label: m.name, description: m.from }))} onChange={(v) => v && saving.run(() => api.bots['edit.addMcp'](bot.id, v, view.prints['.mcp.json']))} />
        </Row>
        {view.secrets.map((s) => (
          <Row key={s.name} label={s.name} detail={s.set ? t('bots.tools.secretSaved') : t('bots.tools.secretMissing')}>
            {/* i18n-ignore: dots for a hidden value */}
            <input className={b.area} style={{ minHeight: 0, height: 26, width: 180 }} type="password" autoComplete="off" placeholder={s.set ? '••••••' : t('bots.tools.secretValue')} value={secret[s.name] ?? ''} onChange={(e) => setSecret({ ...secret, [s.name]: e.target.value })} aria-label={t('bots.tools.secretAria', { name: s.name })} />
            <Button size="small" disabled={!secret[s.name]} onClick={() => saving.run(() => api.bots['edit.secret'](bot.id, s.name, secret[s.name] ?? null), () => setSecret({ ...secret, [s.name]: '' }))}>
              {t('common.save')}
            </Button>
            {s.set ? (
              <Button size="small" variant="quiet" onClick={() => saving.run(() => api.bots['edit.secret'](bot.id, s.name, null))}>
                {t('bots.tools.clear')}
              </Button>
            ) : null}
          </Row>
        ))}
      </Group>
      {saving.error ? <div className={b.error}>{saving.error}</div> : null}
      {/* i18n-ignore: the placeholder is a sample .mcp.json */}
      <FileEditor label={t('bots.tools.mcpFile')} file={view.mcp} print={view.prints['.mcp.json']} rows={10} placeholder={'{\n  "mcpServers": {\n    "supabase": { "command": "npx", "args": ["-y", "@supabase/mcp-server-supabase"], "env": { "SUPABASE_ACCESS_TOKEN": "${env:SUPABASE_ACCESS_TOKEN}" } }\n  }\n}'} save={(text, expect) => api.bots['edit.mcp'](bot.id, text, expect)} />
    </>
  );
}

function SkillsTab({ bot, view }: { bot: BotInfo; view: BotView }) {
  const api = useApi();
  const others = useApp((st) => st.bots.bots.filter((x) => x.id !== bot.id), sameDeep);
  const [kind, setKind] = useState<'skill' | 'agent'>('skill');
  const list = kind === 'skill' ? view.skills : view.agents;
  const [open, setOpen] = useState<string>();
  const [made, setMade] = useState('');
  const [yours, setYours] = useState<ReadonlyArray<{ name: string; description?: string }>>([]);
  const saving = useSave();
  useEffect(() => {
    void api.bots.installed().then((x) => setYours((x as { skills: Array<{ name: string; description?: string }> }).skills), () => undefined);
  }, [api]);
  const rel = (name: string): string => (kind === 'skill' ? `.claude/skills/${name}/SKILL.md` : `.claude/agents/${name}.md`);
  const save = kind === 'skill' ? api.bots['edit.skill'] : api.bots['edit.agent'];
  const shown = list.find((s) => s.name === open);
  const t = useT();
  return (
    <>
      <Group>
        <Row label={say('Show')}>
          <Segmented<'skill' | 'agent'> label={t('bots.skills.kind')} value={kind} options={[{ value: 'skill', label: t('bots.skills.skills'), hint: t('bots.skills.skillsHint') }, { value: 'agent', label: t('bots.skills.agents'), hint: t('bots.skills.agentsHint') }]} onChange={(v) => (setKind(v), setOpen(undefined))} />
        </Row>
        <div className={b.list}>
          {list.map((s) => (
            <div key={s.name} className={b.item}>
              <Dot tone={s.problem ? 'warn' : 'ok'} />
              <span className={b.grow}>
                <strong>{s.name}</strong>
                <span>{s.problem ?? s.description}</span>
              </span>
              <Button size="small" variant="quiet" onClick={() => setOpen(open === s.name ? undefined : s.name)}>
                {open === s.name ? t('common.close') : t('bots.skills.edit')}
              </Button>
              <Button size="small" variant="quiet" icon="trash" aria-label={t('bots.model.remove', { name: s.name })} onClick={() => saving.run(() => save(bot.id, s.name, null, view.prints[rel(s.name)]))} />
            </div>
          ))}
        </div>
        <Row label={kind === 'skill' ? t('bots.skills.newSkill') : t('bots.skills.newAgent')} detail={t('bots.skills.newDetail')}>
          {/* i18n-ignore: a sample skill name */}
          <input className={b.area} style={{ minHeight: 0, height: 26, width: 160 }} placeholder="supabase-rls" value={made} onChange={(e) => setMade(e.target.value.toLowerCase())} aria-label={t('bots.skills.nameAria')} />
          {/* i18n-ignore: the new file's header stays English, it's the skill's own file, read by the agent */}
          <Button size="small" icon="plus" disabled={!/^[a-z0-9][a-z0-9-]{0,63}$/.test(made) || saving.busy} onClick={() => saving.run(() => save(bot.id, made, `---\nname: ${made}\ndescription: When to use it, in a sentence\n---\n\n`, undefined), () => (setOpen(made), setMade('')))}>
            {t('bots.new.create')}
          </Button>
        </Row>
        {kind === 'skill' ? (
          <Row label={say('Copy a skill')} detail={t('bots.skills.copyDetail')}>
            <Select
              label={t('bots.skills.copy')}
              value=""
              placeholder={t('bots.tools.pickOne')}
              options={[...yours.map((s) => ({ value: `|${s.name}`, label: s.name, description: s.description ?? t('bots.skills.yours') })), ...others.map((o) => ({ value: `${o.id}|`, label: t('bots.skills.fromBot', { name: o.name }), description: t('bots.skills.typeName') }))].filter((o) => o.value.startsWith('|'))}
              onChange={(v) => v && saving.run(() => api.bots['edit.copySkill'](bot.id, { name: v.slice(1) }))}
            />
          </Row>
        ) : null}
      </Group>
      {saving.error ? <div className={b.error}>{saving.error}</div> : null}
      {shown ? <FileEditor key={shown.name} label={rel(shown.name)} file={shown.text} print={view.prints[rel(shown.name)]} save={(text, expect) => save(bot.id, shown.name, text, expect)} /> : null}
    </>
  );
}

function KnowledgeTab({ bot, view }: { bot: BotInfo; view: BotView }) {
  const api = useApi();
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ passages: ReadonlyArray<{ source: string; text: string; score: number }>; backend: string }>();
  const [over, setOver] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const saving = useSave();
  const k = view.knowledge;
  const addFiles = (files: FileList | null | undefined): void => {
    for (const f of Array.from(files ?? [])) {
      // In the app a dropped file has its path (the copy is the daemon's); in a browser its text is read here.
      const p = (f as File & { path?: string }).path;
      saving.run(async () => (p ? api.bots['knowledge.addFile'](bot.id, p) : api.bots['knowledge.addText'](bot.id, f.name, await f.text())));
    }
  };
  const t = useT();
  const where = k.backend === 'openviking' ? t('bots.knowledge.openviking') : t('bots.knowledge.local');
  return (
    <>
      <Group>
        <Row label={say('Searched with')} detail={k.indexed ? t('bots.knowledge.indexed', { where, when: formatDateTime(k.indexed.at), chunks: k.indexed.chunks }) : t('bots.knowledge.notIndexed', { where })}>
          <Button size="small" icon="refresh" disabled={saving.busy || !k.sources.length} onClick={() => saving.run(() => api.bots['knowledge.reindex'](bot.id))}>
            {saving.busy ? t('bots.knowledge.indexing') : t('bots.knowledge.indexAgain')}
          </Button>
        </Row>
        {k.indexed?.skipped?.length ? <Problems list={k.indexed.skipped.map((x) => t('bots.knowledge.leftOut', { name: x }))} /> : null}
        <div className={b.list}>
          {k.sources.map((src) => (
            <div key={src.id} className={b.item}>
              <Icon name={src.kind === 'url' ? 'globe' : src.kind === 'text' ? 'pencil' : 'file'} size={13} />
              <span className={b.grow}>
                <strong>{src.name}</strong>
                <span>{t('bots.knowledge.source', { origin: src.origin ?? t('bots.knowledge.pasted'), size: Math.max(1, Math.round(src.size / 1024)), date: formatDate(src.addedAt) })}</span>
              </span>
              <Button size="small" variant="quiet" icon="trash" aria-label={t('bots.model.remove', { name: src.name })} onClick={() => saving.run(() => api.bots['knowledge.remove'](bot.id, src.id))} />
            </div>
          ))}
        </div>
        <div
          className={cx(b.drop, over && b.dropOver)}
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          {t('bots.knowledge.drop')}{' '}
          <Button size="small" variant="quiet" onClick={() => file.current?.click()}>
            {t('bots.knowledge.chooseFiles')}
          </Button>
          <input ref={file} type="file" multiple hidden onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
          <div className={b.saved}>{t('bots.knowledge.noSecrets')}</div>
        </div>
        <Row label={say('A web page')} detail={t('bots.knowledge.webPageDetail')}>
          {/* i18n-ignore: a sample address */}
          <input className={b.area} style={{ minHeight: 0, height: 26, width: 240 }} placeholder="https://supabase.com/docs/guides/auth/row-level-security" value={url} onChange={(e) => setUrl(e.target.value)} aria-label={t('bots.knowledge.webPageAria')} />
          <Button size="small" disabled={!/^https?:\/\//.test(url) || saving.busy} onClick={() => saving.run(() => api.bots['knowledge.addUrl'](bot.id, url), () => setUrl(''))}>
            {t('bots.knowledge.add')}
          </Button>
        </Row>
        <Row label={say('Try a search')} detail={t('bots.knowledge.trySearchDetail')}>
          <input className={b.area} style={{ minHeight: 0, height: 26, width: 200 }} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && query.trim() && saving.run(async () => setFound((await api.bots['knowledge.search'](bot.id, query.trim())) as never))} aria-label={t('bots.knowledge.searchAria')} />
          <Button size="small" icon="search" disabled={!query.trim() || saving.busy} onClick={() => saving.run(async () => setFound((await api.bots['knowledge.search'](bot.id, query.trim())) as never))}>
            {t('common.search')}
          </Button>
        </Row>
      </Group>
      {saving.error ? <div className={b.error}>{saving.error}</div> : null}
      {found ? (
        <div className={b.list}>
          {/* i18n-ignore: OpenViking is a product name */}
          <div className={b.saved}>{t('bots.knowledge.found', { count: found.passages.length, backend: found.backend === 'openviking' ? 'OpenViking' : t('bots.knowledge.localIndex') })}</div>
          {found.passages.map((p, i) => (
            <div key={i} className={b.item} style={{ alignItems: 'flex-start' }}>
              <span className={b.grow}>
                <strong>{p.source}</strong>
                <span style={{ whiteSpace: 'pre-wrap' }}>{p.text.slice(0, 600)}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** What a run in the Test chat used: its tools (by server), skills and knowledge searches. */
function usedIn(steps: readonly string[]): { tools: string[]; skills: string[]; knowledge: number } {
  const tools = new Set<string>();
  const skills = new Set<string>();
  let knowledge = 0;
  for (const step of steps) {
    const name = /^((?:mcp__)?[A-Za-z][\w-]*)/.exec(step.trim())?.[1] ?? '';
    const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
    if (mcp?.[2] === 'knowledge_search') knowledge++;
    else if (mcp && mcp[1] !== 'beluga_mac' && !mcp[1]!.startsWith('beluga')) tools.add(mcp[1]!);
    else if (name === 'Skill') {
      const s = /"(?:skill|command|name)"\s*:\s*"([\w:-]+)"/.exec(step)?.[1] ?? /Skill\s+([\w:-]+)/.exec(step)?.[1];
      if (s) skills.add(s);
    }
  }
  return { tools: [...tools], skills: [...skills], knowledge };
}

function TestTab({ bot }: { bot: BotInfo }) {
  const api = useApi();
  const channel = botTestChannel(bot.id);
  const [text, setText] = useState('');
  const steps = useApp((st) => st.log.flatMap((l) => (l.channel === channel && l.type === 'agent' ? (l.steps ?? []) : [])), sameDeep);
  const used = useMemo(() => usedIn(steps), [steps]);
  const t = useT();
  const send = (): void => {
    const words = text.trim();
    if (!words) return;
    void api.session.submit(words, { channel });
    setText('');
  };
  return (
    <>
      <div className={b.saved}>{t('bots.test.intro')}</div>
      <div className={b.used}>
        <span className={b.chip}>{t('bots.test.tools', { list: used.tools.length ? used.tools.join(', ') : t('bots.test.noneYet') })}</span>
        <span className={b.chip}>{t('bots.test.skills', { list: used.skills.length ? used.skills.join(', ') : t('bots.test.noneYet') })}</span>
        <span className={b.chip}>{t('bots.test.searches', { count: used.knowledge })}</span>
      </div>
      <div className={b.test}>
        <ChatLog channel={channel} />
      </div>
      <div className={b.bar}>
        <textarea className={b.area} style={{ minHeight: 0 }} rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())} placeholder={t('bots.test.ask', { name: bot.name })} aria-label={t('bots.test.messageAria')} />
        <Button size="small" variant="quiet" onClick={() => void api.session.clearChat(channel, { fresh: true })}>
          {t('bots.test.startOver')}
        </Button>
        <Button size="small" variant="primary" icon="send" disabled={!text.trim()} onClick={send}>
          {t('common.send')}
        </Button>
      </div>
    </>
  );
}
