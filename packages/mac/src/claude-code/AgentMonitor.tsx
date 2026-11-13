import { useEffect, useMemo, useState } from 'react';
import type { Workspace } from '@beluga/workspaces/types.js';
import { useNow } from '../chat/Items.js';
import { StepWords } from '../chat/steps/StepRow.js';
import { Icon } from '../components/Icon.js';
import { Button, Dot, Empty, Segmented, Tip, cx } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { usePrefs } from '../lib/prefs.js';
import { chordLabel } from '../lib/shortcuts-model.js';
import { RemoveWorktreeAlert, WorktreeInfoPage } from '../views/WorktreeInfo.js';
import { LiveTranscript } from './LiveTranscript.js';
import { AgentOutputs, useAgentOutputs } from './AgentOutputs.js';
import { BackgroundTasks } from './BackgroundTasks.js';
import { tasksForAgent } from './background-model.js';
import { agentElapsed, agentLabel, agentTone, tokens, typeLabel } from './cc-model.js';
import { type SubAgent, agentIdOfPath, agentOfWorktree, agentTitle, effortLabel, modelLabel, parentWorkspace, steerPrompt, steerable } from './subagents-model.js';
import s from './claude-code.module.css';
import m from './agent-monitor.module.css';
import o from './agent-outputs.module.css';
import { revealLabel } from '../lib/os-words.js';
import { showWorktreeFolder, useRevealLabel } from '../lib/remote-open.js';
import { useT } from '../lib/i18n.js';

/**
 * One sub-agent, followed live: what it was asked, who started it (and a way back there), its
 * model and effort, everything it does as it does it (thinking, tools, words), what it makes along
 * the way (Outputs: screenshots, test output, logs, wherever it puts them), and its own worktree's
 * Changes, Files and Scratch in the right panel when it has one. You don't talk to
 * a sub-agent: you tell the Claude that started it, which passes it on (SendMessage), so its
 * conversation stays the one story of the work.
 */

