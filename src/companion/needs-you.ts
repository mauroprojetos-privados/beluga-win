import { isExternalRequester } from '../core/trust.js';
import { type Key, type Params, t } from '../shared/i18n/index.js';
import type { Approval, DomainState } from '../core/store.js';
import type { TeamOffer } from '../core/team/model.js';
import type { PendingQuestion } from '../core/collab-store.js';
import type { TaskView as GwTask } from '../core/gateway/model.js';
import { parseDecisionQid } from '../core/plans/decisions.js';
import { type Plan, planTitle, reviewState } from '../core/plans/model.js';
import { firstLine, sentinelById } from '../core/sentinel/model.js';
import { type PlanView as PlanProgress, planView } from '../core/plans/progress.js';
import { type NeedsYou, Topic } from './protocol.js';
import { plainLine, stripCode } from './strip.js';
import { agentLabel } from '../shared/agent-label.js';
import { type AgentRef, defaultAgentOf } from '../protocol.js';
import { exhaustedCombos } from '../core/routing/model.js';
import { hhmm } from '../shared/clock.js';
import { botBehind } from '../core/bots/schema.js';
import { isAssistant } from '../shared/assistant.js';

/**
 * Everything waiting for you, each with the API calls its buttons make: the phone's Needs You
 * (views.ts) and the Mac's bell (BLG-255) draw this same list, so the two never disagree about
 * what waits or how it's answered. Browser-safe (tests/browser-safe.test.ts): the Mac loads it.
 */

export const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
export const agentRefView = (a: AgentRef): AgentRef => ({ runtime: clip(a.runtime, 32), label: clip(a.label, 64), ...(a.model ? { model: clip(a.model, 64) } : {}), ...(a.comboName ? { comboName: clip(a.comboName, 64) } : {}) });
const valid = (t: string): Topic | undefined => (Topic.safeParse(t).success ? (t as Topic) : undefined);

/** A conversation's topic (`room` → `conv:room`, `ws:<id>` → `conv:ws:<id>`). */
export const convTopic = (channel: string): Topic | undefined => valid(`conv:${channel}`);
export const chatTopic = (conversation: string): Topic | undefined => valid(`chat:${conversation}`);
export const planTopic = (id: string): Topic | undefined => valid(`plan:${id}`);
export const taskTopic = (id: string): Topic | undefined => valid(`task:${id}`);
export const sentinelTopic = (id: string): Topic | undefined => valid(`sentinel:${id}`);
export const dashboardTopic = (id: string): Topic | undefined => valid(`dashboard:${id}`);

export const nameOf = (state: DomainState, peerId: string | undefined): string | undefined =>
  peerId ? (state.peers.find((p) => p.peerId === peerId)?.name ?? state.network.friends.find((f) => f.peerId === peerId)?.name) : undefined;

export const myId = (state: DomainState): string => state.selfId || state.self?.peerId || state.network.self?.peerId || 'me';

/** "your Claude", "mia's Codex": the agent of this Mac, or of a peer it knows (else Claude). */
const agentOf = (state: DomainState, peerId: string | undefined, owner: string, capital = false): string =>
  !peerId || peerId === myId(state)
    ? agentLabel(defaultAgentOf(state.self), undefined, true, { capital })
    : agentLabel(defaultAgentOf(state.peers.find((p) => p.peerId === peerId)), owner, false, { capital });

/** The child thread a need holds up, by title: without it "your Claude" could be any of a tree's chats. */
function threadPlace(state: DomainState, channel: string | undefined): Pick<NeedsYou, 'thread'> {
  const ws = channel?.startsWith('ws:') ? state.projects.flatMap((p) => p.workspaces).find((w) => w.id === channel.slice(3)) : undefined;
  return ws?.thread ? { thread: clip(ws.name, 300) } : {};
}

/**
 * A title said by key (protocol.ts `key`/`params`, docs/i18n.md): in this side's language, and with
 * its key for a phone that says it in its own. An older phone reads the title.
 */
const keyed = (key: Key, params?: Params): { title: string; key: Key; params?: Params } => ({ title: clip(t(key, params), 500), key, ...(params ? { params } : {}) });
/** A button said by key, the same way. */
const btn = (key: Key, tone: 'main' | 'danger' | 'plain', method: string, args: unknown[]) => ({ label: clip(t(key), 40), key, tone, method, args });
/** What an answer's send button says, by key. */
const sendLabel = (key: Key): { label: string; key: Key } => ({ label: clip(t(key), 40), key });

/** "Ata", "Ata and Mia", "Ata, Mia and 2 others", in the app's language. */
function names(list: readonly string[]): string {
  const [a = '', b = '', c = ''] = list;
  if (list.length <= 1) return a;
  if (list.length === 2) return t('daemon.needs.names.two', { a, b });
  if (list.length === 3) return t('daemon.needs.names.three', { a, b, c });
  return t('daemon.needs.names.more', { a, b, count: list.length - 2 });
}

