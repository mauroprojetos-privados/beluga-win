import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { channelOf } from '@beluga/core/store.js';
import { currentQuestion } from '@beluga/ui/collab-actions.js';
import { isDecisionQid } from '@beluga/core/plans/decisions.js';
import { TRUST_INFO } from '@beluga/core/trust.js';
import { defaultAgentOf } from '@beluga/protocol.js';
import { Icon } from '../components/Icon.js';
import { Button, Dot, Tip, cx } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { useApi, useApp, useBeluga, useUi } from '../lib/beluga.js';
import { agentName } from '../lib/agent-words.js';
import { brandText } from '../lib/brand.js';
import { sameDeep, sameFields } from '../lib/stable.js';
import { hostToBefriend } from '../network/net-model.js';
import { befriend } from '../network/use-net.js';
import { Markdown } from './Markdown.js';
import { useNow } from './Items.js';
import s from './attention.module.css';
import { useT } from '../lib/i18n.js';

/**
 * What needs you right now, just above the box you type in: an approval, Claude's question or
 * plan, someone at the door, a new person to choose a trust level for.
 */
export function Attention({ channel }: { channel?: string } = {}) {
  // People at the door and new people to trust belong to the room; approvals reach you anywhere.
  const inRoom = useApp((st) => st.view.kind === 'room');
  return (
    <div className={s.stack}>
      <Approvals {...(channel ? { channel } : {})} />
      <Question {...(channel ? { channel } : {})} />
      {inRoom ? <Knock /> : null}
      {inRoom ? <BefriendHost /> : null}
      {inRoom ? <TrustPrompt /> : null}
    </div>
  );
}

/**
 * `channel`: in a friends' chat (BLG-207), only what holds up your Claude there; a friend's request
 * is answered on its card in the chat instead.
 */