/** Tell the lead Claude something for this sub-agent (only when the lead is one of Beluga's conversations). */
function Steer({ sub, parent, leadName }: { sub: SubAgent; parent: Workspace | undefined; leadName?: string }) {
  const { client } = useBeluga();
  const prefs = usePrefs();
  const t = useT();
  const [text, setText] = useState('');
  const [sent, setSent] = useState<string>();
  const can = steerable(sub) && parent !== undefined;
  const lead = leadName ?? parent?.name ?? t('github.mon.theConversation');
  const send = (): void => {
    const body = text.trim();
    if (!body || !can || !parent) return;
    void client.api.session.submit(steerPrompt(sub.agent, body), { channel: `ws:${parent.id}` }).then(
      () => {
        setText('');
        setSent(t('github.mon.sentTo', { lead }));
      },
      () => setSent(t('github.mon.cantReach')),
    );
  };
  if (!can) {
    return (
      <div className={m.steerOff}>
        <Icon name="info" size={12} />
        {sub.session.own ? t('github.mon.gone') : t('github.mon.outside')}
      </div>
    );
  }
  return (
    <div className={m.steer}>
      <div className={m.steerBox}>
        <textarea
          className={`${m.steerInput} selectable`}
          rows={1}
          value={text}
          placeholder={t('github.mon.tellPlaceholder', { lead })}
          aria-label={t('github.mon.tellLabel', { lead })}
          onChange={(e) => {
            setText(e.target.value);
            setSent(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            const modKey = e.metaKey || e.ctrlKey;
            if (prefs.sendWith === 'enter' ? e.shiftKey || modKey : !modKey) return;
            e.preventDefault();
            send();
          }}
        />
        <Tip label={t('github.mon.passesOn', { lead })} keys={prefs.sendWith === 'enter' ? '↩' : chordLabel('Cmd+Enter')}>
          <Button size="small" variant={text.trim() ? 'primary' : 'plain'} icon="send" disabled={!text.trim()} onClick={send}>
            {t('github.mon.sendToMain')}
          </Button>
        </Tip>
      </div>
      <div className={m.steerHint}>{sent ?? t('github.mon.steerHint', { lead })}</div>
    </div>
  );
}

/** The live page of one sub-agent (with its worktree when it has one). */
export function AgentMonitor({ sub, worktree }: { sub: SubAgent; worktree?: Workspace }) {
  const { client } = useBeluga();
  const revealWords = useRevealLabel();
  const actions = useActions();
  const t = useT();
  const a = sub.agent;
  // Only Beluga's own conversations are a chat to go back to (a session outside Beluga isn't).
  const parent = useApp((st) => (sub.session.own ? parentWorkspace(st, sub) : undefined));
  const projectName = useApp((st) => st.projects.find((p) => p.id === sub.session.projectId)?.name);
  const parentAgent = a.parentAgentId ? sub.session.agents.find((x) => x.id === a.parentAgentId) : undefined;
  const now = useNow(a.status === 'running');
  const [removing, setRemoving] = useState(false);
  const [picked, setView] = useState<'activity' | 'outputs' | 'background'>('activity');
  const live = a.status === 'running';
  const outputs = useAgentOutputs(sub.session.id, a.id, live);
  const made = outputs?.outputs.length ?? 0;
  // Commands it runs in the background (a dev server, its tests): a third view, when it has any.
  const tasks = useMemo(() => tasksForAgent(sub.session, a.id), [sub.session, a.id]);
  const runningTasks = tasks.filter((x) => x.task.status === 'running').length;
  const view = picked === 'background' && !tasks.length ? 'activity' : picked;
  const version = `${a.lastAt}:${a.steps}:${a.status}`;
  const facts = [
    { label: typeLabel(a.type) },
    ...(modelLabel(a.model) ? [{ label: modelLabel(a.model)!, tip: a.model }] : []),
    ...(effortLabel(a.effort) ? [{ label: effortLabel(a.effort)! }] : []),
    { label: agentElapsed(a, now) },
    { label: t('github.cc.steps', { count: a.steps }) },
    ...(a.tokens ? [{ label: t('github.mon.context', { tokens: tokens(a.tokens) }) }] : []),
    ...(a.background ? [{ label: t('github.mon.background') }] : []),
  ];
  return (
    <div className={s.sessionPage} data-agent-monitor={a.id}>
      <header className={m.head}>
        <span className={cx(m.avatar, live && m.avatarLive)} aria-hidden="true">
          <Icon name="bot" size={20} />
        </span>
        <div className={m.titles}>
          <div className={m.kicker}>
            {t('github.mon.subAgent')}
            {parent ? (
              <>
                {t('github.mon.of')}
                <button type="button" className={m.parentLink} onClick={() => actions.run({ type: 'open_ws', id: parent.id })}>
                  {parent.kind === 'main' ? (projectName ?? parent.name) : parent.name}
                </button>
              </>
            ) : sub.session.own ? null : (
              <>
                {projectName ? t('github.mon.ofSessionIn', { title: sub.session.title, project: projectName }) : t('github.mon.ofSession', { title: sub.session.title })}
              </>
            )}
            {parentAgent ? t('github.mon.startedBy', { title: agentTitle(parentAgent) }) : null}
          </div>
          <h1 className={s.focusTitle}>{agentTitle(a)}</h1>
          <div className={m.facts}>
            <span className={cx(m.status, s[`tone_${agentTone(a)}`])}>
              {live ? <Dot tone="subagent" live /> : <Icon name={a.status === 'failed' ? 'x' : a.status === 'finished' ? 'check' : 'clock'} size={10} />}
              {agentLabel(a)}
            </span>
            {facts.map((f) => (
              <span key={f.label} className={m.fact} title={f.tip}>
                {f.label}
              </span>
            ))}
            {a.worktree ? (
              <span className={m.fact} title={a.worktree.path}>
                <Icon name="branch" size={10} /> {t('github.mon.ownWorktree')}
                {a.worktree.branch ? ` · ${a.worktree.branch}` : ''}
              </span>
            ) : null}
          </div>
          {live && a.step ? (
            <div className={m.now} title={a.step}>
              <StepWords words={a.step} />
            </div>
          ) : null}
        </div>
        <div className={m.headActions}>
          {parent ? (
            <Button size="small" icon="chat" onClick={() => actions.run({ type: 'open_ws', id: parent.id })}>
              {t('github.mon.openMainChat')}
            </Button>
          ) : null}
          {worktree ? (
            <Button size="small" icon="folder" onClick={() => void showWorktreeFolder(client, worktree.id)}>
              {revealWords}
            </Button>
          ) : null}
          {worktree && !live ? (
            <Button size="small" variant="danger" icon="archive" onClick={() => setRemoving(true)}>
              {t('github.mon.removeWorktree')}
            </Button>
          ) : null}
        </div>
      </header>
      <div className={o.tabs}>
        <Segmented
          label={t('github.mon.show')}
          value={view}
          onChange={setView}
          options={[
            { value: 'activity', label: t('github.cc.activity'), hint: t('github.mon.activityHint') },
            { value: 'outputs', label: made ? t('github.mon.outputsCount', { count: made }) : t('github.mon.outputs'), hint: t('github.mon.outputsHint') },
            ...(tasks.length ? [{ value: 'background' as const, label: t('github.mon.backgroundCount', { count: runningTasks ? t('github.cc.countRunning', { count: runningTasks }) : tasks.length }), hint: t('github.mon.backgroundHint') }] : []),
          ]}
        />
      </div>
      {view === 'activity' ? (
        <LiveTranscript key={`${sub.session.id}/${a.id}`} sessionId={sub.session.id} agentId={a.id} version={version} live={live} label={t('github.mon.subAgentLabel', { title: agentTitle(a) })} />
      ) : view === 'background' ? (
        <BackgroundTasks items={tasks} layout="split" empty={t('github.mon.nothingBackground')} />
      ) : (
        <AgentOutputs key={`${sub.session.id}/${a.id}`} sessionId={sub.session.id} agentId={a.id} list={outputs} {...(sub.session.cwd ? { cwd: sub.session.cwd } : {})} />
      )}
      <Steer sub={sub} parent={parent} {...(parent ? { leadName: parent.kind === 'main' ? (projectName ?? parent.name) : parent.name } : {})} />
      {removing && worktree ? <RemoveWorktreeAlert ws={worktree} onDone={() => setRemoving(false)} onCancel={() => setRemoving(false)} /> : null}
    </div>
  );
}

/**
 * A sub-agent's own worktree, opened from the sidebar: the agent, live. If Claude Code no longer
 * has that agent (long gone), what the worktree is, without offering to start a conversation in it.
 */
export function AgentWorktreePage({ ws }: { ws: Workspace }) {
  const { client } = useBeluga();
  const sessions = useApp((st) => st.claudeCode.sessions);
  const origin = useApp((st) => st.claudeCode.origins.find((o) => o.path === ws.path));
  const sub = useMemo(() => agentOfWorktree(sessions, ws), [sessions, ws]);
  const [looked, setLooked] = useState(false);
  const t = useT();
  const id = agentIdOfPath(ws.path);
  // Not watched now (finished a while ago): ask Beluga to find it, so it can be followed again.
  useEffect(() => {
    if (sub || !id) return void setLooked(true);
    let alive = true;
    client.api.claudeCode.findAgent(id).then(
      () => alive && setTimeout(() => alive && setLooked(true), 600),
      () => alive && setLooked(true),
    );
    return () => {
      alive = false;
    };
  }, [id, Boolean(sub)]);
  if (sub) return <AgentMonitor sub={sub} worktree={ws} />;
  if (!looked) return <Empty icon="bot" title={t('github.mon.finding')} detail={t('github.mon.findingDetail')} />;

  return <WorktreeInfoPage ws={ws} agent {...(origin ? { origin } : {})} />;
}