/** A team offer's question (core/team/model.ts offerWords, asked): "Ata wants to team up on acme/api. Team up?". */
function offerTitle(o: Pick<TeamOffer, 'name' | 'repo' | 'state' | 'team'>): { title: string; key: Key; params?: Params } {
  const others = o.team?.filter((n) => n !== o.name) ?? [];
  if (o.state === 'invited') return others.length ? keyed('daemon.needs.teamInvitedWith', { name: o.name, repo: o.repo, others: names(others) }) : keyed(o.team?.length ? 'daemon.needs.teamWantsJoin' : 'daemon.needs.teamWants', { name: o.name, repo: o.repo });
  return keyed(others.length ? 'daemon.needs.teamAlsoInvite' : 'daemon.needs.teamAlso', { name: o.name, repo: o.repo });
}

function approvalItem(state: DomainState, a: Approval): NeedsYou {
  const from = a.asker ?? (a.peer ? `${nameOf(state, a.peer) ?? t('daemon.needs.aFriend')}` : agentOf(state, undefined, ''));
  // A friends' chat opens that chat (a request from there, your Claude working there: BLG-207).
  // An external agent's own place has no chat to open.
  const topic = a.channel && !isExternalRequester(a.channel) ? (/^(dm|group):/.test(a.channel) ? chatTopic(a.channel) : convTopic(a.channel)) : undefined;
  return {
    id: `approval:${a.id}`,
    ...threadPlace(state, a.channel),
    kind: a.kind === 'request' ? 'request' : 'approval',
    title: clip(a.title, 500),
    ...(a.detail ? { detail: clip(plainLine(a.detail, 64_000), 64_000) } : {}),
    from,
    ...(topic ? { topic } : {}),
    ...(a.askedAt !== undefined ? { askedAt: a.askedAt } : {}),
    ...(a.timeoutMs !== undefined ? { timeoutMs: a.timeoutMs } : {}),
    actions: [
      btn(a.once ? 'needs.allowOnce' : 'needs.approve', 'main', 'host.answerApproval', ['yes', a.id]),
      btn('needs.decline', 'danger', 'host.answerApproval', ['no', a.id]),
      // A friend's request for a secret is asked each time: no Always.
      ...(a.once ? [] : [btn('needs.always', 'plain', 'host.answerApproval', ['always', a.id])]),
    ],
  };
}

/** Claude's question (or plan to approve), or a plan task waiting on your decision. */
function questionItem(state: DomainState, q: PendingQuestion): NeedsYou {
  const topic = convTopic(q.channel);
  const owner = agentOf(state, q.owner, nameOf(state, q.owner) ?? t('daemon.needs.aFriend'));
  const base = { id: `question:${q.qid}`, from: owner, ...(topic ? { topic } : {}), ...threadPlace(state, q.channel) };
  if (q.question.kind === 'plan') {
    return {
      ...base,
      kind: 'question',
      ...keyed('needs.planToApprove', { owner: `${owner.charAt(0).toUpperCase()}${owner.slice(1)}` }),
      detail: clip(stripCode(q.question.plan).text, 64_000),
      freeText: true,
      actions: [
        btn('needs.approve', 'main', 'questions.answer', [q.qid, { kind: 'plan', approve: true, feedback: '' }]),
        btn('needs.keepPlanning', 'danger', 'questions.answer', [q.qid, { kind: 'plan', approve: false, feedback: '' }]),
      ],
      // Your words: what to change in the plan (it keeps planning with them).
      answer: { method: 'questions.answer', args: [q.qid, { kind: 'plan', approve: false, feedback: '' }], slot: [1, 'feedback'], text: true, picks: false, ...sendLabel('needs.sendChanges') },
    };
  }
  const [first, ...rest] = q.question.questions.filter((x) => !(x.question in q.picked));
  const head = first ?? q.question.questions[0]!;
  const decision = parseDecisionQid(q.qid);
  const plan = decision ? state.plans.plans.find((p) => p.id === decision.plan) : undefined;
  const planT = plan ? planTopic(plan.id) : undefined;
  // Answers to the earlier questions of this prompt (picked one at a time with questions.pick).
  const picked = Object.fromEntries(Object.entries(q.picked).filter(([k]) => !k.endsWith('#multi')));
  const last = !rest.length;
  const single = last && !head.multiSelect && head.options.length > 0 && head.options.length <= 3;
  // Several picks (joined with ", " as the Mac does) or your own words go where `slot` says: the
  // last question sends every answer (questions.answer); an earlier one is kept with questions.pick.
  const answer: NonNullable<NeedsYou['answer']> = last
    ? { method: 'questions.answer', args: [q.qid, { kind: 'answers', answers: { ...picked, [head.question]: '' } }], slot: [1, 'answers', head.question], join: ', ', text: true, picks: head.options.length > 0, ...sendLabel('needs.send') }
    : { method: 'questions.pick', args: [q.qid, head.question, ''], slot: [2], join: ', ', text: true, picks: head.options.length > 0, ...sendLabel('needs.next') };
  return {
    ...base,
    kind: decision ? 'decision' : 'question',
    ...(decision ? { from: plan ? t('daemon.needs.thePlan', { title: clip(planTitle(plan), 80) }) : t('daemon.needs.aPlan') } : {}),
    ...(decision && planT ? { topic: planT } : {}),
    title: clip(plainLine(head.question, 500), 500),
    ...(rest.length ? { detail: clip(rest.map((r) => plainLine(r.question, 1000)).join('\n'), 64_000) } : {}),
    choices: head.options.slice(0, 12).map((o) => ({ label: clip(o.label, 200), ...(o.description ? { description: clip(o.description, 1000) } : {}) })),
    multi: head.multiSelect,
    freeText: true,
    // One question with a few options: a button each (the phone sends the rest, multi-select or words, itself).
    actions: [
      ...(single ? head.options.map((o) => ({ label: clip(o.label, 40), tone: 'plain' as const, method: 'questions.answer', args: [q.qid, { kind: 'answers', answers: { ...picked, [head.question]: o.label } }] })) : []),
      btn('needs.skip', 'danger', 'questions.answer', [q.qid, { kind: 'skip' }]),
    ],
    answer,
  };
}

