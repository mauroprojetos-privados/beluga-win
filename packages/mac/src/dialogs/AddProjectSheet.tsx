import { baseName, sepOf } from '@beluga/shared/os-path.js';
import { cloneableOrigin, repoName } from '@beluga/shared/repo-key.js';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DotMatrix } from '../components/DotMatrix.js';
import { Icon } from '../components/Icon.js';
import { ProjectIcon } from '../components/ProjectIcon.js';
import { Button, Segmented, cx } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { canPickFolders, inApp, webServed } from '../lib/boot.js';
import { useApi, useApp, useBeluga, useUi } from '../lib/beluga.js';
import { pickFolders } from '../lib/projects.js';
import s from './add-project.module.css';
import { thisComputer } from '../lib/os-words.js';
import { useT } from '../lib/i18n.js';
import { t as tt } from '@beluga/shared/i18n/index.js';

interface Found {
  readonly path: string;
  readonly name: string;
  readonly changed: number;
}

const ago = (ts: number): string => {
  const d = Math.max(0, (Date.now() - ts) / 1000);
  if (d < 3600) return tt('sheets.addProject.justNow');
  if (d < 86_400) return tt('sheets.addProject.hoursAgo', { n: Math.floor(d / 3600) });
  if (d < 86_400 * 30) return tt('sheets.addProject.daysAgo', { n: Math.floor(d / 86_400) });
  return tt('sheets.addProject.monthsAgo', { n: Math.floor(d / (86_400 * 30)) });
};

type Mode = 'add' | 'new' | 'clone';

/** A folder you added here: on its way (adding takes a moment), in, or why it couldn't be. */
type Row = { readonly kind: 'adding'; readonly init?: boolean } | { readonly kind: 'added' } | { readonly kind: 'failed'; readonly error: string; readonly canInit?: boolean };

/** Suggestions shown before you filter (Filter searches every one found). */
const NEWEST = 24;

/**
 * Add projects the Mac way: drop folders on it, choose them in the Open panel, or pick from the
 * git projects already on this Mac (most recently worked on first). Or start a new one, or clone
 * one from its git address.
 */
