import { useEffect, useMemo, useRef, useState } from 'react';
import { channelOf } from '@beluga/core/store.js';
import { FIRST_SENTINEL_CHAT, sentinelChatOf, sentinelChatTitle } from '@beluga/core/sentinel/model.js';
import { activityOf } from '@beluga/ui/workspace-models.js';
import { Attention } from '../chat/Attention.js';
import { ChatLog } from '../chat/ChatLog.js';
import { Composer } from '../chat/Composer.js';
import { Icon } from '../components/Icon.js';
import { type ActionItem, ActionsDropdown } from '../components/SpecMenu.js';
import { Empty, IconButton, Segmented, Tip } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { useApi, useApp } from '../lib/beluga.js';
import { sameDeep } from '../lib/stable.js';
import { openSheet } from '../lib/sheets.js';
import { PickMenu } from '../tasks/PickMenu.js';
import { ResizeHandle, useWindowWidth } from '../layout/panel/ResizeHandle.js';
import { useSentinelActions } from './use-sentinel.js';
import v from '../views/views.module.css';
import s from './sentinel.module.css';
import home from './home.module.css';
import { useT } from '../lib/i18n.js';

type T = ReturnType<typeof useT>;

/**
 * Ask Sentinel (docs/sentinel.md §12, BLG-306): one conversation with your own Claude for the whole
 * of Sentinel, docked beside Sentinel's page. It is the app's own chat (the conversation, its
 * approvals and questions, the message box), with a slim bar: the chat's name (a picker when there
 * are several), New Chat, ⋯ with Clear and Delete Chat…, and × to close the panel. Claude knows how
 * Sentinel works and sees it as it is; deleting a sentinel or a board asks you first, in the card
 * under the conversation (and on your phone).
 */

type Starter = { readonly label: string; readonly icon: Parameters<typeof Icon>[0]['name']; readonly prompt: string };

/** What your agent makes here (BLG-590): newcomers don't know, so the empty chat shows each with examples. */
type Kind = 'dashboard' | 'watcher' | 'pipeline';
const KINDS = (t: T): ReadonlyArray<{ value: Kind; label: string; icon: Parameters<typeof Icon>[0]['name']; line: string }> => [
  { value: 'dashboard', label: t('sentinel.chat.dashboards'), icon: 'gauge', line: t('sentinel.chat.dashboardsLine') },
  { value: 'watcher', label: t('sentinel.chat.watchers'), icon: 'sentinel', line: t('sentinel.chat.watchersLine') },
  { value: 'pipeline', label: t('sentinel.chat.pipelines'), icon: 'link', line: t('sentinel.chat.pipelinesLine') },
];

/** The first line, whatever kind is picked: your agent looks and suggests; with sentinels already, what they found. */
function leadsFor(t: T, has: boolean): Starter[] {
  return [
    { label: t('sentinel.home.idea.suggest'), icon: 'sparkles', prompt: t('sentinel.chat.suggestPrompt') },
    ...(has ? [{ label: t('sentinel.chat.whatFound'), icon: 'sentinel', prompt: t('sentinel.chat.whatFoundPrompt') } satisfies Starter] : []),
  ];
}

/** Examples of each kind, naming your own projects when there are some. */
function examplesFor(t: T, kind: Kind, projects: readonly string[]): Starter[] {
  const [one, two] = projects;
  if (kind === 'dashboard') {
    return [
      { label: one ? t('sentinel.chat.glanceAt', { project: one }) : t('sentinel.chat.glance'), icon: 'gauge', prompt: t('sentinel.chat.glancePrompt', { project: one ?? t('sentinel.chat.myProjects') }) },
      { label: t('sentinel.chat.openPrs'), icon: 'gauge', prompt: t('sentinel.chat.openPrsPrompt') },
      { label: t('sentinel.chat.revenue'), icon: 'gauge', prompt: t('sentinel.chat.revenuePrompt') },
    ];
  }
  if (kind === 'watcher') {
    return [
      { label: one ? t('sentinel.chat.briefFor', { project: one }) : t('sentinel.home.idea.brief'), icon: 'clock', prompt: t('sentinel.chat.briefPrompt', { project: one ?? t('sentinel.chat.myProjects') }) },
      { label: t('sentinel.chat.siteDown'), icon: 'pulse', prompt: t('sentinel.chat.siteDownPrompt') },
      { label: t('sentinel.chat.newIssues'), icon: 'sentinel', prompt: t('sentinel.chat.newIssuesPrompt', { project: one ?? t('sentinel.chat.oneOfMyProjects') }) },
    ];
  }
  return [
    { label: two ? t('sentinel.chat.fixTestsOf', { project: two }) : t('sentinel.home.idea.tests'), icon: 'wrench', prompt: t('sentinel.chat.fixTestsPrompt', { project: two ?? t('sentinel.chat.oneOfMyProjects') }) },
    { label: t('sentinel.chat.reviewPrs'), icon: 'link', prompt: t('sentinel.chat.reviewPrsPrompt') },
    { label: t('sentinel.chat.weekly'), icon: 'link', prompt: t('sentinel.chat.weeklyPrompt') },
  ];
}