function gatewayItems(state: DomainState, t: GwTask): NeedsYou[] {
  const topic = t.conversation ? convTopic(t.conversation) : t.direction === 'sent' ? convTopic(`task:${t.id}`) : undefined;
  const at = topic ? { topic } : {};
  if (t.direction === 'sent' && t.state === 'confirm') {
    return [
      {
        id: `confirm:${t.id}`,
        kind: 'confirm',
        ...keyed('needs.askAgent', { agent: agentOf(state, t.peerId, clip(t.peerName, 60)) }),
        detail: clip(plainLine(t.ask, 64_000), 64_000),
        from: agentOf(state, undefined, ''),
        ...at,
        askedAt: t.createdAt,
        actions: [
          btn('needs.ask', 'main', 'gateway.confirm', [t.id, true]),
          // Send it, and let your Claude ask them without checking from now on.
          btn('needs.always', 'plain', 'gateway.confirm', [t.id, true, '', true]),
          btn('needs.notNow', 'danger', 'gateway.confirm', [t.id, false]),
        ],
      },
    ];
  }
  if (t.direction === 'sent' && t.question) {
    const head = t.question.questions[0];
    if (!head) return [];
    const single = t.question.questions.length === 1 && !head.multiSelect && head.options.length > 0 && head.options.length <= 3;
    return [
      {
        id: `gwq:${t.id}:${t.question.qid}`,
        kind: 'question',
        title: clip(plainLine(head.question, 500), 500),
        detail: clip(plainLine(t.summary ?? t.ask, 64_000), 64_000),
        from: agentOf(state, t.peerId, clip(t.peerName, 60)),
        ...at,
        askedAt: t.question.askedAt,
        choices: head.options.slice(0, 12).map((o) => ({ label: clip(o.label, 200), ...(o.description ? { description: clip(o.description, 1000) } : {}) })),
        multi: head.multiSelect,
        // One question: picks or words go in the answer list. Several at once: only on the Mac (or Skip).
        freeText: t.question.questions.length === 1,
        actions: [
          ...(single ? head.options.map((o) => ({ label: clip(o.label, 40), tone: 'plain' as const, method: 'gateway.answer', args: [t.id, [o.label]] })) : []),
          btn('needs.skip', 'danger', 'gateway.answer', [t.id, 'skip']),
        ],
        ...(t.question.questions.length === 1 ? { answer: { method: 'gateway.answer', args: [t.id, ['']], slot: [1, 0], join: ', ', text: true, picks: head.options.length > 0, ...sendLabel('needs.send') } } : {}),
      },
    ];
  }
  // A friend's request: its approval card (approvals) already stands for it when there is one.
  if (t.direction === 'received' && t.state === 'awaiting_approval' && !state.approvals.some((a) => a.task === t.id)) {
    return [
      {
        id: `request:${t.id}`,
        kind: 'request',
        ...(t.secret ? keyed('daemon.needs.wantsSecret', { name: t.peerName, secret: t.secret.label }) : t.summary ? keyed('daemon.needs.saysSummary', { name: t.peerName, summary: t.summary }) : keyed('daemon.needs.asksAgent', { name: t.peerName, agent: agentOf(state, undefined, '') })),
        detail: clip(plainLine(t.ask, 64_000), 64_000),
        from: clip(t.peerName, 100),
        ...(t.chat && chatTopic(t.chat) ? { topic: chatTopic(t.chat)! } : {}),
        askedAt: t.createdAt,
        actions: [
          btn(t.secret ? 'needs.allowOnce' : 'needs.approve', 'main', 'gateway.decide', [t.id, { answer: 'yes' }]),
          btn('needs.decline', 'danger', 'gateway.decide', [t.id, { answer: 'no' }]),
          ...(t.secret ? [] : [btn('needs.always', 'plain', 'gateway.decide', [t.id, { answer: 'always' }])]),
        ],
      },
    ];
  }
  return [];
}

