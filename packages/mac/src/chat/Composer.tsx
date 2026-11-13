import type { AgentRef } from '@beluga/protocol.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { waitingNote } from '@beluga/core/friend-share-people.js';
import { type AppState, type View, channelOf, peerName } from '@beluga/core/store.js';
import { localDirKey } from '@beluga/core/local-key.js';
import { workspaceMentions } from '@beluga/core/mentions.js';
import { composeState, queueIn } from '@beluga/ui/compose.js';
import { isRunning } from '@beluga/ui/format.js';
import { localDirOf, mentionDir, openTarget, suggest, type Suggestion } from '@beluga/ui/suggest.js';
import { worktreeMode } from '@beluga/ui/submit.js';
import { roomAgentTags } from '@beluga/shared/agent-tags.js';
import { shareNameOf } from '@beluga/shared/share-names.js';
import { secretIn } from '@beluga/shared/secret-text.js';
import { steeredMessages } from '@beluga/shared/claude-notices.js';
import { fallbackFor, runtimeHas, runtimeHere } from '@beluga/shared/runtime-fallbacks.js';
import { defaultAgentOf } from '@beluga/protocol.js';
import { Icon } from '../components/Icon.js';
import { Kbd, Tip, cx } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { recipientLabel, recipientPrefix, toast, useApi, useApp, useBeluga, useUi, useMachine, useScopedKey } from '../lib/beluga.js';
import { agentName, useAgentNameIn, useMyAgentName } from '../lib/agent-words.js';
import { sameDeep, sameFields } from '../lib/stable.js';
import { getPrefs, usePrefs } from '../lib/prefs.js';
import { sendsToTerminal } from '../lib/convo-mode.js';
import { chordLabel } from '../lib/shortcuts-model.js';
import { cmdReturn, returnName, thisComputer, upFirst, yourComputer } from '../lib/os-words.js';
import { ModelPicker, myRuntime } from './ModelPicker.js';
import { ContextMeter } from './ContextMeter.js';
import { McpChip } from './McpChip.js';
import { RunsOnLabel, RunsOnPicker } from './RunsOn.js';
import { sendToComputer, useStartDeps } from '../machines/start-there.js';
import { QueueTray } from './QueueTray.js';
import { BtwCard, askBtw } from './BtwCard.js';
import { expectClaude, launchFlight } from './flight.js';
import { type WorktreeChoice, WorktreeDraft } from './WorktreeDraft.js';
import { sendSteerNow, stopClaude } from '../lib/commands.js';
import { useAttachments } from './use-attachments.js';
import { CommentCards } from './CommentCards.js';
import { useWaitingComments } from '../views/DiffComment.js';
import { takeComments, withComments } from '../views/diff-comments.js';
import { MentionHighlighter } from './MentionHighlighter.js';
import { useSuggestions } from './Suggestions.js';
import { useMentionWorld, worktreeOf } from './Mention.js';
import { useSkills } from './use-skills.js';
import { MentionedTasks } from './MentionedTasks.js';
import { DictationStrip, MicButton } from './Dictation.js';
import { dictatingInto, useDictation, useDictationTarget } from '../lib/dictation.js';
import { ActionsDropdown } from '../components/SpecMenu.js';
import { openSheet } from '../lib/sheets.js';
import { type ComposeMode, MODE_INFO, nextMode } from './compose-mode.js';
import { isPlanHome, planForHome } from '@beluga/core/plans/model.js';
import { MaxFire } from './MaxFire.js';
import { effectsOn, fireVars } from './fire-look.js';
import { handleInvite } from '../lib/invite-command.js';
import s from './composer.module.css';
import m from './max.module.css';
import d from './draft.module.css';
import { isShortcut } from '../lib/shortcuts.js';
import { shortcutKeys } from '../lib/shortcuts.js';
import { projectOfView } from '../tasks/use-tasks.js';
import { answerSend, answeringIn, sendAction, sendsUrgent, steerBlockNote } from './send-action.js';
import { useSteerBlock } from './use-steer.js';

import { scopedKey } from '../machines/pane-model.js';
import { t } from '@beluga/shared/i18n/index.js';
import { useT } from '../lib/i18n.js';

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Whose unsent words the box holds: a chat's own channel; a new chat or a new worktree its
 * project's page (they all share the channel "draft", so each needs its own).
 */
const draftKeyOf = (view: View): string => (view.kind === 'draft' ? `new-chat:${view.projectId}` : view.kind === 'draft_worktree' ? `new-worktree:${view.projectId}` : channelOf(view));

/** What you left unsent in each chat and on each new chat or new worktree page (kept while the app runs, like the network's chats). */
const drafts = new Map<string, string>();
/** The branch and name picked on each project's new worktree page, kept with its words. */
const worktreeChoices = new Map<string, WorktreeChoice>();
/** Conversations where Plan with Tasks is picked but nothing was sent yet (no plan is made until it is). */
const tasksPicked = new Set<string>();
/** Whose words are in the box now (the window keeps one box's words, `buffer`, for the chat on screen). */
let boxOf: string | undefined;

