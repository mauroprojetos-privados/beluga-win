import { dirName } from '@beluga/shared/os-path.js';
import { useState } from 'react';
import { CAP_INFO, EXPIRY_INFO, type Expiry, type RequestFacts, capFor, ruleFor, ruleKindOf, ruleLabel, scopeChoices } from '@beluga/core/gateway/access.js';
import { type TaskView, isFinal, oneLine, stateLabel, stateTone } from '@beluga/core/gateway/model.js';
import { TRUST_INFO } from '@beluga/core/trust.js';
import { Icon } from '../components/Icon.js';
import { Avatar, Button, Dot } from '../components/ui.js';
import { Choice, Sheet } from '../dialogs/native/parts.js';
import { useApi, useApp, useBeluga } from '../lib/beluga.js';
import { backLine, whereLine } from './popup-model.js';
import { closeRequest, useRequestSheet } from './request-native.js';
import { TaskStep } from './TaskStep.js';
import { openFriendCard } from '../network/use-net.js';
import s from './access.module.css';
import { yourComputer } from '../lib/os-words.js';
import { useT } from '../lib/i18n.js';

/**
 * A friend's request, in full: who, what, what it needs, where it would run, what comes back.
 * Approve once, Always (the rule it writes spelled out: this project or any, never / a day / a
 * week), or Decline with an optional reason; or trust them instead. Once it runs, its steps and
 * Stop. Opened from a notification, the menu bar, the task's card or Requests.
 */

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** What's known about the request on this side, to show the rule "Always" would write. */
export function factsOf(task: TaskView): RequestFacts {
  return {
    peerId: task.peerId,
    kind: ruleKindOf(task.kind),
    needs: task.needs,
    ...(task.project ? { project: task.project } : {}),
    ...(task.command ? { command: task.command } : {}),
    ...(task.folder ? { folder: task.folder } : task.kind === 'file' && task.path ? { folder: dirName(task.path) || '/' } : task.cwd ? { folder: task.cwd } : {}),
  };
}


type Mode = 'choose' | 'always' | 'decline';