/**
 * What a running plan gave up on by itself, so it's yours: a task Beluga woke that stopped again
 * (Resume), or a milestone it couldn't move on after every rescue step (saying what it tried).
 */
function stuckItems(plan: Plan, progress: PlanProgress, at: Pick<NeedsYou, 'topic' | 'from'>): NeedsYou[] {
  if (plan.status !== 'active') return [];
  const titles = new Map((progress.body?.milestones ?? []).flatMap((m) => [[m.id, m.title] as const, ...m.tasks.map((t) => [t.id, t.title] as const)]));
  const stalled = Object.entries(plan.watch ?? {})
    .filter(([, w]) => w.needsYou)
    .map(([taskId, w]): NeedsYou => ({
      id: `plan:${plan.id}:stalled:${taskId}`,
      kind: 'decision',
      ...keyed('needs.taskStalled', { title: titles.get(taskId) ?? t('needs.aTask') }),
      detail: clip(w.reason, 64_000),
      ...at,
      askedAt: w.at,
      actions: [btn('needs.resume', 'main', 'plans.resumeTask', [plan.id, taskId])],
    }));
  const rescued = Object.entries(plan.rescue ?? {})
    .filter(([, r]) => r.yours)
    .map(([unitId, r]): NeedsYou => ({
      id: `plan:${plan.id}:rescue:${unitId}`,
      kind: 'stuck',
      ...(titles.has(unitId) ? keyed('daemon.needs.stuckOn', { title: titles.get(unitId)! }) : keyed('daemon.needs.stuck')),
      detail: clip(r.tried.length ? t('daemon.needs.belugaTried', { list: r.tried.join('; ') }) : t('daemon.needs.belugaCouldnt'), 64_000),
      ...at,
      askedAt: r.at,
      actions: [],
    }));
  // A merge conflict Claude couldn't fix (a milestone into the plan's branch, or main into it for its PR): ask it again.
  const merging = Object.entries(plan.merging ?? {}).filter(([, m]) => m.conflict?.stuck);
  const conflicts = [
    ...merging.map(([id, m]) => ({ key: id, files: m.conflict!.files, at: m.conflict!.at, what: t('daemon.needs.mergingInto', { title: titles.get(id) ?? t('daemon.needs.aMilestone'), branch: plan.branch ?? t('daemon.needs.thePlansBranch') }) })),
    ...(plan.mainMerge?.conflict?.stuck ? [{ key: 'main', files: plan.mainMerge.conflict.files, at: plan.mainMerge.conflict.at, what: t('daemon.needs.mergingMain', { main: plan.mainMerge.main, branch: plan.branch ?? t('daemon.needs.thePlansBranch') }) }] : []),
  ].map(
    (c): NeedsYou => ({
      id: `plan:${plan.id}:conflict:${c.key}`,
      kind: 'stuck',
      ...keyed('needs.conflictStuck'),
      detail: clip(t('daemon.needs.whileMerging', { what: c.what, files: c.files.join(', ') }), 64_000),
      ...at,
      askedAt: c.at,
      actions: [btn('needs.askClaudeAgain', 'main', 'plans.retryConflicts', [plan.id])],
    }),
  );
  return [...stalled, ...rescued, ...conflicts];
}

/** What a plan waits for from you: approving its draft, passing a milestone at its gate, or what it couldn't move on itself. */
function planItems(plan: Plan, progress: PlanProgress): NeedsYou[] {
  const title = clip(planTitle(plan), 200);
  const topic = planTopic(plan.id);
  const at = { ...(topic ? { topic } : {}), from: t('daemon.needs.yourPlan') };
  return [...gateItems(plan, progress, title, at), ...stuckItems(plan, progress, at)];
}

