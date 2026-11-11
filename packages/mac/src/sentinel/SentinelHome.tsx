import { RemoteList } from '../machines/RemoteList.js';
import { remoteDashboards, remoteSentinels } from '../machines/remote-work.js';
import { useRemoteSources } from '../machines/use-remote.js';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CLAUDE_CHANGED, FIRST_SENTINEL_CHAT, MAX_RUN_AT_ONCE, RUN_STATE_INFO, type RunSummary, type Sentinel, type SentinelState, lastRunOf, pausedWords, sentinelChatChannel } from '@beluga/core/sentinel/model.js';
import { Icon } from '../components/Icon.js';
import { ProjectIcon } from '../components/ProjectIcon.js';
import { type ActionItem, ActionsContext, ActionsDropdown } from '../components/SpecMenu.js';
import { Button, Empty, IconButton, Tip } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { useApi, useApp } from '../lib/beluga.js';
import { isShortcut, shortcutKeys } from '../lib/shortcuts.js';
import { currentSheet, openSheet } from '../lib/sheets.js';
import { useClock } from '../lib/window-active.js';
import { PickMenu } from '../tasks/PickMenu.js';
import { Board, SectionHead } from './DashboardPage.js';
import { Disc, RunPill, TriggerDisc } from './marks.js';
import { Markdown } from '../chat/Markdown.js';
import { ago } from '../tasks/tasks-model.js';
import { AskPanel, SentinelChat } from './SentinelChat.js';
import { Showcase } from './Showcase.js';
import { MAC_SCOPE, type Need, dotsOf, doesLine, durationText, filterSentinels, groupSentinels, headlineOf, iconOf, latestOf, needsOf, runDuration, rowOf, scopesOf } from './sentinel-model.js';
import { sentinelMenu, useRunsFolder, useSentinelActions, useSentinelState, type SentinelActions } from './use-sentinel.js';
import s from './home.module.css';
import { thisComputer } from '../lib/os-words.js';
import { useOpenFolderLabel } from '../lib/remote-open.js';
import { useT } from '../lib/i18n.js';
import type { Key } from '@beluga/shared/i18n/index.js';

/**
 * Sentinel, one page (BLG-300): what needs you, your board's numbers at a glance, and every
 * sentinel as a row that leads with what it found. Asking Claude (to set one up, change one, or put
 * something on the board) opens the Sentinel chat as a panel beside the page, where its approvals
 * show too. With nothing set up yet, the page says what a sentinel is and offers starting points.
 *
 * The views `sentinel`, `dashboard` and `sentinel_chat` all land here (old links, ⌘K and Back keep
 * working): `dashboard` picks the board, `sentinel_chat` opens the panel on that chat. The page
 * stays mounted between them, so the project, the board and the find field stay as you left them.
 */

const ALL = 'all';
/** What came back shows this many at first (the newest), the rest one click away. */
const LATEST_FIRST = 6;

export function SentinelHome() {
  const t = useT();
  const state = useSentinelState();
  const view = useApp((st) => st.view);
  const actions = useActions();
  const [scope, setScope] = useState<string | undefined>(view.kind === 'sentinel' ? view.projectId : undefined);
  const [board, setBoard] = useState<string | undefined>(view.kind === 'dashboard' ? view.id : undefined);
  useEffect(() => {
    if (view.kind === 'sentinel' && view.projectId !== undefined) setScope(view.projectId);
    if (view.kind === 'dashboard' && view.id) setBoard(view.id);
  }, [view]);
  const asking = view.kind === 'sentinel_chat';
  const active = useApp((st) => st.sentinel.chats?.active ?? FIRST_SENTINEL_CHAT);
  // Ask Sentinel stays docked on the right (it opens with the page) until you close it.
  const docked = useAskDocked();
  const any = state.items.length > 0;
  // The last sentinel just went (deleted, with the chat docked beside the list): back to the first
  // visit, not into a conversation that was only open beside the page.
  const hadAny = useRef(any);
  useLayoutEffect(() => {
    const emptied = hadAny.current && !any;
    hadAny.current = any;
    if (emptied && asking) return void actions.run({ type: 'view', view: { kind: 'sentinel' } });
    if (asking) setAskDocked(true);
    else if (docked && any && (view.kind === 'sentinel' || view.kind === 'dashboard')) actions.run({ type: 'view', view: { kind: 'sentinel_chat', chat: active } });
  }, [view, docked, any]);
  const close = (): void => {
    setAskDocked(false);
    actions.run({ type: 'view', view: { kind: 'sentinel', ...(scope ? { projectId: scope } : {}) } });
  };

  if (!state.enabled) return <Empty icon="sentinel" title={t('sentinel.page.needsApp')} detail={t('sentinel.home.needsAppDetail', { computer: thisComputer() })} />;
  // Nothing set up yet: the conversation is the page (BLG-590). Once your agent makes the first
  // sentinel, the page shows it and the chat moves aside, docked on the right.
  if (!any && asking) {
    return (
      <div className={s.home} data-asking>
        <div className={s.middle} data-testid="sentinel-first-chat">
          <SentinelChat key={view.chat ?? 'main'} onClose={() => actions.run({ type: 'view', view: { kind: 'sentinel' } })} />
        </div>
      </div>
    );
  }
  return (
    <div className={s.home} data-asking={asking || undefined}>
      <div className={s.page}>{any ? <Lived state={state} scope={scope} setScope={setScope} board={board} setBoard={setBoard} /> : <FirstVisit />}</div>
      {asking ? (
        <AskPanel>
          <SentinelChat key={view.chat ?? 'main'} onClose={close} />
        </AskPanel>
      ) : null}
    </div>
  );
}