export function AddProjectSheet() {
  const t = useT();
  const { ui } = useBeluga();
  const api = useApi();
  const asked = useUi((u) => u.addProject ?? false);
  const open = asked !== false;
  const [mode, setMode] = useState<Mode>('add');
  const home = useApp((st) => st.home);
  const roots = useApp((st) => st.projects.map((p) => p.root).filter(Boolean).join('\n'));
  // Projects you hid: listed too, with Show (they come back where they were).
  const hidden = useApp((st) => st.hiddenProjects.join('\n'));
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const [found, setFound] = useState<Found[] | undefined>();
  const [rows, setRows] = useState<ReadonlyMap<string, Row>>(new Map());
  const [filter, setFilter] = useState('');
  const [typed, setTyped] = useState('');
  const [over, setOver] = useState(false);
  const filterBox = useRef<HTMLInputElement>(null);
  const close = (): void => ui.patch({ addProject: false });
  const short = (p: string): string => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);

  useEffect(() => {
    if (!open) return;
    setMode(asked === 'new' || asked === 'clone' ? asked : 'add');
    setRows(new Map());
    setRevealed(new Set());
    setFilter('');
    setFound(undefined);
    void api.projects.suggest().then(setFound, () => setFound([]));
  }, [open, asked]);

  const mark = (path: string, row: Row): void => setRows((m) => new Map(m).set(path, row));
  // Each folder shows Adding… on its row at once, then Added or what went wrong.
  const add = async (paths: readonly string[]): Promise<void> => {
    await Promise.all(
      paths.map(async (p) => {
        mark(p, { kind: 'adding' });
        const res = await api.projects.add(p).catch((err: unknown) => ({ error: errorText(err) }));
        mark(p, res.error ? { kind: 'failed', error: res.error, canInit: 'canInit' in res && res.canInit } : { kind: 'added' });
      }),
    );
  };
  // A plain folder: git there, what's in it in a first commit, and it's added.
  const initGit = async (p: string): Promise<void> => {
    mark(p, { kind: 'adding', init: true });
    const res = await api.projects.initGit(p).catch((err: unknown) => ({ error: errorText(err) }));
    mark(p, res.error ? { kind: 'failed', error: res.error } : { kind: 'added' });
  };

  // Folders dropped anywhere on the window while this is open are added.
  useEffect(() => {
    if (!open || mode !== 'add' || !inApp()) return;
    let off: (() => void) | undefined;
    let alive = true;
    void import('@tauri-apps/api/webview').then(async ({ getCurrentWebview }) => {
      const un = await getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === 'over' || e.payload.type === 'enter') setOver(true);
        else if (e.payload.type === 'leave') setOver(false);
        else if (e.payload.type === 'drop') {
          setOver(false);
          void add(e.payload.paths);
        }
      });
      if (alive) off = un;
      else un();
    });
    return () => {
      alive = false;
      off?.();
    };
  }, [open, mode]);

  const show = async (path: string): Promise<void> => {
    if (await api.workspaces.showProject(path)) setRevealed((r) => new Set([...r, path]));
  };

  const hiddenSet = useMemo(() => new Set(hidden.split('\n').filter(Boolean)), [hidden]);
  const shown = useMemo(() => {
    const known = new Set(roots.split('\n'));
    const q = filter.trim().toLowerCase();
    const listed = new Set((found ?? []).map((f) => f.path));
    // Folders you dropped, chose or typed (not among the suggestions) and hidden projects come first.
    const extra = found ? [...rows.keys(), ...hiddenSet, ...revealed].filter((p, i, all) => !listed.has(p) && all.indexOf(p) === i).map((p): Found => ({ path: p, name: baseName(p) || p, changed: 0 })) : [];
    const newest = (found ?? []).filter((f, i) => q || i < NEWEST || rows.has(f.path));
    return [...extra, ...newest]
      .filter((f) => !known.has(f.path) || rows.has(f.path) || revealed.has(f.path))
      .filter((f) => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
  }, [found, filter, roots, rows, hiddenSet, revealed]);

  const choose = async (): Promise<void> => {
    const picked = await pickFolders(t('sheets.addProject.addProjects'));
    if (picked) await add(picked);
  };

  if (!open) return null;
  return (
    <Dialog.Root open onOpenChange={(v) => (v ? undefined : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.sheet} aria-describedby={undefined} onOpenAutoFocus={(e) => (e.preventDefault(), mode === 'add' && filterBox.current?.focus())}>
          <div className={s.head}>
            <Dialog.Title className={s.title}>{mode === 'new' ? t('sheets.addProject.newProject') : mode === 'clone' ? t('sheets.addProject.cloneProject') : t('sheets.addProject.addProjects')}</Dialog.Title>
            <Dialog.Close className={s.close} aria-label={t('common.close')}>
              <Icon name="x" size={11} />
            </Dialog.Close>
          </div>

          <div className={s.modes}>
            <Segmented<Mode>
              label={t('sheets.addProject.addOrStart')}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'add', label: t('sheets.addProject.addExisting'), icon: 'folder' },
                { value: 'new', label: t('sheets.addProject.startNew'), icon: 'plus' },
                { value: 'clone', label: t('sheets.addProject.clone'), icon: 'download' },
              ]}
            />
          </div>
          {mode === 'new' ? (
            <NewProject onDone={close} />
          ) : mode === 'clone' ? (
            <CloneProject onDone={close} />
          ) : (
            <>
              <div
                className={cx(s.drop, over && s.dropOver)}
                onDragOver={(e) => (e.preventDefault(), setOver(true))}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => (e.preventDefault(), setOver(false))}
              >
                <Icon name="folder" size={22} />
                <div className={s.dropText}>
                  <strong>{webServed() ? t('sheets.addProject.chooseWhereRuns') : t('sheets.addProject.dropHere')}</strong>
                  <span>{t('sheets.addProject.dropDetail')}</span>
                </div>
                {canPickFolders() ? (
                  <Button variant="primary" onClick={() => void choose()}>
                    {t('sheets.addProject.chooseFolders')}
                  </Button>
                ) : null}
              </div>

              <div className={s.listHead}>
                <span>{t('sheets.addProject.onComputer', { computer: thisComputer() })}</span>
                <input ref={filterBox} className={s.filter} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('sheets.addProject.filter')} aria-label={t('sheets.addProject.filterOn', { computer: thisComputer() })} />
              </div>
              <div className={s.list} role="list">
                {found === undefined ? (
                  <div className={s.note}>{t('sheets.addProject.looking')}</div>
                ) : shown.length === 0 ? (
                  <div className={s.note}>{filter ? t('sheets.addProject.nothingCalled', { filter }) : t('sheets.addProject.noOthers')}</div>
                ) : (
                  shown.map((f) => {
                    const row = rows.get(f.path);
                    const done = row?.kind === 'added' || revealed.has(f.path);
                    const wasHidden = hiddenSet.has(f.path) || revealed.has(f.path);
                    const when = wasHidden ? t('sheets.addProject.hidden') : f.changed ? ago(f.changed) : undefined;
                    return (
                      <div key={f.path} className={s.item} role="listitem" onDoubleClick={() => !done && !row && void (wasHidden ? show(f.path) : add([f.path]))}>
                        <ProjectIcon id={`path:${f.path}`} name={f.name} size={26} />
                        <span className={s.itemText}>
                          <span className={s.itemName}>{f.name}</span>
                          {row?.kind === 'failed' ? (
                            <span className={s.itemError} role="alert">
                              {row.error}
                            </span>
                          ) : (
                            <span className={s.itemPath}>
                              {short(f.path)}
                              {when ? ` · ${when}` : ''}
                            </span>
                          )}
                        </span>
                        {row?.kind === 'adding' ? (
                          <span className={s.adding}>
                            <DotMatrix size={12} /> {row.init ? t('sheets.addProject.settingUpGit') : t('sheets.addProject.adding')}
                          </span>
                        ) : done ? (
                          <span className={s.added}>
                            <Icon name="check" size={12} /> {wasHidden ? t('sheets.addProject.showing') : t('sheets.addProject.added')}
                          </span>
                        ) : wasHidden ? (
                          <Button size="small" onClick={() => void show(f.path)} aria-label={t('sheets.addProject.showName', { name: f.name })}>
                            {t('sheets.addProject.show')}
                          </Button>
                        ) : row?.kind === 'failed' && row.canInit ? (
                          <Button size="small" onClick={() => void initGit(f.path)} aria-label={t('sheets.addProject.setUpGitIn', { name: f.name })}>
                            {t('sheets.addProject.setUpGit')}
                          </Button>
                        ) : (
                          <Button size="small" onClick={() => void add([f.path])}>
                            {row?.kind === 'failed' ? t('common.retry') : t('sheets.addProject.add')}
                          </Button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <form
                className={s.pathRow}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!typed.trim()) return;
                  void add([typed.trim()]);
                  setTyped('');
                }}
              >
                <input className={s.path} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t('sheets.addProject.typePath')} aria-label={t('sheets.addProject.folderPath')} spellCheck={false} />
                <Button size="small" type="submit" disabled={!typed.trim()}>
                  {t('sheets.addProject.add')}
                </Button>
                <span className={s.flex} />
                <Button variant={rows.size || revealed.size ? 'primary' : 'quiet'} onClick={close}>
                  {rows.size || revealed.size ? t('common.done') : t('common.cancel')}
                </Button>
              </form>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Where a new or cloned project goes: your code folder, until you pick another. */
function useParent(): [string | undefined, (dir: string) => void] {
  const api = useApi();
  const [parent, setParent] = useState<string | undefined>();
  useEffect(() => {
    void api.projects.newHome().then(
      (dir) => setParent((p) => p ?? dir),
      () => undefined,
    );
  }, []);
  return [parent, setParent];
}

const useShort = (): ((p: string) => string) => {
  const home = useApp((st) => st.home);
  return (p) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);
};

/** The In row: the folder, and Change… (or a path to type where folders can't be picked). */
function Where({ parent, onChange, label }: { parent: string | undefined; onChange: (dir: string) => void; label: string }) {
  const t = useT();
  const short = useShort();
  const change = async (): Promise<void> => {
    const picked = await pickFolders(label);
    if (picked?.[0]) onChange(picked[0]);
  };
  return (
    <div className={s.field}>
      <span>{t('sheets.addProject.in')}</span>
      <div className={s.whereRow}>
        {canPickFolders() ? (
          <>
            <span className={s.whereText}>
              <Icon name="folder" size={13} /> {parent ? short(parent) : t('sheets.addProject.yourCodeFolder')}
            </span>
            <Button size="small" onClick={() => void change()}>
              {t('sheets.addProject.change')}
            </Button>
          </>
        ) : (
          <input className={s.path} value={parent ? short(parent) : ''} onChange={(e) => onChange(e.target.value)} aria-label={label} spellCheck={false} />
        )}
      </div>
    </div>
  );
}

/** Start new: a name and where it goes; Beluga makes the folder, git and a first commit, then opens a worktree draft in it. */
function NewProject({ onDone }: { onDone: () => void }) {
  const t = useT();
  const api = useApi();
  const actions = useActions();
  const short = useShort();
  const [name, setName] = useState('');
  const [parent, setParent] = useParent();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const nameBox = useRef<HTMLInputElement>(null);

  useEffect(() => nameBox.current?.focus(), []);

  const create = async (): Promise<void> => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const made = await api.projects.create(name.trim(), parent);
      onDone();
      // Its first task: describe what to build, and it gets a worktree of its own.
      actions.run({ type: 'new_worktree', projectId: made.id });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const where = parent ? `${short(parent).replace(/[\\/]+$/, '')}${sepOf(parent)}${name.trim() || t('sheets.addProject.namePlaceholder')}` : undefined;
  return (
    <form
      className={s.newForm}
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <label className={s.field}>
        <span>{t('sheets.addProject.name')}</span>
        <input ref={nameBox} className={s.nameInput} value={name} onChange={(e) => (setName(e.target.value), setError(undefined))} placeholder="my-app" aria-label={t('sheets.addProject.projectName')} spellCheck={false} autoComplete="off" />
      </label>
      <Where parent={parent} onChange={setParent} label={t('sheets.addProject.whereNew')} />
      <p className={error ? s.newError : s.newNote} role={error ? 'alert' : undefined}>
        {error ?? (where ? t('sheets.addProject.makes', { where }) : t('sheets.addProject.makesFolder'))}
      </p>
      <div className={s.pathRow}>
        <span className={s.flex} />
        <Button variant="quiet" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" type="submit" disabled={!name.trim() || busy}>
          {busy ? t('sheets.addProject.creating') : t('sheets.addProject.createProject')}
        </Button>
      </div>
    </form>
  );
}

/** Clone: a git address (https or ssh) and where it goes; Beluga clones and adds it, then opens a worktree draft in it. */
function CloneProject({ onDone }: { onDone: () => void }) {
  const t = useT();
  const api = useApi();
  const actions = useActions();
  const short = useShort();
  const [url, setUrl] = useState('');
  const [parent, setParent] = useParent();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const urlBox = useRef<HTMLInputElement>(null);

  useEffect(() => urlBox.current?.focus(), []);

  const address = url.trim();
  const name = cloneableOrigin(address) ? repoName(address) : undefined;
  const clone = async (): Promise<void> => {
    if (!address || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const got = await api.projects.clone(address, parent);
      onDone();
      actions.run({ type: 'new_worktree', projectId: got.id });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const where = parent && name ? `${short(parent).replace(/[\\/]+$/, '')}${sepOf(parent)}${name}` : undefined;
  return (
    <form
      className={s.newForm}
      onSubmit={(e) => {
        e.preventDefault();
        void clone();
      }}
    >
      <label className={s.field}>
        <span>{t('sheets.addProject.address')}</span>
        <input
          ref={urlBox}
          className={s.nameInput}
          value={url}
          onChange={(e) => (setUrl(e.target.value), setError(undefined))}
          placeholder="https://github.com/owner/repo"
          aria-label={t('sheets.addProject.gitAddress')}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <Where parent={parent} onChange={setParent} label={t('sheets.addProject.whereCloned')} />
      <p className={error ? s.newError : s.newNote} role={error ? 'alert' : undefined}>
        {error ?? (busy ? t('sheets.addProject.cloningSlow') : where ? t('sheets.addProject.clonesInto', { where }) : t('sheets.addProject.addressHint'))}
      </p>
      <div className={s.pathRow}>
        <span className={s.flex} />
        <Button variant="quiet" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" type="submit" disabled={!address || busy}>
          {busy ? t('sheets.addProject.cloning') : t('sheets.addProject.cloneProjectButton')}
        </Button>
      </div>
    </form>
  );
}