function gateItems(plan: Plan, progress: PlanProgress, title: string, at: Pick<NeedsYou, 'topic' | 'from'>): NeedsYou[] {
  const next = progress.next;
  // Claude is still writing the first plan: nothing to approve yet (the Mac's Approve Plan waits too).
  if (next.kind === 'approve' && !progress.body?.milestones.length) return [];
  // A fresh agent is verifying the draft, as you asked (BLG-772): the Mac's Approve Plan waits for it too.
  const review = reviewState(plan);
  if (next.kind === 'approve' && review === 'reviewing') return [];
  if (next.kind === 'approve' && review === 'findings' && plan.review && !plan.review.fixAsked) {
    const found = plan.review.findings;
    return [
      {
        id: `plan:${plan.id}:review:${plan.draftRev}`,
        kind: 'decision',
        ...keyed('needs.reviewFound', { count: found.length, title }),
        detail: clip(found.map((f, i) => `${i + 1}. ${plainLine(f.text, 1000)}`).join('\n'), 64_000),
        ...at,
        askedAt: plan.review.at,
        actions: [
          btn('needs.fix', 'main', 'plans.fixReview', [plan.id]),
          btn('needs.approveAnyway', 'plain', 'plans.approve', [plan.id]),
          btn('needs.discard', 'danger', 'plans.discard', [plan.id]),
        ],
      },
    ];
  }
  if (next.kind === 'approve' || next.kind === 'review_changes') {
    return [
      {
        id: `plan:${plan.id}:approve:${plan.draftRev}`,
        kind: 'decision',
        ...keyed(next.kind === 'approve' ? 'needs.approvePlan' : 'needs.approveChanges', { title }),
        ...(plan.draft?.goal ? { detail: clip(plainLine(plan.draft.goal, 4000), 4000) } : {}),
        ...at,
        askedAt: plan.updatedAt,
        actions: [
          btn('needs.approve', 'main', 'plans.approve', [plan.id]),
          // A first draft can be read by a fresh agent first, and approved once it reads well (BLG-772).
          ...(next.kind === 'approve' ? [btn('needs.verifyThenApprove', 'plain', 'plans.verify', [plan.id, { thenApprove: true }])] : []),
          btn('needs.discard', 'danger', 'plans.discard', [plan.id]),
        ],
      },
    ];
  }
  if (next.kind === 'pass') {
    const m = next.milestone.milestone;
    // Passed once, but its work couldn't go into the plan's branch: why, and pass it again.
    const failed = next.milestone.run.mergeFailed;
    return [
      {
        id: `plan:${plan.id}:pass:${m.id}`,
        kind: 'decision',
        ...keyed(failed ? 'needs.milestoneMergeFailed' : 'needs.milestoneReady', { title: clip(m.title, 200) }),
        detail: clip(failed ? failed.reason : m.criteria.join('\n'), 64_000),
        ...at,
        // Send it back takes your words (the answer template).
        freeText: true,
        actions: [
          btn('needs.pass', 'main', 'plans.pass', [plan.id, m.id]),
          btn('needs.checkAgain', 'plain', 'plans.recheck', [plan.id, m.id]),
        ],
        answer: { method: 'plans.sendBack', args: [plan.id, m.id, ''], slot: [2], text: true, picks: false, ...sendLabel('needs.sendBack') },
      },
    ];
  }
  return [];
}

export const progressOf = (state: DomainState, plan: Plan): PlanProgress => planView(plan, state.board);

/** Someone came to the door with a link you made: let them in (with what the link offers) or turn them away. */
function knockItems(state: DomainState): NeedsYou[] {
  return state.knocks.map((k) => {
    const name = nameOf(state, k.peerId) ?? state.guests[k.peerId]?.name ?? t('daemon.needs.someone');
    const link = state.links.find((l) => l.id === k.linkId);
    return {
      id: `knock:${k.peerId}`,
      kind: 'request',
      ...keyed('needs.wantsToComeIn', { name }),
      detail: clip(link ? t('daemon.needs.withLink', { label: link.label }) : t('daemon.needs.withALink'), 64_000),
      from: clip(name, 100),
      ...(k.ts ? { askedAt: k.ts } : {}),
      actions: [
        btn('needs.letIn', 'main', 'invites.letIn', [k.peerId]),
        btn('needs.turnAway', 'danger', 'invites.decline', [k.peerId]),
      ],
    };
  });
}

/** People asking to join a channel you run (you're its admin). */
function joinItems(state: DomainState): NeedsYou[] {
  return state.network.groups
    .filter((g) => g.admin && g.active)
    .flatMap((g) =>
      g.requests.map((r) => {
        const topic = chatTopic(`group:${g.id}`);
        return {
          id: `join:${g.id}:${r.peerId}`,
          kind: 'request',
          ...keyed('daemon.needs.asksToJoin', { name: r.name, group: g.name }),
          from: clip(r.name, 100),
          ...(topic ? { topic } : {}),
          askedAt: r.ts,
          actions: [
            btn('needs.letIn', 'main', 'network.groups.approve', [g.id, r.peerId]),
            btn('needs.decline', 'danger', 'network.groups.decline', [g.id, r.peerId]),
          ],
        };
      }),
    );
}