/** Whether Ask Sentinel is docked beside the page (on unless you closed it; kept on this Mac). */
const DOCKED = 'sentinel.ask.docked';
const dockListeners = new Set<() => void>();
const readDocked = (): boolean => {
  try {
    return localStorage.getItem(DOCKED) !== '0';
  } catch {
    return true;
  }
};
function setAskDocked(on: boolean): void {
  if (readDocked() === on) return;
  try {
    localStorage.setItem(DOCKED, on ? '1' : '0');
  } catch {
    // Not kept: it still follows now.
  }
  for (const l of [...dockListeners]) l();
}
const useAskDocked = (): boolean =>
  useSyncExternalStore((l) => {
    dockListeners.add(l);
    return () => void dockListeners.delete(l);
  }, readDocked);

/** Open the Sentinel chat beside the page, and send it this (when there's something to send). */
function useAsk(): (text?: string) => void {
  const api = useApi();
  const actions = useActions();
  const active = useApp((st) => st.sentinel.chats?.active ?? FIRST_SENTINEL_CHAT);
  return (text) => {
    const said = text?.trim();
    if (said) void api.session.submit(said, { channel: sentinelChatChannel(active) });
    actions.run({ type: 'view', view: { kind: 'sentinel_chat', chat: active } });
  };
}

// ---------------------------------------------------------------- lived in

