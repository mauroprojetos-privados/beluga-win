import { useMemo } from 'react';
import { type CcSession, outsideSessions, runningAgents, sessionsIn } from '@beluga/core/claude-code/model.js';
import { useNow } from '../chat/Items.js';
import { Icon } from '../components/Icon.js';
import { Badge, Button, Dot, cx } from '../components/ui.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { Row } from '../layout/sidebar-parts.js';
import { AgentCard } from './Cards.js';
import { agentLabel, agentTone, openActivity, placeLabel, sessionLabel, tokens } from './cc-model.js';
import { cappedAgents, inStartOrder } from './subagents-model.js';
import i from '../layout/Inspector.module.css';
import s from './claude-code.module.css';
import { useT } from '../lib/i18n.js';

/**
 * Where Claude Code's live sessions show outside Activity: a strip above a workspace's chat, a
 * panel on a worktree's info page, the Inspector, and the sidebar's Activity row.
 */

/** The Claude Code sessions in one workspace (selected without making a new array each time). */
export function useSessionsIn(workspaceId: string | undefined): CcSession[] {
  const all = useApp((st) => st.claudeCode.sessions);
  return useMemo(() => (workspaceId ? sessionsIn(outsideSessions(all), workspaceId) : []), [all, workspaceId]);
}

const MAX_PILLS = 3;

/** A slim bar above a workspace's chat: Claude Code is working here (outside Beluga), and its agents. */
export function LiveStrip({ workspaceId }: { workspaceId: string }) {
  const { client } = useBeluga();
  const sessions = useSessionsIn(workspaceId);
  const t = useT();
  const session = sessions[0];
  const now = useNow(Boolean(session && session.status === 'working'), 5000);
  if (!session) return null;
  const st = sessionLabel(session, now);
  // In the order they started, the newest few as pills: an agent finishing never moves or hides one (BLG-21).
  const agents = inStartOrder(session.agents);
  const running = agents.filter((a) => a.status === 'running').length;
  const { shown, hidden } = cappedAgents(agents, MAX_PILLS);
  return (
    <div className={s.liveStrip} role="region" aria-label={t('github.live.inFolder')}>
      <button type="button" className={s.liveLead} onClick={() => openActivity(client, session.id)} title={`${session.title} · ${st.label}`}>
        {st.tone === 'claude' ? <Dot tone="claude" live /> : <Dot tone={st.tone === 'ok' ? 'ok' : 'muted'} />}
        {/* i18n-ignore */}
        <span className={s.liveName}>Claude Code</span>
        <span className={s.liveTitle}>{session.title}</span>
        <span className={cx(s.liveState, s[`tone_${st.tone}`])}>{running ? t('github.cc.countRunning', { count: running }) : st.label}</span>
      </button>
      {shown.map((a) => (
        <button key={a.id} type="button" className={s.pill} onClick={() => openActivity(client, session.id, a.id)} title={`${a.description} · ${agentLabel(a)}${a.step ? ` · ${a.step}` : ''}`}>
          <span className={s.pillMark}>{a.status === 'running' ? <Dot tone="subagent" live /> : <Icon name={a.status === 'failed' ? 'x' : 'check'} size={10} className={s[`tone_${agentTone(a)}`]} />}</span>
          <span className={s.pillText}>{a.description}</span>
        </button>
      ))}
      {hidden ? (
        // Always the same place: this session in Activity, with every one of its agents.
        <button type="button" className={cx(s.pill, s.pillMore)} onClick={() => openActivity(client, session.id)} title={t('github.live.earlier', { count: hidden, all: agents.length })} aria-label={t('github.live.showAll', { all: agents.length })}>
          +{hidden}
        </button>
      ) : null}
      {sessions.length > 1 ? (
        <button type="button" className={cx(s.pill, s.pillMore)} onClick={() => openActivity(client)}>
          {t('github.live.moreSessions', { count: sessions.length - 1 })}
        </button>
      ) : null}
    </div>
  );
}