/** Someone in your room asks to be friends on the Beluga network (BLG-202). */
function offerItems(state: DomainState): NeedsYou[] {
  return (state.network.offers ?? [])
    .filter((o) => o.dir === 'in')
    .map((o) => ({
      id: `friend:${o.peerId}`,
      kind: 'request' as const,
      ...(o.via ? keyed('daemon.needs.friendOfferVia', { name: o.name, team: o.via }) : keyed('daemon.needs.friendOffer', { name: o.name })),
      detail: t('daemon.needs.friendOfferDetail'),
      from: clip(o.name, 100),
      askedAt: o.at,
      actions: [
        btn('daemon.needs.accept', 'main', 'network.friends.answerOffer', [o.peerId, true]),
        btn('needs.notNow', 'danger', 'network.friends.answerOffer', [o.peerId, false]),
      ],
    }));
}

/** Someone rings you (BLG-706): answer on your Mac (its window picks up the call) or decline. */
function callItems(state: DomainState): NeedsYou[] {
  return Object.values(state.network.calls ?? {})
    .filter((c) => c.mine === 'ringing')
    .map((c) => {
      const by = state.network.friends.find((f) => f.peerId === c.ringBy)?.name ?? c.people.find((p) => p.peerId === c.ringBy)?.name ?? t('daemon.needs.someone');
      const group = c.conversation.startsWith('group:') ? state.network.groups.find((g) => g.id === c.conversation.slice(6)) : undefined;
      return {
        id: `call:${c.id}`,
        kind: 'call',
        ...(group ? keyed('daemon.needs.callingIn', { name: by, group: group.name }) : keyed('daemon.needs.calling', { name: by })),
        detail: c.people.length > 1 ? clip(t('daemon.needs.inTheCall', { names: c.people.map((p) => p.name).join(', ') }), 500) : t('daemon.needs.macPicksUp'),
        from: clip(by, 100),
        topic: 'chats' as const,
        ...(c.ringSince ? { askedAt: c.ringSince } : {}),
        actions: [
          btn('daemon.needs.answerOnMac', 'main', 'calls.join', [c.conversation]),
          btn('needs.decline', 'danger', 'calls.decline', [c.conversation]),
        ],
      };
    });
}

/** A friend on the same GitHub repository: team up on it (BLG-221). Only offers waiting on you. */
function teamOfferItems(state: DomainState): NeedsYou[] {
  return state.team.offers
    .filter((o) => o.state !== 'asked')
    .map((o) => ({
      id: `team:${o.peerId}:${o.projectId}`,
      kind: 'request' as const,
      ...offerTitle(o),
      detail: t('daemon.needs.teamDetail'),
      from: clip(o.name, 100),
      askedAt: o.at,
      actions: [
        btn('daemon.needs.teamUp', 'main', 'team.answer', [o.peerId, o.projectId, true]),
        btn('daemon.needs.notNow', 'danger', 'team.answer', [o.peerId, o.projectId, false]),
      ],
    }));
}

/** A teammate gave you a task (BLG-223): it waits until you've seen it. */
function assignedItems(state: DomainState): NeedsYou[] {
  return state.team.assigned.flatMap((a) => {
    const topic = taskTopic(a.issueId);
    return [
      {
        id: `team-task:${a.issueId}`,
        kind: 'request' as const,
        ...keyed('daemon.needs.gaveYou', { by: a.by, key: a.key, title: a.title }),
        detail: t('daemon.needs.gaveYouDetail'),
        from: clip(a.by, 100),
        ...(topic ? { topic } : {}),
        askedAt: a.at,
        actions: [btn('daemon.needs.gotIt', 'main', 'team.ackAssignment', [a.issueId])],
      },
    ];
  });
}

/** A teammate knocking on one of your worktrees (BLG-416): let them in as a viewer or an editor. */
function worktreeKnockItems(state: DomainState): NeedsYou[] {
  return (state.team.knocks ?? []).map((k) => {
    const topic = chatTopic(`ws:${k.workspaceId}`);
    return {
      id: `wt-knock:${k.id}`,
      kind: 'request' as const,
      ...keyed('daemon.needs.knocking', { name: k.name, worktree: k.worktree }),
      detail: clip(k.note ? `“${k.note}” · ${k.key}: ${k.title}` : `${k.key}: ${k.title}`, 64_000),
      from: clip(k.name, 100),
      ...(topic ? { topic } : {}),
      askedAt: k.at,
      actions: [
        btn('daemon.needs.letInEditor', 'main', 'team.answerKnock', [k.id, 'contribute']),
        btn('daemon.needs.notNow', 'danger', 'team.answerKnock', [k.id, 'decline']),
        btn('daemon.needs.letInViewer', 'plain', 'team.answerKnock', [k.id, 'view']),
      ],
    };
  });
}