function Lived({ state, scope, setScope, board, setBoard }: { state: SentinelState; scope: string | undefined; setScope: (s: string | undefined) => void; board: string | undefined; setBoard: (id: string) => void }) {
  const t = useT();
  const allProjects = useApp((st) => st.projects);
  const projects = useMemo(() => allProjects.filter((p) => p.root && !p.error), [allProjects]);
  const a = useSentinelActions();
  const folder = useRunsFolder();
  const ask = useAsk();
  const asking = useApp((st) => st.view.kind === 'sentinel_chat');
  const now = useClock(true, 30_000);
  const [query, setQuery] = useState('');
  const find = useRef<HTMLInputElement>(null);

  // ⌘F finds, ⌘N makes a sentinel (in this project when one is picked).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || currentSheet()) return;
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"], [role="combobox"], [role="dialog"]');
      if (isShortcut('page-filter', e) && !typing) {
        e.preventDefault();
        find.current?.focus();
        find.current?.select();
      } else if (isShortcut('page-new', e) && (!typing || e.metaKey || e.ctrlKey || e.altKey)) {
        e.preventDefault();
        e.stopPropagation();
        openSheet({ kind: 'new_sentinel', ...(scope ? { projectId: scope } : {}) });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [scope]);

  const scopes = scopesOf(state.items, projects);
  // A project that no longer has sentinels falls back to all of them.
  const here = scopes.find((x) => x.value === scope) ?? scopes[0]!;
  const scoped = here.value;
  const needs = needsOf(state, scoped);
  const shown = filterSentinels(state.items, { ...(scoped ? { scope: scoped } : {}), show: 'all', query });
  const groups = groupSentinels(shown, projects);
  // A sentinel on a computer: its runs folder in your editor over Remote-SSH, else its path copied (BLG-852).
  const runsFolder = useOpenFolderLabel(t('sentinel.page.openRunsFolder'), t('sentinel.page.copyRunsFolder'));
  const more: ActionItem[] = [
    {
      label: t('sentinel.home.runAtOnce'),
      icon: 'claude',
      submenu: Array.from({ length: MAX_RUN_AT_ONCE }, (_, i) => i + 1).map((n) => ({ label: t('sentinel.home.atOnce', { count: n }), checked: state.runAtOnce === n, onSelect: () => void a.act(() => a.api.setRunAtOnce(n)) })),
      onSelect: () => undefined,
    },
    ...(folder ? [{ label: runsFolder, icon: 'folder' as const, hint: t('sentinel.home.runsFolderHint'), onSelect: () => a.openFolder(folder) }] : []),
  ];
  const projectOf = (id: string | undefined) => projects.find((p) => p.id === id);
  return (
    <>
      <div className={s.bar}>
        <PickMenu<string>
          label={t('sentinel.page.project')}
          choices={scopes.map((x) => ({
            value: x.value ?? ALL,
            label: x.label,
            hint: String(x.count),
            mark: x.value === undefined ? <Icon name="grid" size={14} /> : x.value === MAC_SCOPE ? <Icon name="laptop" size={14} /> : <ProjectIcon id={x.value} name={x.label} size={16} />,
          }))}
          chosen={[scoped ?? ALL]}
          onPick={(v) => setScope(v === ALL ? undefined : v)}
        >
          <button type="button" className={s.pick} aria-label={t('sentinel.home.projectAria', { name: here.label })}>
            {scoped && scoped !== MAC_SCOPE ? <ProjectIcon id={scoped} name={here.label} size={16} /> : <Icon name={scoped === MAC_SCOPE ? 'laptop' : 'grid'} size={14} />}
            <span>{here.label}</span>
            <span className={s.count}>{here.count}</span>
            <Icon name="chevronDown" size={10} />
          </button>
        </PickMenu>
        <label className={s.find}>
          <Icon name="search" size={12} />
          <input
            ref={find}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('sentinel.home.find')}
            aria-label={t('sentinel.home.find')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') (setQuery(''), (e.target as HTMLInputElement).blur());
            }}
          />
        </label>
        <span className={s.grow} />
        <ActionsDropdown items={more}>
          <IconButton icon="more" label={t('sentinel.home.moreForSentinel')} />
        </ActionsDropdown>
        {asking ? null : (
          <Tip label={t('sentinel.home.askTip')}>
            <Button size="small" icon="claude" onClick={() => ask()}>
              {t('sentinel.home.askAgent')}
            </Button>
          </Tip>
        )}
        <Tip label={t('sentinel.home.newTip')} keys={shortcutKeys('page-new')}>
          <Button variant="primary" size="small" icon="plus" onClick={() => openSheet({ kind: 'new_sentinel', ...(scoped ? { projectId: scoped } : {}) })}>
            {t('sentinel.home.newSentinel')}
          </Button>
        </Tip>
      </div>

      {needs.length && !query ? <NeedsYou needs={needs} a={a} /> : null}

      {query ? null : (
        <Board {...(board ? { id: board } : {})} onPick={setBoard} {...(scoped ? { scope: scoped } : {})}>
          <Latest state={state} scope={scoped} now={now} a={a} />
        </Board>
      )}

      <section aria-label={t('sentinel.home.watching')}>
        <SectionHead title={t('sentinel.home.watching')} count={shown.length} />
        {!shown.length ? (
          <div className={s.nothing}>{query ? (scoped ? t('sentinel.home.nothingCalledIn', { query, place: here.label }) : t('sentinel.home.nothingCalled', { query })) : t('sentinel.home.noneIn', { place: here.label })}</div>
        ) : (
          <div role="table" aria-label={t('sentinel.home.sentinels')}>
            {groups.map((g) => (
              <div key={g.projectId ?? MAC_SCOPE} role="rowgroup" aria-label={g.name}>
                {groups.length > 1 ? (
                  <div className={s.group}>
                    {g.projectId && projectOf(g.projectId) ? <ProjectIcon id={g.projectId} name={g.name} size={13} /> : <Icon name="laptop" size={12} />}
                    {g.name}
                  </div>
                ) : null}
                {g.items.map((x) => (
                  <WatchRow key={x.id} item={x} state={state} now={now} a={a} />
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
      {/* Sentinels and dashboards on your computers (BLG-785). */}
      <RemoteSentinels />
    </>
  );
}

/** Your computers' sentinels and dashboards, tagged. */
function RemoteSentinels() {
  const t = useT();
  const sources = useRemoteSources();
  const paused = t('sentinel.model.pausedWord');
  const sentinels = useMemo(() => remoteSentinels(sources).map((r) => ({ ...r, item: { id: r.item.id, title: r.item.name, sub: [r.item.project, r.item.paused ? paused : undefined].filter(Boolean).join(' · '), page: { kind: 'sentinel_page' as const, id: r.item.id } } })), [sources, paused]);
  const dashboards = useMemo(() => remoteDashboards(sources).map((r) => ({ ...r, item: { id: r.item.id, title: r.item.name, page: { kind: 'dashboard' as const, id: r.item.id } } })), [sources]);
  return (
    <>
      <RemoteList title={t('sentinel.home.remoteSentinels')} rows={sentinels} />
      <RemoteList title={t('sentinel.home.remoteDashboards')} rows={dashboards} />
    </>
  );
}

/** What waits for you, each with the one thing to do about it. */
function NeedsYou({ needs, a }: { needs: readonly Need[]; a: SentinelActions }) {
  const t = useT();
  return (
    <section aria-label={t('sentinel.home.needsYou')}>
      <SectionHead title={t('sentinel.home.needsYou')} count={needs.length} />
      <div className={s.needs}>
        {needs.map((x) => (
          <div key={x.key} className={s.need} data-kind={x.kind} data-need={x.key}>
            <Icon name={x.kind === 'merge' ? 'merge' : x.kind === 'draft' || x.kind === 'changed' ? 'claude' : 'alert'} size={14} className={s.needIcon} />
            <button type="button" className={s.needText} onClick={() => (x.kind === 'merge' ? a.openRun(x.run.id) : a.open(x.sentinel.id))}>
              <strong>{x.title}</strong>
              <span>{x.detail}</span>
            </button>
            {x.kind === 'merge' ? (
              <>
                <Button size="small" variant="quiet" onClick={() => void a.act(() => a.api.decide(x.run.id, 'skip'), x.run.pr ? t('sentinel.home.staysOpen', { number: x.run.pr.number }) : t('sentinel.home.notNowToast'))}>
                  {t('common.notNow')}
                </Button>
                <Button size="small" variant="merge" icon="merge" onClick={() => void a.act(() => a.api.decide(x.run.id, 'merge'), x.run.pr ? t('sentinel.home.mergedPr', { number: x.run.pr.number }) : t('sentinel.home.merged'))}>
                  {t('sentinel.home.merge')}
                </Button>
              </>
            ) : (
              <>
                <Button size="small" variant="quiet" onClick={() => a.open(x.sentinel.id)}>
                  {t('common.open')}
                </Button>
                {x.kind === 'trouble' ? null : (
                  <Button size="small" variant="primary" icon="play" onClick={() => void a.setPaused(x.sentinel, false)}>
                    {x.kind === 'failing' ? t('sentinel.page.resume') : t('sentinel.dash.turnOn')}
                  </Button>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** A sentinel's row: what it is and does above, what it found last as the main line, its recent runs as dots, when it runs next. */
const WatchRow = memo(function WatchRow({ item, state, now, a }: { item: Sentinel; state: SentinelState; now: number; a: SentinelActions }) {
  const t = useT();
  const row = rowOf(state, item, now);
  const dots = dotsOf(state, item.id, now);
  const menu = (): ActionItem[] => sentinelMenu(item, lastRunOf(state, item.id), a);
  const broken = item.pausedWhy && item.pausedWhy !== CLAUDE_CHANGED;
  return (
    <ActionsContext items={menu}>
      <div
        role="row"
        tabIndex={0}
        className={s.row}
        data-paused={item.paused || undefined}
        data-sentinel={item.id}
        onClick={() => a.open(item.id)}
        onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && a.open(item.id)}
        aria-label={item.paused ? t('sentinel.home.rowAriaPaused', { name: item.name, sentence: row.sentence }) : t('sentinel.home.rowAria', { name: item.name, sentence: row.sentence })}
      >
        <TriggerDisc kind={item.trigger.kind} paused={item.paused} size={28} />
        <span className={s.rowMain}>
          <span className={s.rowTop}>
            <span className={s.rowName}>{item.name}</span>
            <span className={s.rowWhat}>
              {row.sentence} · {doesLine(item)}
            </span>
          </span>
          <span className={s.found} data-state={row.last?.state} title={row.last?.headline}>
            {broken ? <span className={s.problem}>{pausedWords(item)} · </span> : item.paused ? <span className={s.quiet}>{pausedWords(item) ?? t('sentinel.home.paused')} · </span> : row.trouble ? <span className={s.problem}>{t('sentinel.home.cantWatch', { why: row.trouble })} · </span> : null}
            {row.last ? (row.last.state === 'done' || row.last.state === 'skipped' ? row.last.headline : `${row.last.label}: ${row.last.headline}`) : t('sentinel.home.notRunYet')}
          </span>
        </span>
        <span className={s.dots} aria-label={t('sentinel.home.lastRuns', { count: dots.length })}>
          {dots.map((d) => (
            <Tip key={d.id} label={d.label}>
              <i data-tone={RUN_STATE_INFO[d.state].tone} data-live={d.state === 'running' || undefined} />
            </Tip>
          ))}
        </span>
        <span className={s.next}>{row.last && !item.paused ? (row.next ?? (item.trigger.kind === 'manual' ? t('sentinel.home.byHand') : t('sentinel.home.onEvent'))) : item.paused ? '' : (row.next ?? '')}</span>
        <span className={s.rowMore} onClick={(e) => e.stopPropagation()}>
          <ActionsDropdown items={menu()}>
            <IconButton icon="more" label={t('sentinel.home.whatToDo', { name: item.name })} />
          </ActionsDropdown>
        </span>
      </div>
    </ActionsContext>
  );
});

/**
 * What came back, as messages: each sentinel's latest run, newest first, with what it left (Claude's
 * report rendered, else its one line, else that it's done and how long it took). A click opens the run.
 */
function Latest({ state, scope, now, a }: { state: SentinelState; scope: string | undefined; now: number; a: SentinelActions }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const latest = latestOf(state, scope);
  if (!latest.length) return null;
  const shown = all ? latest : latest.slice(0, LATEST_FIRST);
  return (
    <div className={s.latest} role="feed" aria-label={t('sentinel.home.cameBack')}>
      <div className={s.latestHead}>{t('sentinel.home.cameBack')}</div>
      <div className={s.messages}>
        {shown.map(({ sentinel, run }) => (
          <Message key={run.id} sentinel={sentinel} run={run} now={now} a={a} />
        ))}
      </div>
      {latest.length > LATEST_FIRST ? (
        <button type="button" className={s.messageMore} style={{ marginTop: 8 }} onClick={() => setAll(!all)}>
          {all ? t('sentinel.home.showFewer') : t('sentinel.home.showMore', { count: latest.length - LATEST_FIRST })}
        </button>
      ) : null}
    </div>
  );
}

const Message = memo(function Message({ sentinel, run, now, a }: { sentinel: Sentinel; run: RunSummary; now: number; a: SentinelActions }) {
  const t = useT();
  const api = useApi();
  const projects = useApp((st) => st.projects);
  const project = sentinel.projectId ? projects.find((p) => p.id === sentinel.projectId) : undefined;
  const [report, setReport] = useState<string>();
  const [open, setOpen] = useState(false);
  const ended = run.state !== 'running' && run.state !== 'queued';
  useEffect(() => {
    if (!ended) return;
    let alive = true;
    api.sentinel.runGet(run.id).then(
      (r) => alive && setReport(r.report?.trim() || undefined),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [api, run.id, ended]);
  const line = headlineOf(run);
  // The report's first line is the headline: the rest is what's worth reading.
  const rest = report && report.split('\n')[0]?.replace(/^#+\s*/, '').trim() === line.trim() ? report.split('\n').slice(1).join('\n').trim() : report;
  return (
    <article className={s.message} data-state={run.state} data-run={run.id} aria-label={`${sentinel.name}: ${line}`}>
      <button type="button" className={s.messageHead} onClick={() => a.openRun(run.id)}>
        <Disc icon={iconOf(sentinel.icon)} tone={run.state === 'failed' ? 'paused' : 'clock'} size={22} />
        <strong>{sentinel.name}</strong>
        {project ? <ProjectIcon id={project.id} name={project.name} size={13} /> : <Icon name="laptop" size={12} />}
        <span className={s.messageWhen}>{ago(run.endedAt ?? run.startedAt, now)}</span>
        <span className={s.grow} />
        {run.state === 'done' ? null : <RunPill state={run.state} />}
      </button>
      <div className={s.messageLine}>{line}</div>
      {rest ? (
        <div className={s.messageBody} data-open={open || undefined}>
          <Markdown text={rest} tasks />
        </div>
      ) : run.state === 'done' && !run.headline ? (
        <div className={s.messageQuiet}>{t('sentinel.home.doneTook', { took: durationText(runDuration(run, now)) })}</div>
      ) : null}
      {rest && rest.length > 280 ? (
        <button type="button" className={s.messageMore} onClick={() => setOpen(!open)}>
          {open ? t('sentinel.home.showLess') : t('sentinel.home.showAll')}
        </button>
      ) : null}
    </article>
  );
});

// ---------------------------------------------------------------- the first visit

/** One-tap ideas under the box: the first lets Claude look at your projects and suggest. */
const IDEAS: ReadonlyArray<{ readonly id: string; readonly icon: Parameters<typeof Icon>[0]['name'] }> = [
  { id: 'suggest', icon: 'sparkles' },
  { id: 'dashboard', icon: 'gauge' },
  { id: 'brief', icon: 'clock' },
  { id: 'website', icon: 'pulse' },
  { id: 'tests', icon: 'wrench' },
];

/**
 * Nothing set up yet (BLG-334): shown before it's explained. What Sentinel can do as a few scenes,
 * a box to say what you want, a few one-tap ideas (the first has Claude look and suggest), and every
 * recipe one tap away. Under forty words before the scenes.
 */
function FirstVisit() {
  const t = useT();
  const ask = useAsk();
  // A conversation already under way (you went back to this page from it): one click returns to it.
  const talked = useApp((st) => {
    const channel = sentinelChatChannel(st.sentinel.chats?.active ?? FIRST_SENTINEL_CHAT);
    return st.log.some((l) => l.channel === channel);
  });
  const [words, setWords] = useState('');
  const send = (): void => {
    if (!words.trim()) return;
    ask(words);
    setWords('');
  };
  return (
    <div className={s.first} data-testid="sentinel-first">
      <h1 className={s.firstTitle}>{t('sentinel.home.firstTitle')}</h1>
      <p className={s.lede}>{t('sentinel.home.firstLede')}</p>
      <Showcase onPick={(slide) => ask(slide.prompt)} />
      <div className={s.composer}>
        <textarea
          className={s.composerText}
          value={words}
          rows={2}
          placeholder={t('sentinel.home.composerPlaceholder')}
          aria-label={t('sentinel.home.composerAria')}
          onChange={(e) => setWords(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className={s.composerRow}>
          <span className={s.composerHint}>{t('sentinel.home.composerHint')}</span>
          <span className={s.grow} />
          <IconButton icon="send" label={t('sentinel.home.askAgent')} className={s.send} disabled={!words.trim()} onClick={send} />
        </div>
      </div>
      <div className={s.ideas} role="list" aria-label={t('sentinel.home.ideas')}>
        {IDEAS.map((x, i) => (
          <button key={x.id} type="button" role="listitem" className={s.idea} data-lead={i === 0 || undefined} onClick={() => ask(t(`sentinel.home.idea.${x.id}.prompt` as Key))}>
            <Icon name={x.icon} size={13} />
            {t(`sentinel.home.idea.${x.id}` as Key)}
          </button>
        ))}
      </div>
      <div className={s.firstFoot}>
        {talked ? (
          <button type="button" className={s.link} onClick={() => ask()}>
            {t('sentinel.home.backToChat')}
          </button>
        ) : null}
        <button type="button" className={s.link} onClick={() => openSheet({ kind: 'new_sentinel', way: 'recipe' })}>
          {t('sentinel.home.everyRecipe')}
        </button>
        <button type="button" className={s.link} onClick={() => openSheet({ kind: 'new_sentinel', way: 'build' })}>
          {t('sentinel.home.buildStep')}
        </button>
      </div>
    </div>
  );
}