/** A worktree's info page: what's running in it right now, with a way to open it. */
export function LivePanel({ workspaceId }: { workspaceId: string }) {
  const { client } = useBeluga();
  const sessions = useSessionsIn(workspaceId);
  const t = useT();
  const now = useNow(sessions.some((x) => x.status === 'working'), 5000);
  if (!sessions.length) return null;
  return (
    <section className={s.livePanel} aria-label={t('github.live.liveIn')}>
      {sessions.map((x) => {
        const st = sessionLabel(x, now);
        return (
          <div key={x.id} className={s.livePanelSession}>
            <div className={s.livePanelHead}>
              {st.tone === 'claude' ? <Dot tone="claude" live /> : <Dot tone={st.tone === 'ok' ? 'ok' : 'muted'} />}
              <span className={s.livePanelTitle}>
                <span className={s.livePanelKicker}>{t('github.live.liveIn')}</span>
                <span className={s.sessionTitle}>{x.title}</span>
              </span>
              <span className={cx(s.liveState, s[`tone_${st.tone}`])}>{st.label}</span>
              <Button size="small" variant="primary" icon="chevronRight" onClick={() => openActivity(client, x.id)}>
                {t('github.cc.open')}
              </Button>
            </div>
            {x.step ? <div className={s.livePanelStep}>{x.step}</div> : null}
            {x.agents.length ? (
              <div className={s.grid}>
                {x.agents.map((a) => (
                  <AgentCard key={a.id} agent={a} onOpen={() => openActivity(client, x.id, a.id)} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function SessionDetails({ session }: { session: CcSession }) {
  const { client } = useBeluga();
  const place = useApp((st) => placeLabel(st, session));
  const t = useT();
  const now = useNow(session.status === 'working', 5000);
  const st = sessionLabel(session, now);
  return (
    <div className={s.inspectorSession}>
      <button type="button" className={s.inspectorHead} onClick={() => openActivity(client, session.id)}>
        {st.tone === 'claude' ? <Dot tone="claude" live /> : <Dot tone={st.tone === 'ok' ? 'ok' : 'muted'} />}
        <span className={s.inspectorTitle}>{session.title}</span>
        <Icon name="chevronRight" size={10} />
      </button>
      <div className={i.field}>
        <span className={i.fieldLabel}>{t('github.live.state')}</span>
        <span className={cx(i.fieldValue, s[`tone_${st.tone}`])}>{st.label}</span>
      </div>
      <div className={i.field}>
        <span className={i.fieldLabel}>{t('github.live.folder')}</span>
        <span className={i.fieldValue}>{place}</span>
      </div>
      {session.model ? (
        <div className={i.field}>
          <span className={i.fieldLabel}>{t('github.live.model')}</span>
          <span className={i.fieldValue}>{session.model}</span>
        </div>
      ) : null}
      {session.tokens ? (
        <div className={i.field}>
          <span className={i.fieldLabel}>{t('github.live.context')}</span>
          <span className={cx(i.fieldValue, s.num)}>{t('github.live.tokens', { count: tokens(session.tokens) })}</span>
        </div>
      ) : null}
      {session.agents.map((a) => (
        <button key={a.id} type="button" className={s.inspectorAgent} onClick={() => openActivity(client, session.id, a.id)} title={a.step ?? ''}>
          {a.status === 'running' ? <Dot tone="subagent" live /> : <Icon name={a.status === 'failed' ? 'x' : a.status === 'finished' ? 'check' : 'clock'} size={10} className={s[`tone_${agentTone(a)}`]} />}
          <span className={s.inspectorAgentText}>{a.description}</span>
          <span className={s.num}>{t('github.cc.steps', { count: a.steps })}</span>
        </button>
      ))}
    </div>
  );
}

/** The Inspector's Claude Code panel: for the workspace you're in, or the session you're watching. */
export function ClaudeCodeInspector() {
  const view = useApp((st) => st.view);
  const raw = useApp((st) => st.claudeCode.sessions);
  const sessions = useMemo(() => {
    const all = outsideSessions(raw);
    return view.kind === 'workspace' ? sessionsIn(all, view.id) : view.kind === 'claude_code' && view.session ? all.filter((x) => x.id === view.session) : [];
  }, [raw, view]);
  if (!sessions.length) return null;
  return (
    <section className={i.panel}>
      <div className={i.panelHead}>
        {/* i18n-ignore */}
        <h3>Claude Code</h3>
      </div>
      {sessions.map((x) => (
        <SessionDetails key={x.id} session={x} />
      ))}
    </section>
  );
}

/** The sidebar's Activity row: how many agents are running outside Beluga right now. */
/** `whenLive`: only while a session runs outside Beluga (or you're looking at Activity). */
export function ActivityRow({ whenLive }: { whenLive?: boolean } = {}) {
  const { client } = useBeluga();
  const running = useApp((st) => runningAgents(outsideSessions(st.claudeCode.sessions)));
  const live = useApp((st) => outsideSessions(st.claudeCode.sessions).length > 0);
  const selected = useApp((st) => st.view.kind === 'claude_code');
  const t = useT();
  if (whenLive && !live && !selected) return null;
  return (
    <Row
      icon={<Icon name="pulse" size={14} />}
      label={t('github.cc.activity')}
      detail={running ? t('github.live.rowRunning', { count: running }) : t('github.live.rowDetail')}

      selected={selected}
      onClick={() => openActivity(client)}
      trailing={running ? <Badge count={running} /> : live ? <Dot tone="muted" /> : null}
    />
  );
}