/**
 * The empty chat: what your agent builds here, picked by kind, with a few examples to tap, and
 * "Suggest Some for Me" first. Tapping one sends it, as if you'd typed it.
 */
function Starts({ projects, has, send }: { projects: readonly string[]; has: boolean; send: (prompt: string) => void }) {
  const t = useT();
  const [kind, setKind] = useState<Kind>('dashboard');
  const kinds = KINDS(t);
  const picked = kinds.find((k) => k.value === kind)!;
  const pill = (x: Starter, lead?: boolean) => (
    <button key={x.label} type="button" className={home.idea} data-lead={lead || undefined} onClick={() => send(x.prompt)}>
      <Icon name={x.icon} size={13} />
      {x.label}
    </button>
  );
  return (
    <div className={s.starts} data-testid="sentinel-starts">
      <Segmented<Kind> radio label={t('sentinel.chat.canMake')} value={kind} options={kinds.map(({ value, label, icon }) => ({ value, label, icon }))} onChange={setKind} />
      <p className={s.startsLine}>{picked.line}</p>
      <div className={home.ideas} role="group" aria-label={t('sentinel.chat.toAskFor', { kinds: picked.label })}>
        {examplesFor(t, kind, projects).map((x) => pill(x))}
      </div>
      <div className={home.ideas} role="group" aria-label={t('sentinel.chat.lookFirst')}>
        {leadsFor(t, has).map((x, i) => pill(x, i === 0))}
      </div>
    </div>
  );
}

/** Ask Sentinel's width beside the page: dragged by its left edge, kept on this Mac. */
const WIDTH = 'sentinel.ask.width';
const WIDTH_DEFAULT = 380;
const WIDTH_MIN = 320;
const WIDTH_STEP = 24;
const readWidth = (): number => {
  try {
    const w = Number(localStorage.getItem(WIDTH));
    return Number.isFinite(w) && w > 0 ? w : WIDTH_DEFAULT;
  } catch {
    return WIDTH_DEFAULT;
  }
};
/** At most 60% of the window (and 760 pt), so the page beside it keeps room. */
const fitWidth = (w: number, windowWidth: number): number => Math.round(Math.max(WIDTH_MIN, Math.min(w, Math.min(760, windowWidth * 0.6))));

/**
 * When the panel last went: going from Sentinel's page to a sentinel's (it docks again at once)
 * doesn't slide it in again; opening it after it was closed does.
 */
let closedAt = 0;
const REDOCK_MS = 600;

/**
 * The panel Ask Sentinel docks in, on Sentinel's page and a sentinel's own: its left edge resizes
 * it. Opened (you asked from the page's own box, or Ask Claude), it slides in from the right, the
 * page making room, and the conversation goes on there.
 */
export function AskPanel({ children }: { children: React.ReactNode }) {
  const t = useT();
  const panel = useRef<HTMLElement>(null);
  const [opening, setOpening] = useState(() => Date.now() - closedAt > REDOCK_MS);
  useEffect(() => () => void (closedAt = Date.now()), []);
  const windowWidth = useWindowWidth();
  const [width, setWidth] = useState(readWidth);
  const latest = useRef(width);
  const set = (w: number): void => {
    latest.current = w;
    setWidth(w);
  };
  const keep = (w: number = latest.current): void => {
    try {
      localStorage.setItem(WIDTH, String(fitWidth(w, window.innerWidth)));
    } catch {
      // Not kept: it still has this width now.
    }
  };
  return (
    <aside ref={panel} className={home.panel} data-opening={opening || undefined} onAnimationEnd={(e) => e.target === e.currentTarget && setOpening(false)} style={{ width: fitWidth(width, windowWidth) }} aria-label={t('sentinel.chat.askSentinel')}>
      <ResizeHandle
        axis="x"
        label={t('sentinel.chat.resize')}
        className={home.panelEdge}
        onMove={(x) => {
          const r = panel.current?.getBoundingClientRect();
          if (r) set(fitWidth(r.right - x, window.innerWidth));
        }}
        onEnd={() => keep()}
        onReset={() => {
          set(WIDTH_DEFAULT);
          keep(WIDTH_DEFAULT);
        }}
        onStep={(dir) => {
          const w = fitWidth(latest.current + dir * WIDTH_STEP, window.innerWidth);
          set(w);
          keep(w);
        }}
      />
      {/* Its own width while it slides in, so the chat doesn't squeeze and re-wrap on the way. */}
      <div className={home.panelInner} style={{ width: fitWidth(width, windowWidth) }}>
        {children}
      </div>
    </aside>
  );
}

