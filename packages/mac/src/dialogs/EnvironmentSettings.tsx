import { useEffect, useRef, useState } from 'react';
import { type EnvVar, envProblems, importEnv, parseEnvText } from '@beluga/shared/env-vars.js';
import { Icon } from '../components/Icon.js';
import { Button, Tip, cx } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { useMyAgentName } from '../lib/agent-words.js';
import { Group, Row, Select, Switch } from './settings-controls.js';
import s from './settings.module.css';
import e from './env-settings.module.css';
import { thisComputer } from '../lib/os-words.js';
import { say, useT } from '../lib/i18n.js';

interface EnvRow extends EnvVar {
  readonly id: number;
}

let nextId = 1;
const withIds = (vars: readonly EnvVar[]): EnvRow[] => vars.map((v) => ({ ...v, id: nextId++ }));
const filled = (rows: readonly EnvVar[]): EnvVar[] => rows.filter((r) => r.key || r.value).map(({ key, value }) => ({ key, value }));
const errorText = (err: unknown): string => (err instanceof Error ? err.message.replace(/^Bad arguments for env\.set: /, '') : String(err));

type Status = { kind: 'idle' } | { kind: 'saved' } | { kind: 'error'; text: string };

/** Paste KEY=value lines (a .env, an export block) to add them all at once. */
function ImportBox({ onImport, onClose }: { onImport: (vars: EnvVar[]) => void; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const parsed = parseEnvText(text);
  const vars = t('prefs.env.importVars', { count: parsed.vars.length });
  return (
    <div className={e.importBox}>
      {/* i18n-ignore */}
      <textarea className={e.importText} aria-label={t('prefs.env.importAria')} autoFocus spellCheck={false} placeholder={'API_URL=https://api.example.com\nexport TOKEN="…"'} value={text} onChange={(ev) => setText(ev.target.value)} />
      <div className={e.importBar}>
        <span className={e.muted}>{text.trim() ? (parsed.skipped.length ? t('prefs.env.importSkipped', { vars, count: parsed.skipped.length }) : vars) : t('prefs.env.importHint')}</span>
        <span className={e.flex} />
        <Button size="small" variant="quiet" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button size="small" variant="primary" disabled={!parsed.vars.length} onClick={() => onImport(parsed.vars)}>
          {t('prefs.env.importAdd', { n: parsed.vars.length || '' })}
        </Button>
      </div>
    </div>
  );
}

/**
 * The key/value editor for one place: yours, or a project's. Changes save as you leave a field.
 * A project's main folder .env shows under its own variables (BLG-369): typing over one of its
 * values sets it in Beluga, which wins; Use .env takes that back.
 */
export function EnvEditor({ projectId }: { projectId: string }) {
  const t = useT();
  const api = useApi();
  const project = useApp((st) => st.projects.find((p) => p.id === projectId));
  const keysHere = useApp((st) => (project ? st.envKeys.projects[project.root] : st.envKeys.global));
  const [rows, setRows] = useState<EnvRow[] | undefined>(undefined);
  const [dotenv, setDotenv] = useState(false);
  const [dotenvVars, setDotenvVars] = useState<readonly EnvVar[]>([]);
  const [dotenvFiles, setDotenvFiles] = useState<readonly string[]>([]);
  const [copying, setCopying] = useState(false);
  const [claudeDotenv, setClaudeDotenv] = useState(false);
  const [newKeysBack, setNewKeysBack] = useState(true);
  const [overridden, setOverridden] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [shown, setShown] = useState<ReadonlySet<number>>(new Set());
  const [shownFile, setShownFile] = useState<ReadonlySet<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [focusId, setFocusId] = useState<{ id: number; field: 'key' | 'value'; caret?: number } | undefined>(undefined);
  const saved = useRef('');
  const editing = useRef(false);

  // Load the values (only this screen gets them), and again if another screen changes them.
  useEffect(() => {
    if (editing.current) return;
    let live = true;
    void api.env.get(projectId || undefined).then((scope) => {
      if (!live) return;
      saved.current = JSON.stringify([filled(scope.vars), scope.dotenv]);
      setRows(withIds(scope.vars));
      setDotenv(scope.dotenv);
      setDotenvVars(scope.dotenvVars ?? []);
      setDotenvFiles(scope.dotenvFiles ?? []);
      setClaudeDotenv(scope.claudeDotenv);
      setNewKeysBack(scope.newKeysBack ?? true);
      setOverridden(scope.overridden ?? {});
    });
    return () => void (live = false);
  }, [projectId, keysHere]);

  const problems = envProblems(rows ?? []);
  const commit = (next: readonly EnvRow[], nextDotenv = dotenv): void => {
    editing.current = false;
    if (envProblems(next).size) return setStatus({ kind: 'error', text: t('prefs.env.fixNames') });
    const snapshot = JSON.stringify([filled(next), nextDotenv]);
    if (snapshot === saved.current) return;
    api.env.set(projectId || undefined, filled(next), projectId ? nextDotenv : undefined).then(
      () => {
        saved.current = snapshot;
        setStatus({ kind: 'saved' });
      },
      (err: unknown) => setStatus({ kind: 'error', text: errorText(err) }),
    );
  };
  const change = (id: number, patch: Partial<EnvVar>): void => {
    editing.current = true;
    setStatus({ kind: 'idle' });
    setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const add = (): void => {
    const row = withIds([{ key: '', value: '' }])[0]!;
    setRows((rs) => [...(rs ?? []), row]);
    setFocusId({ id: row.id, field: 'key' });
  };
  // Typing over a .env value: it's set here from now on (and wins), the caret kept where you type.
  const override = (key: string, value: string, caret: number | null): void => {
    const row = withIds([{ key, value }])[0]!;
    editing.current = true;
    setStatus({ kind: 'idle' });
    if (shownFile.has(key)) setShown((set) => new Set([...set, row.id]));
    setRows((rs) => [...(rs ?? []), row]);
    setFocusId({ id: row.id, field: 'value', ...(caret !== null ? { caret } : {}) });
  };
  const copyIn = (): void => {
    setCopying(true);
    api.env.importDotenv(projectId).then(
      (n) => {
        setCopying(false);
        setStatus(n ? { kind: 'saved' } : { kind: 'error', text: t('prefs.env.allInAlready') });
      },
      (err: unknown) => {
        setCopying(false);
        setStatus({ kind: 'error', text: errorText(err) });
      },
    );
  };
  const addAll = (vars: readonly EnvVar[]): void => {
    const next = importEnv(rows ?? [], vars);
    const known = new Map((rows ?? []).map((r) => [r.key, r.id]));
    const merged = next.map((v) => ({ ...v, id: known.get(v.key) ?? nextId++ }));
    setRows(merged);
    setImporting(false);
    commit(merged);
  };
  const remove = (id: number): void => {
    const next = (rows ?? []).filter((r) => r.id !== id);
    setRows(next);
    commit(next);
  };

  // Closing Settings (or switching place) mid-edit saves it too: a field left without a blur isn't lost.
  const saveOnClose = useRef<() => void>(() => undefined);
  saveOnClose.current = () => {
    if (editing.current && rows) commit(rows);
  };
  useEffect(() => () => saveOnClose.current(), []);

  if (!rows) return <div className={s.note}>{t('common.loading')}</div>;
  const masked = (id: number): boolean => !showAll && !shown.has(id);
  const fromFile = new Map(projectId && dotenv ? dotenvVars.map((v) => [v.key, v.value]) : []);
  const own = new Set(rows.map((r) => r.key));
  // The .env's own rows: only those not set here (a set one shows above, marked as winning over it).
  const fileRows = [...fromFile].filter(([key]) => !own.has(key));
  const notCopied = dotenvVars.filter((v) => !own.has(v.key)).length;
  // One list, in the .env's order: a value changed here stays in its place (only its tag changes); ones set only here follow.
  type Listed = { kind: 'file'; key: string; value: string } | { kind: 'own'; row: EnvRow; index: number };
  const byKey = new Map(rows.map((row, index) => [row.key, { kind: 'own' as const, row, index }]));
  const listed: Listed[] = [
    ...[...fromFile].map(([key, value]): Listed => byKey.get(key) ?? { kind: 'file', key, value }),
    ...rows.map((row, index): Listed => ({ kind: 'own', row, index })).filter((x) => !(x.kind === 'own' && fromFile.has(x.row.key))),
  ];
  const filesLabel = dotenvFiles.length ? dotenvFiles.join(` ${t('common.and')} `) : '.env';

  return (
    <>
      <Group>
        {projectId ? (
          <div className={e.sourceBar}>
            <Icon name="file" size={12} className={e.sourceIcon} />
            <span className={e.sourceText}>
              {t('prefs.env.includeMain', { files: filesLabel })}
              <span className={e.muted}>
                {dotenv ? (dotenvVars.length ? t('prefs.env.sourceCount', { count: dotenvVars.length }) : t('prefs.env.sourceNone')) : t('prefs.env.sourceOff')}
              </span>
            </span>
            <Switch
              label={t('prefs.env.useDotenv')}
              on={dotenv}
              onChange={(v) => {
                setDotenv(v);
                commit(rows, v);
              }}
            />
          </div>
        ) : null}
        <div className={e.head}>
          <span>{t('prefs.env.name')}</span>
          <span>{t('prefs.env.value')}</span>
          <Tip label={showAll ? t('prefs.env.hideValues') : t('prefs.env.showValues')}>
            <button type="button" className={cx(e.eye, showAll && e.eyeOn)} aria-label={t('prefs.env.showValuesAria')} aria-pressed={showAll} onClick={() => setShowAll(!showAll)}>
              <Icon name="eye" size={13} />
            </button>
          </Tip>
          <span />
        </div>
        {rows.length || fileRows.length ? null : <div className={e.empty}>{projectId ? t('prefs.env.emptyProject') : t('prefs.env.empty')}</div>}
        {listed.map((item) => {
          if (item.kind === 'file') {
            const { key, value } = item;
            const hidden = !showAll && !shownFile.has(key);
            return (
              <div key={`file:${key}`} className={e.row}>
                <input className={cx(e.key, e.fixedKey)} aria-label={t('prefs.env.name')} value={key} readOnly tabIndex={-1} />
                <input
                  className={cx(e.value, hidden && value && e.masked)}
                  aria-label={t('prefs.env.valueOfFile', { key, files: filesLabel })}
                  value={value}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(ev) => override(key, ev.target.value, ev.target.selectionStart)}
                />
                <button type="button" className={cx(e.eye, !hidden && e.eyeOn)} aria-label={hidden ? t('prefs.env.showKey', { key }) : t('prefs.env.hideKey', { key })} aria-pressed={!hidden} disabled={showAll} onClick={() => setShownFile((set) => (set.has(key) ? new Set([...set].filter((x) => x !== key)) : new Set([...set, key])))}>
                  <Icon name="eye" size={13} />
                </button>
                <Tip label={t('prefs.env.fromFileTip', { files: filesLabel })}>
                  {/* i18n-ignore */}
                  <span className={e.sourceTag}>.env</span>
                </Tip>
              </div>
            );
          }
          const { row: r, index: i } = item;
          const fileValue = fromFile.get(r.key);
          const overrides = fileValue !== undefined;
          return (
            <div key={r.id} className={cx(e.row, problems.has(i) && e.bad)}>
              <input
                className={cx(e.key, overrides && e.fixedKey)}
                aria-label={t('prefs.env.name')}
                aria-invalid={problems.has(i)}
                value={r.key}
                // i18n-ignore
                placeholder="NAME"
                spellCheck={false}
                autoComplete="off"
                readOnly={overrides}
                tabIndex={overrides ? -1 : undefined}
                autoFocus={focusId?.id === r.id && focusId.field === 'key'}
                onChange={(ev) => change(r.id, { key: ev.target.value.trim() })}
                onBlur={() => commit(rows)}
                onPaste={(ev) => {
                  const text = ev.clipboardData.getData('text');
                  const pasted = /[=\n]/.test(text) ? parseEnvText(text).vars : [];
                  if (!pasted.length) return;
                  ev.preventDefault();
                  addAll(pasted);
                }}
              />
              <input
                className={cx(e.value, masked(r.id) && r.value && e.masked)}
                aria-label={r.key ? t('prefs.env.valueOf', { key: r.key }) : t('prefs.env.valueOfNew')}
                value={r.value}
                placeholder={t('prefs.env.valuePlaceholder')}
                spellCheck={false}
                autoComplete="off"
                autoFocus={focusId?.id === r.id && focusId.field === 'value'}
                onFocus={(ev) => {
                  if (focusId?.id !== r.id || focusId.field !== 'value') return;
                  const at = focusId.caret ?? ev.currentTarget.value.length;
                  ev.currentTarget.setSelectionRange(at, at);
                  setFocusId(undefined);
                }}
                onChange={(ev) => change(r.id, { value: ev.target.value })}
                onBlur={() => commit(rows)}
              />
              <button type="button" className={cx(e.eye, !masked(r.id) && e.eyeOn)} aria-label={masked(r.id) ? (r.key ? t('prefs.env.showKey', { key: r.key }) : t('prefs.env.showValue')) : r.key ? t('prefs.env.hideKey', { key: r.key }) : t('prefs.env.hideValue')} aria-pressed={!masked(r.id)} disabled={showAll} onClick={() => setShown((set) => (set.has(r.id) ? new Set([...set].filter((x) => x !== r.id)) : new Set([...set, r.id])))}>
                <Icon name="eye" size={13} />
              </button>
              {overrides ? (
                <Tip label={t('prefs.env.changedTip', { files: filesLabel })}>
                  <button type="button" className={cx(e.sourceTag, e.sourceEdited)} aria-label={t('prefs.env.useFilesFor', { files: filesLabel, key: r.key })} onClick={() => remove(r.id)}>
                    <Icon name="refresh" size={10} />
                  </button>
                </Tip>
              ) : (
                <button type="button" className={e.remove} aria-label={r.key ? t('prefs.env.removeKey', { key: r.key }) : t('prefs.env.removeRow')} onClick={() => remove(r.id)}>
                  <Icon name="x" size={10} />
                </button>
              )}
              {problems.has(i) ? <div className={e.problem}>{problems.get(i)}</div> : null}
              {!problems.has(i) && overrides ? (
                <div className={e.override}>
                  {fileValue === r.value ? t('prefs.env.sameAsFile', { files: filesLabel }) : t('prefs.env.changedHere', { files: filesLabel })}{' '}
                  <button type="button" className={e.inlineLink} onClick={() => remove(r.id)}>
                    {t('prefs.env.useFiles', { files: filesLabel })}
                  </button>
                </div>
              ) : null}
              {!problems.has(i) && overridden[r.key]?.length ? (
                <div className={e.override}>
                  {t('prefs.env.notUsedIn', { count: overridden[r.key]!.length, places: overridden[r.key]!.join(', '), key: r.key })}
                </div>
              ) : null}
            </div>
          );
        })}
        {importing ? <ImportBox onImport={addAll} onClose={() => setImporting(false)} /> : null}
        <div className={e.foot}>
          <Button size="small" variant="quiet" icon="plus" onClick={add}>
            {t('prefs.env.addVariable')}
          </Button>
          {importing ? null : (
            <Button size="small" variant="quiet" icon="clip" onClick={() => setImporting(true)}>
              {t('prefs.env.pasteLines')}
            </Button>
          )}
          {projectId && dotenv && notCopied ? (
            <Tip label={t('prefs.env.copyTip')}>
              <Button size="small" variant="quiet" icon="download" disabled={copying} onClick={copyIn}>
                {copying ? t('prefs.env.copying') : t('prefs.env.keepCopy')}
              </Button>
            </Tip>
          ) : null}
          <span className={e.flex} />
          <span className={cx(e.status, status.kind === 'error' && e.statusError)} role="status">
            {status.kind === 'saved' ? (
              <>
                <Icon name="check" size={11} /> {t('prefs.env.saved')}
              </>
            ) : status.kind === 'error' ? (
              status.text
            ) : null}
          </span>
        </div>
      </Group>
      {projectId ? (
        <Group title={say('Worktrees')}>
          <Row label={say('New keys go to the main folder')} detail={t('prefs.env.newKeysDetail')}>
            <Switch
              label={t('prefs.env.newKeysSwitch')}
              on={newKeysBack}
              onChange={(v) => {
                setNewKeysBack(v);
                api.env.newKeysBack(projectId, v).then(
                  () => setStatus({ kind: 'saved' }),
                  (err: unknown) => {
                    setNewKeysBack(!v);
                    setStatus({ kind: 'error', text: errorText(err) });
                  },
                );
              }}
            />
          </Row>
        </Group>
      ) : null}
      <DatabaseTest projectId={projectId} />
      <Group title={say('Your agent')}>
        <Row
          label={say('Read .env files without asking')}
          detail={projectId ? t('prefs.env.readDotenvProject') : t('prefs.env.readDotenvAll')}
        >
          <Switch
            label={t('prefs.env.readDotenvSwitch')}
            on={claudeDotenv}
            onChange={(v) => {
              setClaudeDotenv(v);
              api.env.claudeDotenv(projectId || undefined, v).then(
                () => setStatus({ kind: 'saved' }),
                (err: unknown) => {
                  setClaudeDotenv(!v);
                  setStatus({ kind: 'error', text: errorText(err) });
                },
              );
            }}
          />
        </Row>
      </Group>
    </>
  );
}

/**
 * Whether the database your Claude's views would use here answers: the same lookup they make
 * (DATABASE_URL and the like, or Supabase's variables), so a pass here works for them too.
 */
function DatabaseTest({ projectId }: { projectId: string }) {
  const t = useT();
  const api = useApi();
  const [result, setResult] = useState<{ ok: true; from: string } | { ok: false; message: string } | 'testing' | undefined>(undefined);
  const test = (): void => {
    setResult('testing');
    api.env.testDatabase(projectId || undefined).then(setResult, (err: unknown) => setResult({ ok: false, message: errorText(err) }));
  };
  return (
    <Group title={say('Database')}>
      <Row
        label={say('Postgres for your agent’s views')}
        detail={result === undefined || result === 'testing' ? t('prefs.env.postgresDetail') : result.ok ? t('prefs.env.connected', { from: result.from }) : result.message}
      >
        <Button size="small" icon={result !== undefined && result !== 'testing' && result.ok ? 'check' : undefined} disabled={result === 'testing'} onClick={test}>
          {result === 'testing' ? t('prefs.env.testing') : t('prefs.env.testConnection')}
        </Button>
      </Row>
    </Group>
  );
}

/**
 * Settings › Environment: variables Beluga gives your shells, setup and run commands, and your
 * agent. Yours apply everywhere; a project's apply in its workspaces, over yours.
 */
export function EnvironmentSettings() {
  const t = useT();
  const projects = useApp((st) => st.projects).filter((p) => p.root);
  const envKeys = useApp((st) => st.envKeys);
  const [scope, setScope] = useState('');
  const count = (n: number): string => (n ? ` · ${n}` : '');
  const agent = useMyAgentName();
  return (
    <>
      <p className={e.intro}>{t('prefs.env.intro', { agent, computer: thisComputer() })}</p>
      <Group>
        <Row label={say('Variables for')} detail={scope ? t('prefs.env.scopeProject') : t('prefs.env.scopeAll')}>
          <Select
            label={say('Variables for')}
            value={scope}
            onChange={setScope}
            options={[
              { value: '', label: t('prefs.env.everywhere', { n: count(envKeys.global.length) }) },
              ...projects.map((p) => ({ value: p.id, label: `${p.name}${count(envKeys.projects[p.root]?.keys.length ?? 0)}` })),
            ]}
          />
        </Row>
      </Group>
      <EnvEditor key={scope} projectId={scope} />
    </>
  );
}
