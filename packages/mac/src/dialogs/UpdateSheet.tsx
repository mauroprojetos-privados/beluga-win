import * as Dialog from '@radix-ui/react-dialog';
import { type ReactNode, useEffect, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon, type IconName } from '../components/Icon.js';
import { UpdatePill } from '../components/UpdatePill.js';
import { Button, cx } from '../components/ui.js';
import { useMaybeBeluga } from '../lib/beluga.js';
import { usePrefs } from '../lib/prefs.js';
import { openExternal } from '../lib/system.js';
import { idleLine, lastCheckedLabel, shortVersion } from '../lib/update-model.js';
import { checkForUpdates, closeUpdateSheet, dismissNews, restartNow, setUpdateMode, startUpdates, updateLater, updateWhenIdle, useUpdates } from '../lib/updates.js';
import { useT } from '../lib/i18n.js';
import s from '../components/update.module.css';

/** Links in release notes open in the browser, never in the window. */
const NOTE_PARTS: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href) void openExternal(href);
      }}
    >
      {children}
    </a>
  ),
};

function Notes({ text }: { text: string | null | undefined }) {
  const t = useT();
  if (!text?.trim()) return null;
  return (
    <div className={cx(s.notes, 'selectable')} aria-label={t('sheets.update.whatsNew')}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={NOTE_PARTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

function Head({ icon, title, sub }: { icon: IconName; title: string; sub?: string }) {
  const t = useT();
  return (
    <div className={s.head}>
      <span className={s.mark}>
        <Icon name={icon} size={15} />
      </span>
      <div className={s.titles}>
        <Dialog.Title className={s.title}>{title}</Dialog.Title>
        {sub ? <div className={s.sub}>{sub}</div> : null}
      </div>
      <Dialog.Close className={s.close} aria-label={t('common.close')}>
        <Icon name="x" size={12} />
      </Dialog.Close>
    </div>
  );
}

const day = (date: string | null | undefined): string | undefined => {
  const t = date ? Date.parse(date) : NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : undefined;
};

type Behind = { readonly id: string; readonly name: string; readonly version?: string };

/**
 * Computers this update would leave unable to connect (BLG-777): on an older protocol than the
 * new version's. Each gets Update … First (it updates once nothing runs there).
 */
function LeftBehind({ ipc }: { ipc: number | null | undefined }) {
  const t = useT();
  const beluga = useMaybeBeluga();
  const [behind, setBehind] = useState<readonly Behind[]>([]);
  const [said, setSaid] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!beluga || ipc === undefined || ipc === null) return;
    let live = true;
    void beluga.client.call('machines.leftBehind', ipc).then(
      (list) => live && setBehind(list as readonly Behind[]),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [beluga, ipc]);
  if (!beluga || !behind.length) return null;
  const update = (m: Behind): void =>
    void beluga.client.call('machines.update', m.id, 'when-idle').then(
      (a) => setSaid((s) => ({ ...s, [m.id]: (a as { message: string }).message })),
      (err: unknown) => setSaid((s) => ({ ...s, [m.id]: err instanceof Error ? err.message : String(err) })),
    );
  return (
    <div className={cx(s.line, s.warn)} data-left-behind>
      {behind.map((m) => (
        <p key={m.id}>
          {said[m.id] ?? (m.version ? t('sheets.update.olderVersion', { name: m.name, version: m.version }) : t('sheets.update.older', { name: m.name }))}{' '}
          {said[m.id] ? null : (
            <Button size="small" onClick={() => update(m)}>
              {t('sheets.update.updateFirst', { name: m.name })}
            </Button>
          )}
        </p>
      ))}
    </div>
  );
}

/** A downloaded update: what's in it, and when it goes in. */
function Ready() {
  const t = useT();
  const { state, claude } = useUpdates();
  const available = state.available!;
  const installing = state.phase === 'installing';
  const released = day(available.date);
  return (
    <>
      <Head icon="download" title={t('sheets.update.ready', { version: shortVersion(available.version) })} sub={released ? t('sheets.update.youHaveReleased', { current: state.current, released }) : t('sheets.update.youHave', { current: state.current })} />
      <Notes text={available.notes} />
      {!installing ? <LeftBehind ipc={available.ipc} /> : null}
      {claude > 0 && !installing ? (
        <p className={cx(s.line, s.warn)}>
          {t('sheets.update.agentWorking', { count: claude })}
        </p>
      ) : null}
      {state.choice === 'idle' && !installing ? <p className={s.line}>{idleLine(state.waitingOn)}</p> : null}
      {state.error ? <p className={cx(s.line, s.error)}>{state.error}</p> : null}
      {state.mode !== 'off' && !installing ? (
        <label className={s.always}>
          <input type="checkbox" checked={state.mode === 'idle'} onChange={(e) => void setUpdateMode(e.target.checked ? 'idle' : 'ask')} />
          {t('sheets.update.automatically')}
        </label>
      ) : null}
      <div className={s.foot}>
        <Button variant="quiet" onClick={() => void updateLater()} disabled={installing} title={t('sheets.update.laterHint')}>
          {t('sheets.update.later')}
        </Button>
        <span className={s.spacer} />
        <Button onClick={() => void updateWhenIdle()} disabled={installing} title={t('sheets.update.whenIdleHint')}>
          {t('sheets.update.whenIdle')}
        </Button>
        <Button variant="primary" onClick={() => void restartNow()} disabled={installing}>
          {installing ? t('sheets.update.restarting') : t('sheets.update.restartNow')}
        </Button>
      </div>
    </>
  );
}

/** After an update installed: what changed. */
function News() {
  const t = useT();
  const { state } = useUpdates();
  const news = state.news!;
  return (
    <>
      <Head icon="check" title={t('sheets.update.nowVersion', { version: shortVersion(news.version) })} sub={t('sheets.update.updatedAway')} />
      <Notes text={news.notes} />
      <div className={s.foot}>
        <Button variant="primary" onClick={() => void dismissNews()}>
          {t('common.ok')}
        </Button>
      </div>
    </>
  );
}

/** Looking, downloading, up to date, or couldn't. */
function Status() {
  const t = useT();
  const { state } = useUpdates();
  const busy = state.phase === 'checking' || state.phase === 'downloading';
  const head: Record<string, [IconName, string]> = {
    checking: ['refresh', t('sheets.update.checking')],
    downloading: ['download', t('sheets.update.downloading')],
    error: ['alert', t('sheets.update.couldntCheck')],
  };
  const [icon, title] = head[state.phase] ?? ['check', t('sheets.update.upToDate')];
  return (
    <>
      <Head icon={icon} title={title} sub={t('sheets.update.lastChecked', { current: state.current, when: lastCheckedLabel(state.lastCheck).toLowerCase() })} />
      {state.phase === 'downloading' ? (
        <div className={s.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((state.progress ?? 0) * 100)}>
          <div className={s.barFill} style={{ width: `${Math.round((state.progress ?? 0) * 100)}%` }} />
        </div>
      ) : null}
      {state.phase === 'downloading' ? <p className={s.line}>{t('sheets.update.inBackground')}</p> : null}
      {state.phase === 'error' && state.error ? <p className={cx(s.line, s.error)}>{state.error}</p> : null}
      <div className={s.foot}>
        {state.phase === 'error' ? <Button onClick={() => void checkForUpdates()}>{t('common.retry')}</Button> : null}
        <Button variant="primary" onClick={closeUpdateSheet}>
          {busy ? t('sheets.update.hide') : t('common.ok')}
        </Button>
      </div>
    </>
  );
}

export function UpdateSheet() {
  const { state, open } = useUpdates();
  if (!open) return null;
  let body: ReactNode;
  if (state.available) body = <Ready />;
  else if (state.news && state.phase !== 'checking' && state.phase !== 'downloading') body = <News />;
  else body = <Status />;
  return (
    <Dialog.Root open onOpenChange={(v) => (v ? undefined : closeUpdateSheet())}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.sheet} aria-describedby={undefined} data-update-sheet onOpenAutoFocus={(e) => e.preventDefault()}>
          {body}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Beluga's updates in the window, whether or not Beluga itself is reachable: the sheet, and the
 * pill in a corner when there's no sidebar to hold it (see Sidebar for the usual place).
 */
export function UpdateLayer({ connected }: { connected: boolean }) {
  const prefs = usePrefs();
  useEffect(() => startUpdates(), []);
  return (
    <>
      {!connected || !prefs.sidebar ? <UpdatePill floating /> : null}
      <UpdateSheet />
    </>
  );
}