export function SentinelChat({ onClose }: { onClose?: () => void }) {
  const t = useT();
  const view = useApp((st) => st.view);
  const channel = channelOf(view);
  // Opened beside a sentinel's own page: going between chats keeps that page.
  const about = view.kind === 'sentinel_chat' ? view.about : undefined;
  const here = about ? { about } : {};
  const id = sentinelChatOf(channel) ?? FIRST_SENTINEL_CHAT;
  const actions = useActions();
  const api = useApi();
  const a = useSentinelActions();
  const chats = useApp((st) => st.sentinel.chats?.chats ?? [], sameDeep);
  // The chats' names, from what you wrote first in each (picked as text, so streaming doesn't redraw the bar).
  const titles = useApp((st) => JSON.stringify(chats.map((c) => sentinelChatTitle(c.channel, st.log))));
  const names = useMemo(() => JSON.parse(titles) as string[], [titles]);
  const busy = useApp((st) => activityOf(st.log, channel).running);
  const has = useApp((st) => st.log.some((l) => l.channel === channel));
  const name = names[chats.findIndex((c) => c.id === id)] ?? t('sentinel.chat.newChatName');
  const projectNames = useApp((st) => st.projects.filter((p) => p.root && !p.error).map((p) => p.name).join('\n'));
  const hasSentinels = useApp((st) => st.sentinel.items.length > 0);
  const projects = useMemo(() => (projectNames ? projectNames.split('\n') : []), [projectNames]);
  const open = (chat: string): void => {
    void a.act(() => api.sentinel.chatOpen(chat));
    actions.run({ type: 'view', view: { kind: 'sentinel_chat', chat, ...here } });
  };
  const fresh = async (): Promise<void> => {
    const made = await a.act(() => api.sentinel.chatNew());
    if (made) actions.run({ type: 'view', view: { kind: 'sentinel_chat', chat: made.id, ...here } });
  };
  const more: ActionItem[] = [
    { label: t('sentinel.chat.newChat'), icon: 'plus', onSelect: () => void fresh() },
    { label: t('sentinel.chat.clear'), icon: 'x', hint: t('sentinel.chat.clearHint'), disabled: !has, separate: true, onSelect: () => void a.act(() => api.sentinel.chatClear(id), t('sentinel.chat.cleared')) },
    {
      label: t('sentinel.run.deleteChatMenu'),
      danger: true,
      onSelect: () =>
        openSheet({
          kind: 'confirm',
          title: t('sentinel.dash.deleteTitle', { name }),
          message: t('sentinel.chat.deleteMessage'),
          confirm: t('sentinel.chat.deleteChat'),
          destructive: true,
          run: () =>
            void a.act(() => api.sentinel.chatDelete(id), t('sentinel.chat.deleted')).then(() => {
              // The one now open (the next, or a fresh first one) is shown.
              actions.run({ type: 'view', view: { kind: 'sentinel_chat', ...here } });
            }),
        }),
    },
  ];
  return (
    <div className={s.chatTab} data-sentinel-chat={id}>
      <div className={s.chatBar}>
        {onClose ? (
          <span className={s.chatTitle}>
            <Icon name="claude" size={13} />
            <span className={s.chatTitleText}>{t('sentinel.chat.yourAgent')}</span>
          </span>
        ) : null}
        {/* Always the picker (with New Chat in it), so going between chats never hides behind ⋯. */}
        <PickMenu<string>
          label={t('sentinel.chat.chats')}
          choices={chats.map((c, i) => ({ value: c.id, label: names[i] ?? t('sentinel.chat.newChatName'), mark: <Icon name="chat" size={13} /> }))}
          chosen={[id]}
          onPick={open}
          actions={[{ label: t('sentinel.chat.newChat'), icon: 'plus', onSelect: () => void fresh() }]}
        >
          <button type="button" className={s.chatName} aria-label={t('sentinel.chat.chatAria', { name })}>
            {onClose ? null : <Icon name="chat" size={13} />}
            <span>{name}</span>
            <Icon name="chevronDown" size={10} />
          </button>
        </PickMenu>
        {busy ? <span className={s.chatBusy}>{t('sentinel.chat.working')}</span> : null}
        <span className={s.grow} />
        <Tip label={t('sentinel.chat.newTip')}>
          <IconButton icon="plus" label={t('sentinel.chat.newChat')} onClick={() => void fresh()} />
        </Tip>
        <ActionsDropdown items={more}>
          <IconButton icon="more" label={t('sentinel.chat.moreForChat')} />
        </ActionsDropdown>
        {onClose ? <IconButton icon="x" label={t('common.close')} onClick={onClose} /> : null}
      </div>
      <div className={v.chat} data-drop-zone>
        <ChatLog
          key={channel}
          channel={channel}
          empty={
            <Empty
              icon="claude"
              title={t('sentinel.chat.emptyTitle')}
              detail={t('sentinel.chat.emptyDetail')}
              action={<Starts projects={projects} has={hasSentinels} send={(prompt) => actions.submit(prompt)} />}
            />
          }
        />
        <Attention channel={channel} />
        <Composer />
      </div>
    </div>
  );
}
