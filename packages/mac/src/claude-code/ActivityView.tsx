import { useMemo } from 'react';
import { type CcSession, outsideSessions, sessionApp } from '@beluga/core/claude-code/model.js';
import { useNow } from '../chat/Items.js';
import { Icon } from '../components/Icon.js';
import { ProjectIcon } from '../components/ProjectIcon.js';
import { Button, Dot, Empty } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { AgentCard, SessionChip } from './Cards.js';
import { chatOf } from './chat-of.js';
import { LiveTranscript } from './LiveTranscript.js';
import { AgentMonitor } from './AgentMonitor.js';
import { openSubAgent } from '../layout/SubAgents.js';
import { TeamBlock, teamMembers } from './Team.js';
import { activitySummary, groupByProject, openActivity, placeLabel, sessionLabel } from './cc-model.js';
import s from './claude-code.module.css';
import { t as tr } from '@beluga/shared/i18n/index.js';
import { useT } from '../lib/i18n.js';

/**
 * Activity: every Claude Code session running outside Beluga (a terminal, another app), by project,
 * with its sub-agents as cards. Everything opens where it lives: a session the chat of its folder
 * (with the session live in a strip at the top), an agent its worktree's chat or its own page. Only
 * a session in a folder Beluga doesn't know opens as a live transcript.
 */

export const OUTSIDE = (): string => tr('github.cc.outside');

/** Open where a session lives (its folder's chat, else its transcript here), or one of its agents (openSubAgent). */
function useOpenSession(session: CcSession): (agentId?: string) => void {
  const { client } = useBeluga();
  const actions = useActions();
  const chat = useApp((st) => chatOf(st, session));
  return (agentId) => {
    const agent = agentId ? session.agents.find((a) => a.id === agentId) : undefined;
    if (agent) openSubAgent(client, actions, { session, agent });
    else if (chat) actions.run({ type: 'open_ws', id: chat });
    else openActivity(client, session.id);
  };
}