/**
 * Shared plans (BLG-225): a plan a teammate shared that you haven't approved (Approve, or words as a
 * comment), and a teammate's suggested change to a plan of yours (Apply / Set Aside).
 */
function sharedPlanItems(state: DomainState): NeedsYou[] {
  const self = myId(state);
  const theirs = state.team.plans
    .filter((p) => p.status === 'draft' && !p.reviews.some((r) => r.by === self && r.kind === 'approve' && r.rev === p.rev))
    .map((p) => ({
      id: `team-plan:${p.owner}:${p.id}:${p.rev}`,
      kind: 'decision' as const,
      ...keyed('daemon.needs.sharedPlan', { owner: p.ownerName, title: p.title }),
      detail: clip(
        [plainLine(p.body.goal, 2000), ...p.body.milestones.map((m, i) => t('daemon.needs.milestoneLine', { n: i + 1, title: m.title, count: m.tasks.length }))].filter(Boolean).join('\n'),
        64_000,
      ),
      from: clip(p.ownerName, 100),
      askedAt: p.updatedAt,
      freeText: true,
      actions: [btn('needs.approve', 'main', 'team.reviewPlan', [p.owner, p.id, { kind: 'approve' }])],
      answer: { method: 'team.reviewPlan', args: [p.owner, p.id, { kind: 'comment', text: '' }], slot: [2, 'text'], text: true, picks: false, ...sendLabel('daemon.needs.comment') },
    }));
  const mine = Object.values(state.team.planShares).flatMap((share) => {
    const plan = state.plans.plans.find((p) => p.id === share.planId);
    if (!plan) return [];
    return share.reviews
      .filter((r) => r.kind === 'suggest' && !r.settled)
      .map((r) => ({
        id: `team-suggest:${r.id}`,
        kind: 'decision' as const,
        ...keyed('daemon.needs.suggests', { name: r.name, count: r.ops?.length ?? 0, title: planTitle(plan) }),
        ...(r.text ? { detail: clip(r.text, 64_000) } : {}),
        from: clip(r.name, 100),
        ...(planTopic(plan.id) ? { topic: planTopic(plan.id)! } : {}),
        askedAt: r.at,
        actions: [
          btn('daemon.needs.apply', 'main', 'team.applySuggestion', [plan.id, r.id]),
          btn('daemon.needs.setAside', 'danger', 'team.dismissSuggestion', [plan.id, r.id]),
        ],
      }));
  });
  return [...theirs, ...mine];
}

/**
 * Sentinel runs waiting for you (docs/sentinel.md §5): a merge that passed its checks and review,
 * held for your Merge. The detail is the merge step's own line (the checks, Claude's review).
 */
function sentinelItems(state: DomainState): NeedsYou[] {
  const s = state.sentinel;
  if (!s.enabled) return [];
  return s.runs.flatMap((r) => {
    const sn = r.state === 'needs-you' ? sentinelById(s, r.sentinelId) : undefined;
    if (!sn) return [];
    const at = sn.steps.findIndex((st) => st.kind === 'merge');
    const step = at >= 0 ? (r.steps.find((x) => x.id === sn.steps[at]!.id) ?? r.steps[at]) : undefined;
    const detail = [step?.why ? firstLine(step.why, 2000) : '', r.pr ? t('daemon.needs.pullRequest', { number: r.pr.number }) : ''].filter(Boolean).join('\n');
    const topic = sentinelTopic(sn.id);
    return [
      {
        id: `sentinel:${r.id}`,
        kind: 'decision' as const,
        ...(firstLine(r.headline, 500) ? { title: clip(firstLine(r.headline, 500), 500) } : keyed('daemon.needs.sentinelWaits', { name: sn.name })),
        ...(detail ? { detail: clip(detail, 64_000) } : {}),
        from: clip(sn.name, 100),
        ...(topic ? { topic } : {}),
        askedAt: Math.round(step?.startedAt ?? r.startedAt),
        actions: [
          btn('daemon.needs.merge', 'main', 'sentinel.decide', [r.id, 'merge']),
          btn('daemon.needs.notNow', 'danger', 'sentinel.decide', [r.id, 'skip']),
        ],
      },
    ];
  });
}

/**
 * A dialogue between your agents waiting on you: one proposed from the composer (confirm its caps)
 * or paused at its cap (Continue?). One a friend chairs is theirs to decide, not yours.
 */