function Body({ task }: { task: TaskView }) {
  const api = useApi();
  const { client } = useBeluga();
  const t = useT();
  const level = useApp((st) => st.levels[task.peerId] ?? st.remembered[task.peerId]?.trust ?? (st.policy === 'deny' ? 'blocked' : st.policy === 'auto' ? 'trusted' : 'ask'));
  const caps = useApp((st) => st.gateway.capabilities);
  const friend = useApp((st) => st.network.friends.some((f) => f.peerId === task.peerId));
  const [mode, setMode] = useState<Mode>('choose');
  const [scope, setScope] = useState<'this' | 'any'>('this');
  const [command, setCommand] = useState<'this' | 'any'>('this');
  const [expiry, setExpiry] = useState<Expiry>('never');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const waiting = task.state === 'awaiting_approval';
  const facts = factsOf(task);
  const scopes = scopeChoices(facts);
  const preview = ruleFor(facts, task.peerName, { scope, command, expiry }, Date.now(), 'r_preview00');
  const who = task.by === 'agent' ? t('github.req.theirAgent', { name: task.peerName }) : task.peerName;
  const answer = async (decision: Parameters<typeof api.gateway.decide>[1]): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await api.gateway.decide(task.id, decision);
      setMode('choose');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  const trust = async (): Promise<void> => {
    try {
      await api.people.setTrust(task.peerId, 'trusted');
      if (waiting) await api.gateway.decide(task.id, { answer: 'yes', scope: 'this', command: 'this', expiry: 'never' });
    } catch (err) {
      client.store.dispatch({ type: 'toast', text: `${t('github.sheet.cantChange')}: ${message(err)}`, level: 'error' });
    }
  };
  const footer = !waiting ? (
    <>
      {!isFinal(task.state) ? (
        <Button variant="quiet" icon="stop" onClick={() => void api.gateway.cancel(task.id)}>
          {t('common.stop')}
        </Button>
      ) : null}
      <span className={s.grow} />
      <Button variant="primary" onClick={closeRequest}>
        {t('common.done')}
      </Button>
    </>
  ) : mode === 'always' ? (
    <>
      <span className={s.footNote}>{error ?? t('github.sheet.changeInSettings')}</span>
      <Button onClick={() => setMode('choose')}>{t('common.back')}</Button>
      <Button variant="primary" disabled={busy} onClick={() => void answer({ answer: 'always', scope, command, expiry })}>
        {t('github.sheet.alwaysAllow')}
      </Button>
    </>
  ) : mode === 'decline' ? (
    <>
      <span className={s.footNote}>{error ?? t('github.sheet.seesReason', { name: task.peerName })}</span>
      <Button onClick={() => setMode('choose')}>{t('common.back')}</Button>
      <Button variant="danger" disabled={busy} onClick={() => void answer({ answer: 'no', scope: 'this', command: 'this', expiry: 'never', ...(reason.trim() ? { reason: reason.trim() } : {}) })}>
        {t('github.task.decline')}
      </Button>
    </>
  ) : (
    <>
      {error ? <span className={s.footNote} style={{ color: 'var(--error)' }}>{error}</span> : <span className={s.grow} />}
      <Button onClick={() => setMode('decline')}>{t('github.sheet.declineDots')}</Button>
      {/* A secret is asked about each time: trust, rules and Always never cover it. */}
      {task.secret ? null : <Button onClick={() => setMode('always')}>{t('github.sheet.alwaysDots')}</Button>}
      <Button variant="primary" disabled={busy} onClick={() => void answer({ answer: 'yes', scope: 'this', command: 'this', expiry: 'never' })}>
        {task.secret ? t('github.task.allowOnce') : t('github.sheet.approveOnce')}
      </Button>
    </>
  );
  return (
    <Sheet
      title={task.secret ? t('github.sheet.wantsSecret', { who, secret: task.secret.label }) : task.kind === 'run' ? t('github.sheet.wantsRun', { who, computer: yourComputer() }) : task.kind === 'file' ? t('github.sheet.wantsFile', { who, computer: yourComputer() }) : t('github.sheet.wantsAgent', { who })}
      subtitle={waiting && task.secret ? t('github.sheet.secretSubtitle') : waiting ? (task.by === 'agent' ? t('github.sheet.askedTheirAgent', { name: task.peerName }) : t('github.sheet.asksDirectly', { name: task.peerName })) : stateLabel(task)}
      badge={<Avatar name={task.peerName} id={task.peerId} claude={task.by === 'agent'} size={32} />}
      close={closeRequest}
      footer={footer}
      wide
    >
      {task.kind === 'run' ? <div className={`${s.command} selectable`}>$ {task.command}</div> : <div className={`${s.ask} selectable`}>{task.kind === 'file' ? t('github.sheet.sendMe', { path: task.path ?? '' }) : task.ask}</div>}
      {task.kind === 'run' && task.ask !== task.command ? <div className={s.preview} style={{ marginTop: 6 }}>{t('github.sheet.why', { text: oneLine(task.ask, 300) })}</div> : null}
      <div className={s.facts} role="list" aria-label={t('github.sheet.about')}>
        <span className={s.factLabel}>{t('github.sheet.from')}</span>
        <span className={s.factValue} role="listitem">
          {t('github.sheet.fromYou', { name: task.peerName, trust: TRUST_INFO[level].label.toLowerCase() })}
          {level !== 'trusted' && level !== 'full' && !task.secret ? (
            <button type="button" className={s.linkButton} onClick={() => void trust()}>
              {t('github.sheet.trustInstead', { name: task.peerName })}
            </button>
          ) : null}
          {/* Trust is set on their card (BLG-202); "Trust them instead" stays as this request's shortcut. */}
          {friend ? (
            <button
              type="button"
              className={s.linkButton}
              onClick={() => {
                closeRequest();
                openFriendCard(client, task.peerId);
              }}
            >
              {t('github.sheet.theirCard')}
            </button>
          ) : null}
        </span>
        <span className={s.factLabel}>{t('github.sheet.needs')}</span>
        <span className={s.factValue} role="listitem">
          {task.needs.length || task.kind !== 'ask' ? (
            <span className={s.chips}>
              {[...new Set(task.kind === 'run' ? ['shell' as const, ...task.needs] : task.kind === 'file' ? ['files' as const] : task.needs)].map((n) => (
                <span key={n} className={`${s.chip} ${capFor(caps, n, level) === 'ask' ? s.chipAsk : ''}`} title={CAP_INFO[n].detail}>
                  {CAP_INFO[n].label}
                </span>
              ))}
            </span>
          ) : (
            t('github.sheet.nothingSpecial')
          )}
        </span>
        <span className={s.factLabel}>{t('github.sheet.where')}</span>
        <span className={s.factValue} role="listitem">
          {whereLine(task)}
        </span>
        <span className={s.factLabel}>{t('github.sheet.sendsBack')}</span>
        <span className={s.factValue} role="listitem">
          {backLine(task)}
          {task.deadline ? t('github.sheet.by', { time: new Date(task.deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }) : ''}
        </span>
      </div>
      {waiting && mode === 'always' ? (
        <div className={s.options} role="group" aria-label={t('github.sheet.alwaysAllowGroup')}>
          {scopes ? (
            <div className={s.optionRow}>
              <span className={s.optionLabel}>{t('github.sheet.where')}</span>
              <Choice<'this' | 'any'>
                label={t('github.sheet.where')}
                value={scope}
                onChange={setScope}
                // Any command anywhere would be full trust for commands: not from here.
                options={command === 'any' ? [{ value: 'this', label: scopes.this }] : [{ value: 'this', label: scopes.this }, { value: 'any', label: scopes.any }]}
              />
            </div>
          ) : null}
          {task.kind === 'run' ? (
            <div className={s.optionRow}>
              <span className={s.optionLabel}>{t('github.sheet.command')}</span>
              <Choice<'this' | 'any'>
                label={t('github.sheet.command')}
                value={command}
                onChange={(v) => {
                  setCommand(v);
                  if (v === 'any') setScope('this');
                }}
                options={[{ value: 'this', label: t('github.sheet.thisCommand') }, { value: 'any', label: t('github.sheet.anyCommand') }]} />
            </div>
          ) : null}
          <div className={s.optionRow}>
            <span className={s.optionLabel}>{t('github.sheet.howLong')}</span>
            <Choice<Expiry> label={t('github.sheet.howLong')} value={expiry} onChange={setExpiry} options={(['never', 'day', 'week'] as const).map((e) => ({ value: e, label: e === 'never' ? t('github.sheet.untilIChange') : EXPIRY_INFO[e] }))} />
          </div>
          <div className={s.preview} aria-label={t('github.sheet.rule')}>
            {t('github.sheet.ruleLead', { name: task.peerName, expiry: expiry === 'never' ? '' : ` (${EXPIRY_INFO[expiry].toLowerCase()})` })}: <strong>{ruleLabel(preview)}</strong>.
          </div>
        </div>
      ) : null}
      {waiting && mode === 'decline' ? <textarea className={s.reason} aria-label={t('github.sheet.reason')} placeholder={t('github.sheet.reasonPlaceholder', { name: task.peerName })} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} autoFocus /> : null}
      {!waiting ? (
        <div className={s.live} aria-label={t('github.sheet.progress')}>

          <div className={s.liveHead}>
            <Dot tone={stateTone(task) === 'claude' ? 'claude' : stateTone(task) === 'ok' ? 'ok' : stateTone(task) === 'warn' ? 'warn' : stateTone(task) === 'error' ? 'error' : 'muted'} live={!isFinal(task.state)} />
            {stateLabel(task)}
            {task.allowedBy ? ` · ${task.allowedBy}` : ''}
          </div>
          {task.steps.length ? (
            <div className={s.steps}>
              {task.steps.slice(-6).map((step, i) => (
                <TaskStep key={i} line={step} className={s.step} />
              ))}
            </div>
          ) : null}
          {task.result && isFinal(task.state) ? <div className={s.preview} style={{ marginTop: 6 }}>{oneLine(task.result.summary, 280)}</div> : null}
        </div>
      ) : null}
    </Sheet>
  );
}

/** The request sheet, when one is open (see request-native.ts). */
export function RequestSheet() {
  const id = useRequestSheet();
  const task = useApp((st) => (id ? st.gateway.tasks.find((t) => t.id === id && t.direction === 'received') : undefined));
  if (!id || !task) return null;
  return <Body task={task} />;
}