/** The words in the box, before you start typing: what it does here. */
function placeholderOf(state: AppState, ui: { pending?: { kind: string; projectId: string; peerId?: string } }): string {
  const agent = agentName(defaultAgentOf(state.self));
  const q = state.questions[0];
  if (q && q.channel === channelOf(state.view)) return q.question.kind === 'plan' ? t('composer.placeholder.planAnswer') : t('composer.placeholder.answer');
  const p = ui.pending;
  if (p?.kind === 'peer_run') return t('composer.placeholder.peerRun', { name: peerName(state, p.peerId ?? '') });
  if (p?.kind === 'remote') return t('composer.placeholder.remote');
  if (p?.kind === 'setup') return t('composer.placeholder.setupCommand');
  if (p?.kind === 'run') return t('composer.placeholder.runCommand');
  if (p) {
    const project = state.projects.find((x) => x.id === p.projectId);
    return project?.root ? t('composer.placeholder.newNameIn', { kind: kindWord(p.kind), project: project.name }) : t('composer.placeholder.newName', { kind: kindWord(p.kind) });
  }
  const v = state.view;
  if (v.kind === 'draft') {
    // A chat in a project runs in its main folder: questions only.
    const project = state.projects.find((x) => x.id === v.projectId && x.root);
    return project ? t('composer.placeholder.askAbout', { name: project.name }) : t('composer.placeholder.askAnything', { agent });
  }
  if (v.kind === 'draft_worktree') return t('composer.placeholder.newWorktree', { agent });
  if (v.kind === 'search') return t('composer.placeholder.search');
  if (v.kind === 'assistant') return t('composer.placeholder.assistant', { computer: yourComputer() });
  if (v.kind === 'sentinel_chat') return t('composer.placeholder.sentinel');
  if (v.kind === 'workspace') {
    const ws = state.projects.flatMap((x) => x.workspaces).find((w) => w.id === v.id);
    if (ws?.askOnly) return t('composer.placeholder.askAbout', { name: state.projects.find((x) => x.root && x.workspaces.includes(ws))?.name ?? t('composer.placeholder.thisProject') });
    // The worktree's own agent (a Codex worktree says Codex), else yours.
    return t('composer.placeholder.tellWhat', { agent: ws?.agent ? agentName(ws.agent) : agent, place: ws?.name ?? t('composer.placeholder.thisWorkspace') });
  }
  if (v.kind === 'shared') {
    const w = state.shared.find((x) => x.id === v.id);
    const waiting = waitingNote(state, v.id);
    if (waiting) return waiting;
    return w?.role === 'view' ? t('composer.placeholder.following', { name: w.name }) : t('composer.placeholder.message', { name: w?.name ?? t('composer.placeholder.theWorkspace') });
  }
  return state.peers.length <= 1 ? t('composer.placeholder.messageYour', { agent }) : t('composer.placeholder.room');
}

/** What a name is asked for (a new worktree, chat or group), as said in a sentence. */
function kindWord(kind: string): string {
  return kind === 'worktree' ? t('composer.kind.worktree') : kind === 'chat' ? t('composer.kind.chat') : kind === 'group' ? t('composer.kind.group') : kind;
}

/** Where what you say in a friend's worktree runs (BLG-260): on their Mac (as ever) or in your own copy. */
type RunOn = 'owner' | 'here';
const runOnChoice = new Map<string, RunOn>();

/** In a friend's worktree you have a copy of: "Runs on Ata's Mac" or "on This Mac", one click to switch. */
function RunOnChip({ wsId, ownerName, value, onChange }: { wsId: string; ownerName: string; value: RunOn; onChange: (v: RunOn) => void }) {
  const t = useT();
  const key = useScopedKey(wsId);
  const owner = t('composer.runOn.ownerComputer', { name: ownerName });
  const pick = (v: RunOn): void => {
    runOnChoice.set(key, v);
    onChange(v);
  };
  return (
    <ActionsDropdown
      align="start"
      items={[
        { label: owner, hint: t('composer.runOn.ownerHint'), icon: 'people', checked: value === 'owner', onSelect: () => pick('owner') },
        { label: upFirst(thisComputer()), hint: t('composer.runOn.hereHint'), icon: 'laptop', checked: value === 'here', onSelect: () => pick('here') },
      ]}
    >
      <button type="button" className={cx(s.chip, value === 'here' && s.chipOn)} aria-label={t('composer.runOn.aria', { where: value === 'here' ? thisComputer() : owner })}>
        <Icon name={value === 'here' ? 'laptop' : 'people'} size={12} />
        {value === 'here' ? upFirst(thisComputer()) : owner}
        <Icon name="chevronDown" size={9} />
      </button>
    </ActionsDropdown>
  );
}

/** The slices the same objects, and the box's state (worked out from them) the same. */
function sameComposer<T extends { readonly compose: object }>(a: T, b: T): boolean {
  const { compose: ca, ...ra } = a;
  const { compose: cb, ...rb } = b;
  return sameFields(ra, rb) && sameDeep(ca, cb);
}