function SessionRow({ session }: { session: CcSession }) {
  const open = useOpenSession(session);
  const chat = useApp((st) => chatOf(st, session));
  const place = useApp((st) => placeLabel(st, session));
  const t = useT();
  const now = useNow(session.status === 'working', 5000);
  const st = sessionLabel(session, now);
  const running = session.agents.filter((a) => a.status === 'running').length;
  const team = new Set(teamMembers(session).map((a) => a.id));
  const others = session.agents.filter((a) => !team.has(a.id));
  return (
    <section className={s.session} aria-label={t('github.cc.sessionLabel', { app: sessionApp(session), title: session.title })}>
      <button type="button" className={s.sessionHead} onClick={() => open()}>
        <span className={s.sessionDot}>{st.tone === 'claude' ? <Dot tone="claude" live /> : <Dot tone={st.tone === 'ok' ? 'ok' : 'muted'} />}</span>
        <span className={s.sessionText}>
          <span className={s.sessionTitle}>{session.title}</span>
          <span className={s.sessionMeta}>
            <span className={s[`tone_${st.tone}`]}>{st.label}</span>
            <span>{place}</span>
            {session.agent ? <span>{sessionApp(session)}</span> : null}
            {session.agents.length ? <span>{running ? t('github.cc.ofAgentsRunning', { running, agents: t('github.cc.agents', { count: session.agents.length }) }) : t('github.cc.agents', { count: session.agents.length })}</span> : null}
          </span>
        </span>
        <span className={s.sessionOpen}>
          {chat ? t('github.cc.openChat') : t('github.cc.open')}
          <Icon name="chevronRight" size={10} />
        </span>
      </button>
      {/* Agents working as a team (named, messaging each other) under one header, with their messages. */}
      <TeamBlock session={session} onOpen={(id) => open(id)} />
      {others.length ? (
        <div className={s.grid}>
          {others.map((a) => (
            <AgentCard key={a.id} agent={a} onOpen={() => open(a.id)} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ActivityList() {
  const raw = useApp((st) => st.claudeCode.sessions);
  const sessions = useMemo(() => outsideSessions(raw), [raw]);
  const projects = useApp((st) => st.projects);
  const t = useT();
  // Selectors must return what's in the state (a fresh array each time would render forever).
  const groups = useMemo(() => groupByProject({ projects }, sessions), [projects, sessions]);
  if (!sessions.length) {
    return (
      <div className={s.page}>
        <Empty icon="claude" title={t('github.cc.noSessions')} detail={t('github.cc.noSessionsDetail')} />
      </div>
    );
  }
  return (
    <div className={s.page}>
      <div className={s.inner}>
        <header className={s.summary}>
          <h1 className={s.summaryTitle}>{activitySummary(sessions)}</h1>
          <p className={s.summaryText}>{t('github.cc.summaryText')}</p>
        </header>
        {groups.map((g) => (
          <section key={g.key} className={s.group} aria-label={g.name}>
            <h2 className={s.groupTitle}>
              {g.projectId ? <ProjectIcon id={g.projectId} name={g.name} size={18} /> : <Icon name="folder" size={16} />}
              <span>{g.name}</span>
              <span className={s.groupCount}>{g.running ? t('github.cc.countRunning', { count: g.running }) : t('github.cc.sessions', { count: g.sessions.length })}</span>
            </h2>
            {g.sessions.map((x) => (
              <SessionRow key={x.id} session={x} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * One session's transcript (the chat's live strip opens it; Activity does for a session in a folder
 * Beluga doesn't know), titled by its folder, with its agents in a row. An agent that went quiet
 * lands here too.
 */
export function SessionPage({ session, agentId }: { session: CcSession; agentId?: string }) {
  const { client } = useBeluga();
  const open = useOpenSession(session);
  const actions = useActions();
  const t = useT();
  const chat = useApp((st) => chatOf(st, session));
  const place = useApp((st) => placeLabel(st, session));
  const now = useNow(session.status === 'working', 5000);
  const st = sessionLabel(session, now);
  return (
    <div className={s.sessionPage}>
      <header className={s.focusHead}>
        <Button size="small" variant="quiet" icon="back" onClick={() => openActivity(client)}>
          {t('github.cc.activity')}
        </Button>
        <div className={s.focusTitles}>
          <h1 className={s.focusTitle}>{place}</h1>
          <div className={s.focusMeta}>
            <span className={s[`tone_${st.tone}`]}>{st.label}</span>
            <span>{session.title}</span>
            {session.model ? <span>{session.model}</span> : null}
          </div>
        </div>
        {chat ? (
          <Button size="small" icon="chat" onClick={() => actions.run({ type: 'open_ws', id: chat })}>
            {t('github.cc.openChat')}
          </Button>
        ) : (
          <span className={s.readOnly} title={t('github.cc.readOnly')}>
            <Icon name="eye" size={12} />
            {session.agent ? t('github.cc.outsideIn', { app: sessionApp(session) }) : OUTSIDE()}
          </span>
        )}
      </header>
      {session.agents.length ? (
        <div className={s.strip} role="group" aria-label={t('github.cc.agentsInSession')}>
          <SessionChip session={session} selected={!agentId} onOpen={() => openActivity(client, session.id)} />
          {session.agents.map((a) => (
            <AgentCard key={a.id} agent={a} compact onOpen={() => open(a.id)} />
          ))}
        </div>
      ) : null}
      {agentId ? (
        <Empty icon="clock" title={t('github.cc.agentQuiet')} detail={t('github.cc.agentQuietDetail')} action={<Button onClick={() => openActivity(client, session.id)}>{t('github.cc.showConversation')}</Button>} />
      ) : session.agent === 'codex' ? (
        <Empty icon="eye" title={session.step ?? t('github.cc.workingInCodex')} detail={t('github.cc.codexDetail')} />
      ) : (
        <LiveTranscript key={session.id} sessionId={session.id} version={`${session.lastAt}:${session.steps}:${session.status}`} live={session.status === 'working'} label={t('github.cc.ccSession', { title: session.title })} />
      )}
    </div>
  );
}

export function ActivityView() {
  const { client } = useBeluga();
  const view = useApp((st) => st.view);
  const t = useT();
  const sessionId = view.kind === 'claude_code' ? view.session : undefined;
  const agentId = view.kind === 'claude_code' ? view.agent : undefined;
  const session = useApp((st) => (sessionId ? st.claudeCode.sessions.find((x) => x.id === sessionId) : undefined));
  if (!sessionId) return <ActivityList />;
  if (!session) {
    return (
      <div className={s.page}>
        <Empty icon="clock" title={t('github.cc.sessionQuiet')} detail={t('github.cc.sessionQuietDetail')} action={<Button onClick={() => openActivity(client)}>{t('github.cc.showAllActivity')}</Button>} />

      </div>
    );
  }
  // A sub-agent: followed on its own page (gone quiet: the session's page says so).
  const agent = agentId ? session.agents.find((a) => a.id === agentId) : undefined;
  if (agent) return <AgentMonitor sub={{ session, agent }} />;
  return <SessionPage session={session} {...(agentId ? { agentId } : {})} />;
}