function dialogueItems(state: DomainState): NeedsYou[] {
  return Object.values(state.dialogues ?? {}).flatMap((d) => {
    if (d.remoteChair || (d.status !== 'paused' && d.status !== 'proposed')) return [];
    const topic = convTopic(d.channel ?? 'room');
    const what = clip(firstLine(d.topic, 200), 200);
    const base = { id: `dialogue:${d.id}`, kind: 'decision' as const, from: names(d.participants.map((p) => p.agent.label)), ...(topic ? { topic } : {}), askedAt: Math.round(d.updatedAt) };
    return [
      d.status === 'paused'
        ? {
            ...base,
            ...keyed('daemon.needs.dialoguePaused', { count: d.turns.filter((turn) => turn.by !== 'person').length }),
            detail: what,
            actions: [
              btn('daemon.needs.continue', 'main', 'dialogues.continue', [d.id]),
              btn('daemon.needs.stop', 'danger', 'dialogues.stop', [d.id]),
            ],
          }
        : {
            ...base,
            ...keyed('daemon.needs.dialogueStart'),
            detail: what,
            actions: [
              btn('daemon.needs.start', 'main', 'dialogues.confirm', [d.id]),
              btn('daemon.needs.cancel', 'danger', 'dialogues.stop', [d.id]),
            ],
          },
    ];
  });
}

/** Everything waiting for you, in no order and uncut (needsYou sorts and keeps 50), minus what you dismissed. */
export function allNeeds(state: DomainState): NeedsYou[] {
  const dismissed = state.dismissedNeeds ?? [];
  const all = waitingNeeds(state);
  return withBots(state, dismissed.length ? all.filter((n) => !dismissed.includes(n.id)) : all);
}

/** 1.53 (docs/bots.md): what a bot's work asks names the bot (its own chat, a plan it dispatched, that plan's worktrees). */
function withBots(state: DomainState, items: NeedsYou[]): NeedsYou[] {
  if (!state.bots.bots.length) return items;
  return items.map((n) => {
    const channel = n.topic?.startsWith('conv:') ? n.topic.slice(5) : undefined;
    const bot = channel && !isAssistant(channel) ? botBehind(state.bots.bots, channel) : undefined;
    return bot ? { ...n, bot: clip(bot.name, 100) } : n;
  });
}

/** Everything waiting for you, dismissed or not. */
export function waitingNeeds(state: DomainState): NeedsYou[] {
  return [
    ...state.approvals.map((a) => approvalItem(state, a)),
    ...state.questions.map((q) => questionItem(state, q)),
    ...state.gateway.tasks.flatMap((t) => gatewayItems(state, t)),
    ...state.plans.plans.filter((p) => p.status !== 'done').flatMap((p) => planItems(p, progressOf(state, p))),
    ...knockItems(state),
    ...joinItems(state),
    ...offerItems(state),
    ...callItems(state),
    ...teamOfferItems(state),
    ...assignedItems(state),
    ...worktreeKnockItems(state),
    ...sharedPlanItems(state),
    ...sentinelItems(state),
    ...dialogueItems(state),
    ...comboItems(state),
  ];
}

/**
 * A conversation on a combo whose every target is out (docs/routing.md): its run stopped on a limit
 * and nothing else in the combo can run now. Try Again hands it to the first that can; it also goes
 * on by itself when the limit resets (auto-continue.ts).
 */
function comboItems(state: DomainState): NeedsYou[] {
  return exhaustedCombos(state, Date.now(), hhmm).map(({ stop, name, why }) => ({
    id: `combo:${stop.channel}`,
    kind: 'combo',
    ...keyed('daemon.needs.comboOut', { name }),
    detail: clip(why, 64_000),
    from: clip(name, 100),
    ...(convTopic(stop.channel) ? { topic: convTopic(stop.channel)! } : {}),
    askedAt: Math.round(stop.at),
    actions: [btn('daemon.needs.tryAgain', 'main', 'routing.retry', [stop.channel])],
  }));
}

/** A notice's `need` names this item: its id, or the start of it (`gwq:<task>` for that task's question). */
export const needMatches = (id: string, need: string): boolean => id === need || id.startsWith(`${need}:`);

/** Everything waiting for you, oldest first: approvals, Claude's questions, friends' requests, plan decisions. */
export function needsYou(state: DomainState): NeedsYou[] {
  const items = allNeeds(state);
  // Oldest first; what has no time (Claude's questions) counts as just asked.
  const at = (n: NeedsYou): number => n.askedAt ?? Number.MAX_SAFE_INTEGER;
  return items.sort((a, b) => at(a) - at(b)).slice(0, 50);
}