export function Composer({ autoFocus = true }: { autoFocus?: boolean }) {
  const t = useT();
  const { ui, client } = useBeluga();
  const api = useApi();
  const actions = useActions();
  const prefs = usePrefs();
  const buffer = useUi((u) => u.buffer);
  const pending = useUi((u) => u.pending);
  const agent = useMyAgentName();
  // Only what the box reads (and what it works out from the rest), so it isn't drawn again for
  // events that change none of it. Worked out on each render too, so the words you type count.
  const state = useApp(
    (full) => ({
      view: full.view,
      log: full.log,
      selfId: full.selfId,
      self: full.self,
      peers: full.peers,
      planMode: full.planMode,
      plans: full.plans,
      projects: full.projects,
      prefs: full.prefs,
      shared: full.shared,
      sharedProjects: full.sharedProjects,
      friends: full.network.friends,
      dirCache: full.dirCache,
      compose: composeState(full, ui.get(), full.selfId, channelOf(full.view), full.view.kind === 'shared'),
      waiting: full.view.kind === 'shared' ? waitingNote(full, full.view.id) : undefined,
      project: projectOfView(full),
      placeholder: placeholderOf(full, pending ? { pending } : {}),
      answering: answeringIn(full.questions, channelOf(full.view)),
    }),
    sameComposer,
  );
  // Addressed to someone (a person's card › Message / Ask Claude): the chip says who; sending says it to them.
  const to = useUi((u) => u.to);
  const ref = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const channel = channelOf(state.view);
  const agentHere = useAgentNameIn(channel);
  const draftKey = draftKeyOf(state.view);
  // The window's memories of this box (its words, Plan with Tasks, a new worktree's branch) are per computer (BLG-784).
  const machine = useMachine();
  const boxKey = scopedKey(machine, draftKey);
  const shared = state.view.kind === 'shared';
  const compose = state.compose;
  const queue = useMemo(() => queueIn(state, channel, state.selfId), [state.log, channel, state.selfId]);
  // Your newest steered message Claude hasn't read yet: ⇧⌥↩ sends it now (BLG-54).
  const unread = useMemo(() => [...steeredMessages(state.log.filter((l) => l.channel === channel)).waiting.values()].filter((x) => x.waiting === 'next_step').at(-1), [state.log, channel]);
  // Images pasted, dropped or named by their path wait as thumbnails above the text, with an
  // "[image N]" where they go; other pasted files as chips (see use-attachments). They wait with
  // the words, so a new chat or worktree page keeps its own too.
  // Comments on the changes waiting above the box (CommentCards): enough to send on their own.
  const commentsWaiting = useWaitingComments(draftKey).length > 0;
  const ready = !!buffer.trim() || commentsWaiting;
  const att = useAttachments({ channel: draftKey, box: ref, text: () => ui.get().buffer, setText: (buffer, cursor) => ui.patch({ buffer, cursor }) });
  // A plan or a question waiting above the box: what you type answers it (the turn is waiting on you, not working).
  const answering = state.answering;
  // During a turn, the preference selects the main action. The secondary action uses the other choice.
  const queueing = compose.busy && !answering && (compose.typing || !buffer.trim());
  // Plan First and agents that can't steer queue with either key (a plan message would stop the turn).
  const steerBlock = useSteerBlock(channel);
  const canSteer = !steerBlock;
  const mainAction = sendAction(prefs.sendDuringTurn, { busy: true, canSteer });
  const otherAction = sendAction(prefs.sendDuringTurn, { busy: true, canSteer, secondary: true });
  const actionTip = (action: string): string => action === 'steer'
    ? `Steer: ${agentHere} reads this at its next step, without stopping`
    : steerBlock === 'plan' ? `Queue: in Plan First, this waits for ${agentHere}'s current turn to finish`
    : steerBlock ? `Queue: ${agentHere} cannot steer. This waits for the current turn to finish` : `Queue: this waits for ${agentHere}'s current turn to finish`;
  const plan = state.planMode[channel] === true;
  // Plan with Tasks: this conversation is a plan's home (milestones and tasks, approved onto the board).
  const homePlan = planForHome(state.plans, channel);
  // Picked but nothing sent yet: only the box knows. The plan is made with the first message, so
  // until then the conversation stays an ordinary one everywhere else (sidebar, Overview, its page).
  // A new worktree's page is picked for by its project (new chats and worktrees all share "draft"):
  // its worktree starts as the plan's home.
  const newWorktree = state.view.kind === 'draft_worktree';
  const tasksKey = newWorktree ? boxKey : scopedKey(machine, channel);
  const [, redraw] = useState(0);
  const armed = !homePlan && tasksPicked.has(tasksKey);
  const arm = (on: boolean): void => {
    if (on === tasksPicked.has(tasksKey)) return;
    if (on) tasksPicked.add(tasksKey);
    else tasksPicked.delete(tasksKey);
    redraw((n) => n + 1);
  };
  // While it's being planned (once approved, the conversation is the plan's head and the box is as usual).
  const drafting = Boolean(homePlan && !homePlan.body);
  const tasksMode = drafting || armed;
  // A draft nobody has asked Claude for yet (nothing in it, nothing said): still just a mode you can leave.
  const untouched = drafting && !homePlan?.draft?.milestones.length && !state.log.some((l) => l.type === 'agent' && l.channel === channel);
  // A plan's own conversation (its head Claude plans and runs it here): no modes to pick, the plan is what it's for.
  const planHome = isPlanHome(state.plans, channel) && !untouched;
  const canPlanTasks = state.plans.enabled && (newWorktree || (channel.startsWith('ws:') && state.projects.some((p) => p.root && p.workspaces.some((w) => `ws:${w.id}` === channel))));
  const mode: ComposeMode = tasksMode ? 'tasks' : plan ? 'plan' : 'act';
  const setMode = (next: ComposeMode): void => {
    const leave = (): void => {
      if ((next === 'plan') !== plan) void api.session.setPlanMode(channel, next === 'plan');
    };
    arm(next === 'tasks' && !homePlan);
    // Leaving a draft plan: an empty one just goes; one with something in it is thrown away only if you say so.
    // (Plan mode waits for it to go: a plan's own conversation has none.)
    if (next !== 'tasks' && drafting && homePlan) {
      const discard = (): void => void api.plans.discard(homePlan.id).then(leave, (err: unknown) => toast(client, errorText(err), 'error'));
      if (!homePlan.draft?.milestones.length) return discard();
      openSheet({ kind: 'confirm', title: t('composer.discard.title'), message: t('composer.discard.message'), confirm: t('composer.discard.confirm'), destructive: true, run: discard });
      return;
    }
    leave();
  };
  // The box's effects (Settings › Fire & Confetti): on Max effort by default, or everywhere.
  // `burning` is the fire itself; without it, only the confetti and pixels fly.
  const effects = !shared && effectsOn(prefs.maxFire, state.prefs.effort);
  const burning = effects && prefs.maxFire.show !== 'off';
  // A friend's worktree you have a copy of (its project shared whole): you pick where it runs.
  const sharedWs = state.view.kind === 'shared' ? state.shared.find((w) => w.id === (state.view as { id: string }).id && w.via === 'mesh') : undefined;
  const copyOf = sharedWs ? state.sharedProjects.find((p) => p.owner === sharedWs.owner && p.id === sharedWs.projectId)?.copy : undefined;
  const canRunHere = Boolean(sharedWs && copyOf?.state === 'ready');
  const [runOnState, setRunOn] = useState<RunOn>('owner');
  const runOn: RunOn = canRunHere && sharedWs ? (runOnChoice.get(scopedKey(machine, sharedWs.id)) ?? runOnState) : 'owner';
  // Following along, or the owner's Mac can't hear you right now (offline, or an old Beluga): the box is locked,
  // unless what you say goes to your own Claude in your copy.
  const readOnly = state.view.kind === 'shared' && state.view.tab === 'chat' && runOn !== 'here' && (sharedWs?.role === 'view' || Boolean(state.waiting));
  // A new worktree: the branch it starts from and its name (empty: named from the task).
  const draftProject = state.view.kind === 'draft_worktree' ? state.view.projectId : undefined;
  // New work (a new chat or worktree): Runs on picks where it goes.
  const newWork = state.view.kind === 'draft_worktree' || state.view.kind === 'draft' ? { project: state.view.projectId === 'chats' ? undefined : state.view.projectId, folder: state.view.kind === 'draft' ? state.view.dir || undefined : undefined } : undefined;
  const startDeps = useStartDeps();
  const choiceKey = draftProject ? scopedKey(machine, draftProject) : undefined;
  const [worktree, setWorktreeState] = useState<WorktreeChoice>(() => (choiceKey && worktreeChoices.get(choiceKey)) || { name: '' });
  useEffect(() => setWorktreeState((choiceKey && worktreeChoices.get(choiceKey)) || { name: '' }), [choiceKey]);
  const setWorktree = (choice: WorktreeChoice): void => {
    if (choiceKey) worktreeChoices.set(choiceKey, choice);
    setWorktreeState(choice);
  };
  // A side question (/btw): "/btw " turns the box into one; it's answered in the card above, never in the chat.
  // Only where its agent has one (it forks the conversation's session: Claude's, OpenCode's; not Codex's).
  const btwHere = useApp((st) => runtimeHas(runtimeHere(st.projects.flatMap((p) => p.workspaces).find((w) => `ws:${w.id}` === channel)?.agent, st.self), 'btw'));
  const canBtw = channel.startsWith('ws:') && !shared && btwHere;
  const [asideIn, setAsideIn] = useState<string | undefined>(undefined);
  const aside = canBtw && asideIn === channel;
  const btwOpen = useApp((st) => Boolean(st.btw?.[channel]));
  const canCreate = Boolean(buffer.trim() && !buffer.trim().startsWith('/')) || Boolean(worktree.name.trim());

  // "@src/au" in a worktree: its folders and files (loaded as you type into a folder).
  const wsId = worktreeOf(channel);
  const atDir = wsId ? mentionDir(buffer) : undefined;
  useEffect(() => {
    if (wsId && atDir !== undefined) void api.files.loadDir({ owner: state.selfId, share: shareNameOf(wsId), path: atDir });
  }, [wsId, atDir, state.selfId]);
  // "@BLG-24": a task on your board (not in a workspace someone shared with you: their Claude has its own).
  const mentionWorld = useMentionWorld(channel, { tasks: !shared, project: state.project });
  // "/fron…": Claude's skills and custom commands here, beside Beluga's commands.
  const skills = useSkills(channel, !shared && buffer.startsWith('/') && !buffer.includes(' '));
  // On Codex they're translated: each says what doesn't carry over (BLG-461).
  const skillsOn = useApp((st) => (fallbackFor(runtimeHere(st.projects.flatMap((p) => p.workspaces).find((w) => w.id === wsId)?.agent, st.self), 'skills') ? 'mapped' : 'native'));

  // Your agents (which run on this Mac), for the room's "@codex" (BLG-520).
  const runtimes = useApp((st) => st.runtimes);
  // Suggestions as you type: commands, people and Claudes, workspaces, folders, tasks.
  const suggestions: Suggestion[] = useMemo(
    () =>
      !buffer
        ? []
        : suggest(buffer, {
            peers: state.peers,
            selfId: state.selfId,
            dirCache: state.dirCache,
            listLocalDirs: (dir) => state.dirCache[localDirKey(dir)] ?? [],
            workspaces: state.view.kind === 'room' ? workspaceMentions(state.projects) : [],
            // In the room: each agent by name, with its mark ("@codex", "@bob:codex", BLG-520).
            ...(state.view.kind === 'room' ? { agentTags: roomAgentTags(state.peers, state.selfId, runtimes) } : {}),
            friends: state.friends,
            projects: state.projects.filter((p) => p.root),
            ...(wsId ? { entries: (dir: string) => state.dirCache[`${state.selfId}:${shareNameOf(wsId)}/${dir}`] } : {}),
            ...(mentionWorld.tasks ? { tasks: mentionWorld.tasks } : {}),
            skills,
            skillsOn,
            ...(canBtw ? {} : { without: ['btw'] }),
          }),
    [buffer, state.peers, state.selfId, state.dirCache, state.view.kind, state.projects, state.friends, wsId, mentionWorld.tasks, skills, skillsOn, canBtw, runtimes],
  );
  const sug = useSuggestions(suggestions, buffer, (picked) => accept(picked));

  // Folders to suggest for "/project add …", and shared files for "/open …".
  const localDir = localDirOf(buffer);
  useEffect(() => {
    if (localDir !== undefined) void api.local.listDirs(localDir);
  }, [localDir]);
  const target = openTarget(buffer, state.peers);
  const targetKey = target ? `${target.owner}:${target.share}/${target.path}` : '';
  useEffect(() => {
    if (target) void api.files.loadDir(target);
  }, [targetKey]);

  // Grow with what you write, up to a dozen lines.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 12 * 20 + 16)}px`;
  }, [buffer]);
  // Each chat keeps its own unsent words: going to another puts its words in the box, never these.
  useLayoutEffect(() => {
    if (boxOf !== undefined && boxOf !== boxKey) {
      const text = drafts.get(boxKey) ?? '';
      ui.patch({ buffer: text, cursor: text.length, historyIndex: -1 });
      sug.reset();
    }
    boxOf = boxKey;
  }, [boxKey]);
  useEffect(() => {
    const text = ui.get().buffer;
    if (text) drafts.set(boxKey, text);
    else drafts.delete(boxKey);
  }, [boxKey, buffer]);
  useEffect(() => {
    const focus = (): void => ref.current?.focus();
    document.addEventListener('beluga:focus-composer', focus);
    return () => document.removeEventListener('beluga:focus-composer', focus);
  }, []);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [state.view, autoFocus]);

  /** The message you were just warned holds a secret. */
  const secretWarned = useRef<string | undefined>(undefined);
  const set = (raw: string): void => {
    const btw = canBtw && !aside ? /^\/btw\s+/.exec(raw) : null;
    if (btw) setAsideIn(channel);
    const text = btw ? raw.slice(btw[0].length) : raw;
    ui.patch({ buffer: text, cursor: text.length });
    sug.reset();
  };
  /** The first message of a new worktree starts it (on the chosen branch, with the chosen name). */
  const createWorktree = (projectId: string, text: string): void => {
    const name = worktree.name.trim();
    // Seen as its terminal (Settings › Terminal): the terminal opens on this message (BLG-553).
    const terminal = Boolean(text.trim()) && sendsToTerminal(client.store.getState(), getPrefs(), 'draft', worktree.agent?.runtime);
    // Started in the mode the picker shows (Act, Plan First or Plan with Tasks).
    const mode = worktreeMode({ terminal, plan: client.store.getState().planMode.draft === true, tasks: armed });
    const opts = { ...(worktree.base ? { base: worktree.base } : {}), ...(name ? { name } : {}), ...(worktree.agent ? { agent: worktree.agent } : {}), ...mode };
    // Runs on one of your computers (BLG-788): made there, in the same project, and opened at once.
    // Held (the computer Runs on names can't take it now): nothing starts, the words stay in the box.
    const sent = sendToComputer(startDeps, projectId, worktree.agent?.runtime ?? myRuntime(client.store.getState().prefs), { kind: 'worktree', text, opts });
    if (sent === 'held') return keepWords(text);
    // Its words left the box when it was sent; its branch and name go with them.
    worktreeChoices.delete(scopedKey(machine, projectId));
    setWorktreeState({ name: '' });
    arm(false);
    if (sent === 'sent') return;
    void api.workspaces.startWorktree(projectId, text, { ...(worktree.base ? { base: worktree.base } : {}), ...(name ? { name } : {}), ...(worktree.agent ? { agent: worktree.agent } : {}), ...mode }).catch((err: unknown) => toast(client, t('composer.toast.worktreeFailed', { error: errorText(err) }), 'error'));
  };
  /** Held for a computer that can't take it now: the words go back in the box, nothing was sent. */
  const keepWords = (text: string): void => {
    if (!ui.get().buffer) ui.patch({ buffer: text, cursor: text.length });
  };
  const deliver = (text: string, urgent: boolean): void => {
    if (readOnly) return;
    if (runOn === 'here' && sharedWs && !text.startsWith('/')) {
      set('');
      void api.sharing.runHere(sharedWs.owner, sharedWs.id, text).catch((err: unknown) => toast(client, t('composer.toast.runHereFailed', { error: errorText(err) }), 'error'));
      return;
    }
    // /invite adds a friend, or adds friends to what's on screen (BLG-203): done here, where the view is known.
    if (handleInvite(client, ui, text)) return;
    if (draftProject && !text.startsWith('/')) return createWorktree(draftProject, text);
    // A new chat (in a project, outside one, or in a folder), Runs on one of your computers (BLG-788,
    // BLG-841): started there; held, never here instead, when the computer named can't take it.
    const v = client.store.getState().view;
    if (v.kind === 'draft' && !text.startsWith('/')) {
      const sent = sendToComputer(startDeps, v.projectId, myRuntime(client.store.getState().prefs), { kind: 'chat', text }, v.dir || undefined);
      if (sent === 'held') return keepWords(text);
      if (sent === 'sent') return;
    }
    if (to && !text.startsWith('/')) {
      ui.patch({ to: undefined });
      return actions.submit(`${recipientPrefix(to)}${text}`, urgent);
    }
    // Plan with Tasks, first message: the plan is made now, and this is what Claude plans from.
    if (armed && !text.startsWith('/')) {
      api.plans.here(channel).then(
        () => (arm(false), actions.submit(text, urgent)),
        (err: unknown) => {
          if (!ui.get().buffer) ui.patch({ buffer: text, cursor: text.length });
          toast(client, errorText(err), 'error');
        },
      );
      return;
    }
    actions.submit(text, urgent);
  };
  const send = (secondary = false): void => {
    const urgent = sendsUrgent(prefs.sendDuringTurn, { busy: queueing, canSteer, secondary });
    const typed = buffer.trim();
    if (aside) {
      if (!typed) return;
      askBtw(client, api, channel, typed);
      setAsideIn(undefined);
      ui.patch({ buffer: '', cursor: 0, history: [...ui.get().history, `/btw ${typed}`].slice(-200), historyIndex: -1 });
      return;
    }
    // A password on its way to the whole room: stop once and say where it belongs (sending again sends it).
    const secret = state.view.kind === 'room' && !typed.startsWith('/') ? secretIn(typed) : undefined;
    if (secret && secretWarned.current !== typed) {
      secretWarned.current = typed;
      toast(client, t('composer.toast.secret', { secret, agent }), 'warn');
      return;
    }
    secretWarned.current = undefined;
    // Images stay where you referenced them in the words; any you took the reference out of go after them.
    const { text: words, images, shown, putBack: putFilesBack } = att.take(typed);
    // Comments on the changes waiting above the box go after the words (views/diff-comments.ts).
    const notes = typed.startsWith('/') ? undefined : takeComments(draftKey);
    const text = withComments(words, notes?.comments ?? []);
    const putBack = (): void => {
      putFilesBack();
      notes?.putBack();
    };
    if (!text && !(draftProject && worktree.name.trim())) {
      if (draftProject) toast(client, t('composer.toast.describeTask'), 'info');
      return;
    }
    if (!text && draftProject) return createWorktree(draftProject, '');
    // The words fly from the box into the chat (or into the queue while Claude works): see flight.ts.
    if (typed && !typed.startsWith('/') && !draftProject && !pending) {
      const live = state.log.some((l) => l.type === 'agent' && l.channel === channel && isRunning(l.status));
      launchFlight({ channel, target: queueing && compose.typing && !urgent ? 'queue' : 'chat', text: typed, from: ref.current, live });
      // Steering joins the turn Claude is on (no new card to wait for).
      if (compose.typing && !compose.busy) expectClaude(channel, state.log.filter((l) => l.type === 'agent' && l.channel === channel).length);
    }
    ui.patch({ buffer: '', cursor: 0, history: [...ui.get().history, typed].slice(-200), historyIndex: -1 });
    // Image chips become links to the images (Beluga keeps them) before the message goes.
    if (text.includes('[image ') && !text.startsWith('/')) {
      api.attachments.expand(text, channel, [...images], [...shown]).then(
        (expanded) => deliver(expanded, urgent),
        (err: unknown) => {
          // Put the message and its images back so nothing is lost.
          if (!ui.get().buffer) ui.patch({ buffer: typed, cursor: typed.length });
          putBack();
          toast(client, t('composer.toast.imagesFailed', { error: errorText(err) }), 'error');
        },
      );
      return;
    }
    deliver(text, urgent);
  };
  // Speaking instead of typing (Settings › Voice): the words come here when this is the box you're in; Send right away sends them as ↩ would.
  useDictationTarget(ref, () => send(false), draftKey);
  const dictation = useDictation();
  const talking = dictation.kind !== 'off' && dictatingInto(ref.current);
  /** A queued message pulled back to edit: into the box, ahead of anything already there. */
  const editQueued = async (sent: string): Promise<void> => {
    // Its images wait above the box again, each an "[image N]" in the words (not the link it went as).
    const prompt = await att.restore(sent);
    const toClaude = channel === 'room' && state.peers.length > 1 && !prompt.startsWith('@') ? `@claude ${prompt}` : prompt;
    const current = ui.get().buffer.trim();
    set(current ? `${toClaude}\n${current}` : toClaude);
    ref.current?.focus();
  };
  const sendKeys = prefs.sendWith === 'enter' ? '↩' : chordLabel('Cmd+Enter');
  function accept(picked: Suggestion): void {
    if (picked.enter === 'submit') {
      ui.patch({ buffer: '', cursor: 0 });
      // A friend picked for "/invite": handled here like a typed one (BLG-340), not by the daemon.
      if (!handleInvite(client, ui, picked.value)) actions.submit(picked.value);
      return;
    }
    set(picked.value);
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter while an input method is composing (Japanese, Chinese…) picks the characters.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    // Shift-Tab switches between acting and planning first, as in Claude Code (not focus).
    if (isShortcut('composer-mode', e) && !shared && !planHome) {
      e.preventDefault();
      setMode(nextMode(mode));
      return;
    }
    const modKey = e.metaKey || e.ctrlKey;
    if (sug.onKeyDown(e)) return;
    if (att.onRefKey(e)) return;
    // Backspace in an empty side question: back to an ordinary message.
    if (aside && e.key === 'Backspace' && !buffer) {
      e.preventDefault();
      setAsideIn(undefined);
      return;
    }
    if (e.key === 'Escape') {
      if (aside) setAsideIn(undefined);
      else if (pending) ui.patch({ pending: undefined, buffer: '' });
      else if (to) ui.patch({ to: undefined });
      else if (btwOpen && !buffer) void api.session.btwDismiss(channel);
      else if (state.view.kind === 'draft' || state.view.kind === 'draft_worktree') client.store.dispatch({ type: 'view', view: state.view.back });
      return;
    }
    // ⇧⌥↩: the steered message Claude hasn't read yet goes now (its step stops); what's in the box stays.
    if (unread && isShortcut('composer-send-now', e)) {
      e.preventDefault();
      sendSteerNow(client, unread.request);
      return;
    }
    // ⌥↩ uses the other send action during a turn (outside one, with Queue as the default, it goes first in line).
    if (isShortcut('composer-steer', e)) {
      e.preventDefault();
      send(true);
      return;
    }
    if (e.key === 'Enter') {
      const sends = prefs.sendWith === 'enter' ? !e.shiftKey && !modKey : modKey;
      // A ⌥ chord that isn't steering is no Send.
      if (e.altKey) return;
      if (sends) {
        e.preventDefault();
        send(false);
      }
      return;
    }
    // ↑ on an empty box brings back what you sent last.
    if (e.key === 'ArrowUp' && !buffer) {
      const h = ui.get().history;
      if (h.length) {
        e.preventDefault();
        set(h[h.length - 1]!);
      }
    }
  };
  const askingFor = pending
    ? pending.kind === 'peer_run'
      ? t('composer.asking.command')
      : pending.kind === 'remote'
        ? t('composer.asking.task')
        : pending.kind === 'setup'
          ? t('composer.asking.setup')
          : pending.kind === 'run'
            ? t('composer.asking.run')
            : t('composer.asking.new', { kind: kindWord(pending.kind) })
    : undefined;

  return (
    <div className={s.wrap}>
      {att.dropTarget}
      {sug.list}
      {canBtw ? <BtwCard channel={channel} /> : null}
      <QueueTray queue={queue} selfName={state.self?.name ?? ''} onEdit={(prompt) => void editQueued(prompt)} />
      <div
        ref={boxRef}
        style={effects ? (fireVars(prefs.maxFire) as React.CSSProperties) : undefined}
        data-fire={burning ? prefs.maxFire.show : undefined}
        className={cx(s.box, burning ? (prefs.maxFire.border ? m.max : m.maxPlain) : effects && m.fxOnly, pending && s.asking, readOnly && s.readOnly, att.dropping && s.dropping, (plan || tasksMode || aside || answering === 'plan') && s.planning)}
        data-plan={plan || tasksMode || aside || answering === 'plan' || undefined}
        data-mode={aside ? 'btw' : answering === 'plan' ? 'plan' : mode}
        {...att.dropProps}
      >
        {effects ? <MaxFire box={boxRef} input={ref} /> : null}
        {aside ? (
          <div className={s.planBanner} role="status">
            <span className={s.planTag}>
              <Icon name="sparkles" size={11} />
              {t('composer.btw.tag')}
            </span>
            <span className={s.planHint}>{t('composer.btw.hint', { agent: agentHere })}</span>
            <span className={s.flex} />
            <span className={s.planKeys}>
              <Kbd>esc</Kbd> {t('composer.btw.leave')}
            </span>
          </div>
        ) : answering === 'plan' ? (
          <div className={s.planBanner} role="status">
            <span className={s.planTag}>
              <Icon name="wand" size={11} />
              {t('composer.review.tag')}
            </span>
            <span className={s.planHint}>{t('composer.review.hint', { agent: agentHere })}</span>
          </div>
        ) : mode !== 'act' ? (
          <div className={s.planBanner} role="status">
            <span className={s.planTag}>
              <Icon name={mode === 'tasks' ? 'graph' : 'wand'} size={11} />
              {mode === 'plan' ? t('composer.mode.planning') : MODE_INFO[mode].label}
            </span>
            <span className={s.planHint}>{MODE_INFO[mode].banner}</span>
            <span className={s.flex} />
            {mode === 'tasks' && homePlan ? (
              <button type="button" className={s.planLink} onClick={() => actions.run({ type: 'view', view: { kind: 'plan', id: homePlan.id } })}>
                {t('composer.mode.openPlan')}
              </button>
            ) : planHome ? null : (
              <span className={s.planKeys}>
                <Kbd>{shortcutKeys('composer-mode')}</Kbd> {t('composer.mode.toAct')}
              </span>
            )}
          </div>
        ) : null}
        {draftProject ? <WorktreeDraft projectId={draftProject} choice={worktree} onChange={setWorktree} /> : null}
        {to ? (
          <div className={s.askChip} aria-label={t('composer.to', { name: recipientLabel(to) })}>
            {t('composer.to', { name: recipientLabel(to) })}
            <button type="button" aria-label={t('composer.unaddress')} onClick={() => ui.patch({ to: undefined })}>
              <Icon name="x" size={10} />
            </button>
          </div>
        ) : null}
        {askingFor ? (
          <div className={s.askChip}>
            {askingFor}
            <button type="button" aria-label={t('common.cancel')} onClick={() => ui.patch({ pending: undefined, buffer: '' })}>
              <Icon name="x" size={10} />
            </button>
          </div>
        ) : null}
        {att.waiting}
        <CommentCards box={draftKey} />
        <MentionedTasks text={buffer} world={mentionWorld} />
        <DictationStrip box={ref} />
        <div className={s.inputWrap}>
          <MentionHighlighter text={buffer} world={mentionWorld} input={ref} className={s.input ?? ""} />
          <textarea
            ref={ref}
            className={`${s.input} ${s.overHighlight} selectable`}
            rows={1}
            value={buffer}
            disabled={readOnly}
            placeholder={aside ? t('composer.placeholder.askSide', { agent: agentHere }) : to ? t('composer.placeholder.message', { name: recipientLabel(to) }) : mode === 'tasks' && !homePlan?.body && !homePlan?.draft?.milestones.length ? t('composer.placeholder.describeBuild', { agent }) : state.placeholder}
            onChange={(e) => set(e.target.value)}
            onKeyDown={onKey}
            onPaste={att.onPaste}
            spellCheck
          />
        </div>
        <div className={s.bar}>
          {planHome && homePlan ? (
            <ActionsDropdown
              align="start"
              items={[
                { label: t('composer.plan.open'), onSelect: () => actions.run({ type: 'view', view: { kind: 'plan', id: homePlan.id } }) },
                // While it's a draft nothing is on the board: it can go (asked first when it has something in it).
                ...(tasksMode ? [{ label: t('composer.plan.discard'), danger: true, separate: true, onSelect: () => setMode('act') }] : []),
              ]}
            >
              <button type="button" className={cx(s.chip, s.chipOn)} title={t('composer.plan.own')} aria-label={t('composer.mode.aria', { mode: MODE_INFO.tasks.label })}>
                <Icon name="graph" size={12} />
                {tasksMode ? MODE_INFO.tasks.label : t('composer.plan.chip')}
                <Icon name="chevronDown" size={9} />
              </button>
            </ActionsDropdown>
          ) : !shared ? (
            <ActionsDropdown
              align="start"
              items={(['act', 'plan', 'tasks'] as const)
                .filter((m) => m !== 'tasks' || canPlanTasks || tasksMode)
                .map((m) => ({ label: MODE_INFO[m].label, hint: MODE_INFO[m].hint, checked: mode === m, onSelect: () => setMode(m) }))}
            >
              <button type="button" className={cx(s.chip, mode !== 'act' && s.chipOn)} title={mode === 'tasks' ? MODE_INFO[mode].hint : t('composer.mode.title', { hint: MODE_INFO[mode].hint, keys: shortcutKeys('composer-mode') ?? t('composer.mode.keyboardSetting') })} aria-label={t('composer.mode.aria', { mode: MODE_INFO[mode].label })}>
                <Icon name={mode === 'tasks' ? 'graph' : 'wand'} size={12} />
                <span className={s.chipLabel}>{MODE_INFO[mode].label}</span>
                <Icon name="chevronDown" size={9} />
              </button>
            </ActionsDropdown>
          ) : null}
          {canRunHere && sharedWs ? <RunOnChip wsId={sharedWs.id} ownerName={state.sharedProjects.find((p) => p.owner === sharedWs.owner)?.ownerName ?? t('composer.runOn.their')} value={runOn} onChange={setRunOn} /> : null}
          {!shared ? <ModelPicker channel={channel} {...(draftProject ? { draft: worktree.agent, onDraft: (agent: AgentRef | undefined) => setWorktree({ ...worktree, agent }) } : {})} /> : null}
          {/* Where new work runs (BLG-786); a chat that runs somewhere already says where. Only with a computer paired. */}
          {shared ? null : newWork ? <RunsOnPicker {...(newWork.project ? { project: newWork.project } : {})} {...(worktree.agent?.runtime && draftProject ? { runtime: worktree.agent.runtime } : {})} {...(newWork.folder ? { folder: newWork.folder } : {})} /> : <RunsOnLabel />}
          {burning && state.prefs.effort === 'max' ? (
            <Tip label={t('composer.max.tip', { agent: agentHere })}>
              <span className={m.tag}>
                <Icon name="flame" size={11} className={m.flicker} />
                {t('composer.max.tag')}
              </span>
            </Tip>
          ) : null}
          <span className={s.flex} />
          {/* Your MCP servers, on the box's right beside how full the context is (BLG-252). */}
          {!shared ? <McpChip /> : null}
          {channel !== 'draft' ? <ContextMeter channel={channel} /> : null}
          {/* While you talk, only your voice's control shows: two square buttons side by side stopped Claude by mistake. */}
          {compose.busy && !talking ? (
            <Tip label={t('composer.stop.tip', { agent: agentHere })} keys={shortcutKeys('conv-stop')}>
              <button type="button" className={s.stop} aria-label={t('composer.stop.aria', { agent: agentHere })} onClick={() => stopClaude({ client, ui, actions }, channel)}>
                <span className={s.stopMark} />
              </button>
            </Tip>
          ) : null}
          {!readOnly ? <MicButton box={ref} /> : null}
          {draftProject ? (
            <Tip label={worktree.name.trim() && !buffer.trim() ? t('composer.create.bare', { name: worktree.name.trim() }) : t('composer.create.tip', { agent: worktree.agent ? agentName(worktree.agent) : agent })} keys={sendKeys}>
              <button type="button" className={cx(d.create, canCreate && d.createReady)} onClick={() => send(false)} aria-disabled={!canCreate}>
                <Icon name="branch" size={12} />
                {t('composer.create.button')}
                <span className={d.createKey}>{sendKeys}</span>
              </button>
            </Tip>
          ) : aside ? (
            <Tip label={t('composer.side.tip')} keys={sendKeys}>
              <button type="button" className={cx(s.send, buffer.trim() && s.sendReady)} onClick={() => send(false)} aria-label={t('composer.side.aria')} disabled={!buffer.trim()}>
                <Icon name="send" size={14} />
              </button>
            </Tip>
          ) : answering ? (
            <Tip label={answerSend(answering, agentHere).tip} keys={sendKeys}>
              <button type="button" className={cx(s.split, s.answer, ready && s.splitReady)} onClick={() => send(false)} disabled={!ready}>
                <Icon name="send" size={12} />
                <span className={s.chipLabel}>{answerSend(answering, agentHere).label}</span>
              </button>
            </Tip>
          ) : queueing ? (
            <div className={cx(s.split, buffer.trim() && s.splitReady)} role="group" aria-label={t('composer.working', { agent: agentHere })}>
              <Tip label={actionTip(mainAction)} keys={sendKeys}>
                <button type="button" className={s.splitMain} aria-label={upFirst(mainAction)} onClick={() => send(false)} disabled={!ready}>
                  <Icon name={mainAction === 'steer' ? 'send' : 'clock'} size={12} />
                  <span className={s.chipLabel}>{upFirst(mainAction)}</span>
                </button>
              </Tip>
              {canSteer ? <Tip label={actionTip(otherAction)} keys={shortcutKeys('composer-steer')}>
                <button type="button" className={s.splitAlt} onClick={() => send(true)} disabled={!ready}>
                  {upFirst(otherAction)}
                </button>
              </Tip> : null}
            </div>
          ) : (
            <Tip label={prefs.sendWith === 'enter' ? t('composer.send.enter', { key: returnName() }) : t('composer.send.cmd', { keys: cmdReturn() })} keys={prefs.sendWith === 'enter' ? '↩' : chordLabel('Cmd+Enter')}>
              <button type="button" className={cx(s.send, ready && s.sendReady)} onClick={() => send(false)} aria-label={t('common.send')} disabled={!ready}>
                <Icon name="send" size={14} />
              </button>
            </Tip>
          )}
        </div>
      </div>
      {/* Keys are shown only when they change what Return does (Mac apps don't keep a legend up). */}
      {(queueing && !aside) || draftProject ? (
      <div className={s.legend}>
        {queueing ? (
          <>
            <Kbd>{sendKeys}</Kbd> {mainAction} ·{canSteer && shortcutKeys('composer-steer') ? (
              <>
                {' '}
                <Kbd>{shortcutKeys('composer-steer')}</Kbd> {otherAction} ·
              </>
            ) : null}
            {steerBlock ? ` ${steerBlockNote(steerBlock)} · ` : null}
            {unread && shortcutKeys('composer-send-now') ? (
              <>
                {' '}
                <Kbd>{shortcutKeys('composer-send-now')}</Kbd> {t('composer.legend.sendNow')} ·
              </>
            ) : null}
            {shortcutKeys('conv-stop') ? (
              <>
                {' '}
                <Kbd>{shortcutKeys('conv-stop')}</Kbd> {t('composer.legend.stop')}
              </>
            ) : null}
            {canBtw ? (
              <>
                {' '}
                {/* i18n-ignore */}
                · <Kbd>/btw</Kbd> {t('composer.legend.askSide')}
              </>
            ) : null}
          </>
        ) : (
          <>
            <Kbd>{sendKeys}</Kbd> {t('composer.legend.createWorktree')} · <Kbd>esc</Kbd> {t('composer.legend.cancel')}
          </>
        )}
      </div>
      ) : null}
    </div>
  );
}