function Approvals({ channel }: { channel?: string }) {
  const t = useT();
  const api = useApi();
  const all = useApp((st) => st.approvals);
  const approvals = useMemo(() => (channel ? all.filter((a) => a.channel === channel && !a.task) : all), [all, channel]);
  const first = approvals[0];
  const now = useNow(Boolean(first?.askedAt));
  const [showAll, setShowAll] = useState(false);
  if (!first) return null;
  const others = approvals.slice(1);
  const left = first.askedAt && first.timeoutMs ? Math.max(0, first.askedAt + first.timeoutMs - now) : undefined;
  return (
    <div className={`${s.card} ${s.urgent}`} role="alertdialog" aria-label={t('sidebar.attention.approvalNeeded')}>
      <div className={s.head}>
        <Dot tone="warn" />
        <span className={s.title}>{brandText(first.title)}</span>
        {others.length ? (
          <button type="button" className={s.moreButton} aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
            {showAll ? t('sidebar.showLess') : t('sidebar.attention.more', { count: others.length })}
            <Icon name={showAll ? 'chevronUp' : 'chevronDown'} size={10} />
          </button>
        ) : null}
        {left !== undefined ? <span className={s.countdown}>{t('sidebar.attention.minLeft', { count: Math.ceil(left / 60_000) })}</span> : null}
      </div>
      {first.detail ? <pre className={`${s.detail} selectable`}>{first.detail}</pre> : null}
      {first.kind === 'secret' ? (
        // A .env file: once, always for this project, or always (Settings › Environment takes it back).
        <div className={s.actions}>
          <Button variant="primary" onClick={() => void api.host.answerApproval('yes', first.id)}>
            {t('needs.allowOnce')}
          </Button>
          {first.project ? (
            <Tip label={t('sidebar.attention.envProjectTip')}>
              <Button onClick={() => void api.host.answerApproval('project', first.id)}>{t('sidebar.attention.alwaysFor', { project: first.project })}</Button>
            </Tip>
          ) : null}
          <Tip label={t('sidebar.attention.envEveryTip')}>
            <Button variant="quiet" onClick={() => void api.host.answerApproval('always', first.id)}>
              {t('needs.always')}
            </Button>
          </Tip>
          <Button variant="quiet" onClick={() => void api.host.answerApproval('no', first.id)}>
            {t('sidebar.attention.dontAllow')}
          </Button>
        </div>
      ) : first.once ? (
        // A friend's request for a secret: asked each time, so there's no Always.
        <div className={s.actions}>
          <Button variant="primary" onClick={() => void api.host.answerApproval('yes', first.id)}>
            {t('needs.allowOnce')}
          </Button>
          <Button variant="quiet" onClick={() => void api.host.answerApproval('no', first.id)}>
            {t('needs.decline')}
          </Button>
        </div>
      ) : (
        <div className={s.actions}>
          <Button variant="primary" onClick={() => void api.host.answerApproval('yes', first.id)}>
            {t('common.allow')}
          </Button>
          <Button onClick={() => void api.host.answerApproval('always', first.id)}>{t('sidebar.attention.alwaysAllow')}</Button>
          <Button variant="quiet" onClick={() => void api.host.answerApproval('no', first.id)}>
            {t('common.deny')}
          </Button>
        </div>
      )}
      {showAll && others.length ? (
        <ul className={s.others} aria-label={t('sidebar.attention.alsoWaiting')}>
          {others.map((a) => (
            <li key={a.id} className={s.other}>
              <span className={s.otherText}>
                <span className={s.otherTitle}>{brandText(a.title)}</span>
                {a.detail ? <code className={s.otherDetail}>{a.detail}</code> : null}
              </span>
              <Button size="small" onClick={() => void api.host.answerApproval('yes', a.id)}>
                {t('common.allow')}
              </Button>
              <Button size="small" variant="quiet" onClick={() => void api.host.answerApproval('no', a.id)}>
                {t('common.deny')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Question({ channel }: { channel?: string }) {
  const t = useT();
  const actions = useActions();
  const { ui } = useBeluga();
  // Only the question shown and who asked, so other events don't draw the card again.
  const { q, owner, agent, selfId } = useApp((st) => {
    const first = st.questions[0];
    const q = channel ? st.questions.find((x) => x.channel === channel) : first?.channel === channelOf(st.view) ? first : undefined;
    const peer = q ? st.peers.find((p) => p.peerId === q.owner) : undefined;
    return { q, owner: peer?.name, agent: agentName(peer ? defaultAgentOf(peer) : defaultAgentOf(st.self)), selfId: st.selfId };
  }, sameFields);
  // Read in full: the card grows up over the chat, the plan from its first line (no sheet on top of it).
  const full = useUi((u) => Boolean(q && u.planFull === q.qid));
  const planRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (planRef.current) planRef.current.scrollTop = 0;
  }, [full, q?.qid]);
  if (!q) return null;
  if (q.question.kind === 'plan') {
    return (
      <div className={cx(s.card, full && s.cardFull)}>
        <div className={s.head}>
          <Icon name="wand" size={13} className={s.claude} />
          <span className={s.title}>{t('sidebar.attention.hasPlan', { who: owner && q.owner !== selfId ? t('sidebar.attention.ownersAgent', { owner, agent }) : agent })}</span>
          <Button size="small" variant="quiet" icon={full ? 'chevronDown' : 'chevronUp'} aria-expanded={full} onClick={() => ui.patch({ planFull: full ? undefined : q.qid })}>
            {full ? t('sidebar.showLess') : t('sidebar.attention.readInFull')}
          </Button>
        </div>
        <div ref={planRef} className={cx(s.plan, full && s.planFull, 'selectable')} role="region" aria-label={t('sidebar.attention.thePlan')}>
          <Markdown text={q.question.plan} />
        </div>
        <div className={s.actions}>
          <Button variant="primary" onClick={() => actions.run({ type: 'answer', qid: q.qid, pick: 'approve' })}>
            {t('sidebar.attention.approvePlan')}
          </Button>
          <span className={s.hint}>{t('sidebar.attention.typeToChange')}</span>
        </div>
      </div>
    );
  }
  const current = currentQuestion(q);
  if (!current) return null;
  const chosen = new Set((q.picked[`${current.question}#multi`] ?? '').split('\u0000').filter(Boolean));
  const total = q.question.questions.length;
  const index = q.question.questions.indexOf(current);
  return (
    <div className={s.card}>
      <div className={s.head}>
        <Icon name="claude" size={13} className={s.claude} />
        <span className={s.title}>{current.header || t('sidebar.attention.asks', { agent })}</span>
        {total > 1 ? <span className={s.more}>{t('sidebar.attention.ofTotal', { index: index + 1, total })}</span> : null}
        {/* A decision of yours in a plan waits until you answer it (core/plans/decisions.ts). */}
        {isDecisionQid(q.qid) ? null : (
          <Button size="small" variant="quiet" onClick={() => actions.run({ type: 'answer', qid: q.qid, pick: 'skip' })}>
            {t('needs.skip')}
          </Button>
        )}
      </div>
      <div className={`${s.question} selectable`}>
        <Markdown text={current.question} />
      </div>
      <div className={s.options}>
        {current.options.map((o, i) => (
          <button key={o.label} type="button" className={`${s.option} ${chosen.has(o.label) ? s.optionOn : ''}`} onClick={() => actions.run({ type: 'answer', qid: q.qid, pick: 'option', label: o.label, question: current.question })}>
            <span className={s.optionKey}>{i + 1}</span>
            <span className={s.optionText}>
              <span className={s.optionLabel}>{o.label}</span>
              {o.description ? <span className={s.optionDesc}>{o.description}</span> : null}
            </span>
            {current.multiSelect ? <Icon name={chosen.has(o.label) ? 'check' : 'plus'} size={12} /> : null}
          </button>
        ))}
      </div>
      {current.multiSelect ? (
        <div className={s.actions}>
          <Button variant="primary" onClick={() => actions.run({ type: 'answer', qid: q.qid, pick: 'done', question: current.question })}>
            {t('common.done')}
          </Button>
        </div>
      ) : (
        <div className={s.hint}>{t('sidebar.attention.pickOne')}</div>
      )}
    </div>
  );
}

function Knock() {
  const t = useT();
  const actions = useActions();
  const { knock, who, link } = useApp((st) => {
    const knock = st.knocks.find((k) => st.peers.some((p) => p.peerId === k.peerId));
    if (!knock) return { knock, who: undefined, link: undefined };
    return { knock, who: st.peers.find((p) => p.peerId === knock.peerId)?.name ?? t('sidebar.someone'), link: st.links.find((l) => l.id === knock.linkId) };
  }, sameFields);
  if (!knock) return null;
  return (
    <div className={s.card}>
      <div className={s.head}>
        <Icon name="person" size={13} />
        <span className={s.title}>
          {link ? t('sidebar.attention.wantsToJoin', { who: who ?? '', place: link.label }) : t('sidebar.attention.wantsToJoinRoom', { who: who ?? '' })}
        </span>
      </div>
      <div className={s.actions}>
        <Button variant="primary" onClick={() => actions.run({ type: 'knock', peerId: knock.peerId, pick: 'in' })}>
          {t('needs.letIn')}
        </Button>
        <Button onClick={() => actions.run({ type: 'knock', peerId: knock.peerId, pick: 'watch' })}>{t('sidebar.attention.letInToWatch')}</Button>
        <Button variant="quiet" onClick={() => actions.run({ type: 'knock', peerId: knock.peerId, pick: 'decline' })}>
          {t('needs.notNow')}
        </Button>
      </div>
    </div>
  );
}

/** Hosts you said Not Now to ("Add kay as a friend?"), remembered on this Mac. */
const BEFRIEND_KEY = 'beluga.befriend.notNow';
const notNow = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(BEFRIEND_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
};

/**
 * You joined someone's room with an old room link: rooms fold into friends (BLG-202), so their
 * host is offered as a friend, once. The room itself works as before.
 */
function BefriendHost() {
  const t = useT();
  const { client } = useBeluga();
  const [dismissed, setDismissed] = useState(notNow);
  const host = useApp((st) => hostToBefriend({ peers: st.peers, selfId: st.self?.peerId, friends: st.network.friends, ...(st.network.offers ? { offers: st.network.offers } : {}), dismissed }), sameDeep);
  if (!host) return null;
  const later = (): void => {
    const next = new Set([...dismissed, host.peerId]);
    localStorage.setItem(BEFRIEND_KEY, JSON.stringify([...next].slice(-200)));
    setDismissed(next);
  };
  return (
    <div className={s.card} role="group" aria-label={t('sidebar.attention.addAsFriendLabel', { name: host.name })}>
      <div className={s.head}>
        <Icon name="person" size={13} />
        <span className={s.title}>{t('sidebar.attention.addAsFriendAsk', { name: host.name })}</span>
      </div>
      <div className={s.actions}>
        <Button variant="primary" onClick={() => void befriend(client, host.peerId, host.name)}>
          {t('sidebar.attention.addAsFriend')}
        </Button>
        <Button variant="quiet" onClick={later}>
          {t('common.notNow')}
        </Button>
      </div>
    </div>
  );
}

function TrustPrompt() {
  const t = useT();
  const actions = useActions();
  const { peerId, who } = useApp((st) => {
    const peerId = st.trustPrompts.find((id) => st.peers.some((p) => p.peerId === id));
    return { peerId, who: peerId ? (st.peers.find((p) => p.peerId === peerId)?.name ?? t('sidebar.someone')) : undefined };
  }, sameFields);
  if (!peerId) return null;
  return (
    <div className={s.card}>
      <div className={s.head}>
        <Icon name="lock" size={13} />
        <span className={s.title}>{t('sidebar.attention.trustWho', { who: who ?? '' })}</span>
        <Button size="small" variant="quiet" onClick={() => actions.run({ type: 'trust_later', peerId })}>
          {t('sidebar.later')}
        </Button>
      </div>
      <div className={s.trustRow}>
        {(['ask', 'trusted', 'full', 'blocked'] as const).map((level) => (
          <Tip key={level} label={TRUST_INFO[level].detail}>
            <button type="button" className={s.trust} onClick={() => actions.run({ type: 'trust', peerId, level })}>
              <span className={s.optionLabel}>{TRUST_INFO[level].label}</span>
            </button>
          </Tip>
        ))}
      </div>
    </div>
  );
}
