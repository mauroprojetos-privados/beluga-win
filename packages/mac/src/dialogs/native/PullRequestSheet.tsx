import { useState } from 'react';
import type { PrCheck, PullRequest } from '@beluga/core/work-store.js';
import { notOnPr } from '@beluga/core/branch-state.js';
import type { AppState } from '@beluga/core/store.js';
import type { MergeMethod } from '@beluga/workspaces/pr.js';
import { findWorkspace } from '@beluga/ui/workspace-models.js';
import { CommandLine, Field, FormSheet, TextArea, formStyles as f } from '../../components/FormSheet.js';
import { Icon } from '../../components/Icon.js';
import { ActionsDropdown } from '../../components/SpecMenu.js';
import { Button, Tip, cx } from '../../components/ui.js';
import { useActions } from '../../lib/actions.js';
import { toast, useApi, useApp, useBeluga } from '../../lib/beluga.js';
import { MERGE_METHODS, canAutoMerge, canSkipChecks, checkDuration, checkTone, checksSummary, sortChecks } from '../../lib/pr-checks.js';
import { openExternal } from '../../lib/system.js';
import { showGitTrouble } from '../../lib/git-trouble.js';
import { askBeforeWork } from '../../lib/work-confirm.js';
import { useClock } from '../../lib/window-active.js';
import type { NativeMenuProps } from './index.js';
import { usePick } from './pick.js';
import { openPrPage } from '../../pr/use-pr-conversation.js';
import s from './menus.module.css';
import { cmdReturn } from '../../lib/os-words.js';
import { t } from '@beluga/shared/i18n/index.js';
import { useT } from '../../lib/i18n.js';
import { slotted } from './parts.js';

const STATE = (): Record<PullRequest['state'], string> => ({ OPEN: t('native.pr.stateOpen'), CLOSED: t('native.pr.stateClosed'), MERGED: t('native.pr.stateMerged') });
const CHECKS = (): Record<PullRequest['checks'], { label: string; tone?: string; icon?: 'check' | 'x' | 'clock' }> => ({
  passing: { label: t('native.pr.checksPassed'), tone: s.pillOk, icon: 'check' },
  failing: { label: t('native.pr.checksFailed'), tone: s.pillBad, icon: 'x' },
  pending: { label: t('native.pr.checksRunning'), tone: s.pillWait, icon: 'clock' },
  none: { label: t('native.pr.noChecks') },
});
const REVIEW = () => ({ APPROVED: { label: t('native.pr.approved'), tone: s.pillOk }, CHANGES_REQUESTED: { label: t('native.pr.changesRequested'), tone: s.pillBad }, REVIEW_REQUIRED: { label: t('native.pr.waitingForReview'), tone: undefined } }) as const;

/** The way you last merged (squash until you pick another). */
const METHOD_KEY = 'beluga.mergeMethod';
export function lastMethod(): MergeMethod {
  try {
    const m = localStorage.getItem(METHOD_KEY);
    return m === 'merge' || m === 'rebase' ? m : 'squash';
  } catch {
    return 'squash';
  }
}

export function rememberMethod(how: MergeMethod): void {
  try {
    localStorage.setItem(METHOD_KEY, how);
  } catch {
    // No storage: squash next time.
  }
}

/** Each CI check, live: spinner while it runs, ✓ or ✗ when done, how long, and its page. */
export function CheckList({ checks, summary = true }: { checks: readonly PrCheck[]; summary?: boolean }) {
  const running = checks.some((c) => c.state === 'in_progress');
  // Running checks count up, only while you're looking (KLD-40).
  const now = useClock(running);
  const t = useT();
  return (
    <div className={s.checks}>
      {summary ? <div className={s.checksHead}>{checksSummary(checks)}</div> : null}
      <ul className={s.checkList} aria-label={t('native.pr.checks')}>
        {sortChecks(checks).map((c, i) => {
          const tone = checkTone(c);
          const time = checkDuration(c, now);
          return (
            <li key={`${c.workflow ?? ''}/${c.name}/${i}`} className={s.checkRow} data-check={tone}>
              <span className={cx(s.checkIcon, s[`check_${tone}`])} aria-label={tone}>
                {tone === 'running' ? <span className={s.spinner} /> : <Icon name={tone === 'passed' ? 'check' : tone === 'failed' ? 'x' : tone === 'queued' ? 'clock' : 'minus'} size={12} />}
              </span>
              <span className={s.checkName} title={c.workflow ? `${c.workflow} / ${c.name}` : c.name}>
                {c.workflow ? <span className={s.checkWorkflow}>{c.workflow} / </span> : null}
                {c.name}
              </span>
              <span className={s.checkTime}>{tone === 'queued' ? t('native.pr.queued') : time}</span>
              {c.url ? (
                <button type="button" className={s.checkLink} aria-label={t('native.pr.openCheckOnGitHub', { name: c.name })} title={t('native.pr.detailsOnGitHub')} onClick={() => void openExternal(c.url!)}>
                  <Icon name="external" size={11} />
                </button>
              ) : (
                <span className={s.checkLink} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Merge on GitHub: the button merges the way you last did (squash at first); its menu picks
 * another way, "Merge When Checks Pass" while something is still to come, or "Merge Now,
 * Skipping Checks" (an admin's override) when checks or a review are in the way.
 */
export function MergeButton({ wsId, pr, onError, size }: { wsId: string; pr: PullRequest; onError: (message: string | undefined) => void; size?: 'small' }) {
  const api = useApi();
  const t = useT();
  const [method, setMethod] = useState<MergeMethod>(lastMethod);
  const [busy, setBusy] = useState(false);
  // Commits here the PR doesn't have (BLG-840): never merged without them. Push and Merge pushes
  // them, then merges once their checks pass (the daemon pushes first whichever way you merge).
  const gap = useApp((st) => unpushedOnPr(st, wsId, pr));
  const merge = async (how: MergeMethod, picked?: 'auto' | 'admin'): Promise<void> => {
    const mode = picked ?? (gap ? 'auto' : undefined);
    if (busy) return;
    setMethod(how);
    rememberMethod(how);
    setBusy(true);
    onError(undefined);
    try {
      const out = await api.workbench.mergePr(wsId, { method: how, ...(mode ? { [mode]: true } : {}) });
      // Couldn't reach GitHub: its card (why, and the fix) instead of the line.
      if (out && !out.ok && !showGitTrouble(wsId, out, 'none')) onError(out.message);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const chosen = MERGE_METHODS.find((m) => m.method === method)!;
  const auto = canAutoMerge(pr);
  const skip = canSkipChecks(pr);
  const lower = chosen.label.toLowerCase();
  const items = [
    ...MERGE_METHODS.map((m) => ({ label: m.label, hint: gap ? t('native.pr.pushThenMergeHint', { count: gap }) : m.hint, checked: m.method === method, onSelect: () => void merge(m.method) })),
    ...(auto && !gap ? [{ label: t('native.pr.mergeWhenChecksPass'), hint: t('native.pr.mergeWhenChecksPassHint', { method: chosen.label }), separate: true, onSelect: () => void merge(method, 'auto') }] : []),
    ...(skip ? [{ label: gap ? t('native.pr.pushMergeNowSkipping') : t('native.pr.mergeNowSkipping'), hint: gap ? t('native.pr.skipHintPush', { count: gap, method: lower }) : t('native.pr.skipHint', { method: chosen.label }), danger: true, separate: Boolean(gap), onSelect: () => void merge(method, 'admin') }] : []),
  ];
  const tip = pr.draft ? t('native.pr.draftTip') : gap ? t('native.pr.gapTip', { count: gap, number: pr.number, method: lower }) : t('native.pr.methodOnGitHub', { method: chosen.label });
  return (
    <span className={s.split} role="group" aria-label={t('native.pr.mergeOnGitHub')}>
      <Tip label={tip}>
        <Button variant="merge" icon={gap ? 'up' : 'merge'} size={size ?? 'regular'} className={s.splitMain} disabled={busy || pr.draft} data-merge-github={method} data-push-first={gap || undefined} onClick={() => void merge(method)}>
          {busy ? (gap ? t('native.pr.pushing') : t('native.pr.merging')) : gap ? t('native.pr.pushAndMerge') : t('native.pr.mergeOnGitHub')}
        </Button>
      </Tip>
      <ActionsDropdown items={items} align="start">
        <Button variant="merge" size={size ?? 'regular'} className={s.splitMore} disabled={busy || pr.draft} aria-label={t('native.pr.moreWaysToMerge')}>
          <Icon name="chevronDown" size={11} />
        </Button>
      </ActionsDropdown>
    </span>
  );
}

/** Commits in this worktree its open PR doesn't have (0: none), as the branch pill counts them. */
function unpushedOnPr(st: AppState, wsId: string, pr: PullRequest): number {
  const ws = findWorkspace(st.projects, wsId);
  return ws ? (notOnPr(pr, ws)?.count ?? 0) : 0;
}

/** GitHub can't merge a PR that conflicts with its base: Claude resolves it in the chat (asks first). */
export function ResolveConflictsButton({ wsId, size }: { wsId: string; size?: 'small' }) {
  const t = useT();
  return (
    <Tip label={t('native.pr.resolveTip')}>
      <Button variant="danger" icon="merge" size={size ?? 'regular'} data-pr-next="resolve" onClick={() => askBeforeWork(wsId, 'resolve_pr')}>
        {t('native.pr.resolveConflicts')}
      </Button>
    </Tip>
  );
}

/**
 * Once the PR merged, the worktree is done: Archive Worktree puts it away; its menu carries on
 * here instead (Continue After Merge: a new PR next), or deletes it.
 */
export function AfterMergeButton({ wsId, size }: { wsId: string; size?: 'small' }) {
  const actions = useActions();
  const t = useT();
  const items = [
    { label: t('native.pr.continueAfterMerge'), hint: t('native.pr.continueAfterMergeHint'), onSelect: () => askBeforeWork(wsId, 'continue_after_merge') },
    { label: t('native.pr.deleteWorktree'), hint: t('native.pr.deleteWorktreeHint'), danger: true, onSelect: () => actions.run({ type: 'ws', id: wsId, action: 'delete' }) },
  ];
  return (
    <span className={s.split} role="group" aria-label={t('native.pr.afterTheMerge')}>
      <Button variant="primary" icon="archive" size={size ?? 'regular'} className={s.splitMain} data-pr-next="archive" onClick={() => actions.run({ type: 'ws', id: wsId, action: 'archive' })}>
        {t('native.pr.archiveWorktree')}
      </Button>
      <ActionsDropdown items={items} align="start">
        <Button variant="primary" size={size ?? 'regular'} className={s.splitMore} aria-label={t('native.pr.otherWaysToFinish')}>
          <Icon name="chevronDown" size={11} />
        </Button>
      </ActionsDropdown>
    </span>
  );
}

/** The PR you have: its state and checks at a glance, and what to do next. */
function PrCard({ wsId, pr, pick, refresh, close }: { wsId: string; pr: PullRequest; pick: (id: string) => boolean; refresh: () => void; close: () => void }) {
  const actions = useActions();
  const t = useT();
  const [error, setError] = useState<string>();
  const checks = CHECKS()[pr.checks];
  const review = pr.review ? REVIEW()[pr.review] : undefined;
  const open = pr.state === 'OPEN';
  // Beluga waits for the checks and merges then (Merge When Checks Pass), or GitHub's own auto-merge is on.
  const waiting = useApp((st) => Boolean(st.projects.flatMap((p) => p.workspaces).find((w) => w.id === wsId)?.mergeWhenReady));
  const gap = useApp((st) => unpushedOnPr(st, wsId, pr));
  const changed = useApp((st) => findWorkspace(st.projects, wsId)?.status?.changed ?? 0);
  return (
    <div className={s.pr} data-pr-state={pr.state}>
      <div className={s.prTop}>
        <Icon name={pr.state === 'MERGED' ? 'merge' : 'pr'} size={15} />
        <span className={s.prNumber}>#{pr.number}</span>
        <span className={cx(s.prTitle, 'selectable')} title={pr.title}>
          {pr.title}
        </span>
        <Button size="small" variant="quiet" icon="refresh" aria-label={t('native.pr.refreshStatus')} onClick={refresh} />
      </div>
      <div className={s.prMeta}>
        <span className={cx(s.pill, pr.state === 'MERGED' && s.pillOk)}>
          {pr.state === 'MERGED' ? <Icon name="merge" size={11} /> : null}
          {pr.draft && open ? t('native.pr.draft') : STATE()[pr.state]}
        </span>
        {open ? (
          <span className={cx(s.pill, checks.tone)}>
            {checks.icon ? <Icon name={checks.icon} size={11} /> : null}
            {checks.label}
          </span>
        ) : null}
        {review && open ? <span className={cx(s.pill, review.tone)}>{review.label}</span> : null}
        {open && pr.conflicts ? <span className={cx(s.pill, s.pillBad)}>{t('native.pr.conflictsWithBase')}</span> : null}
        {open && gap ? (
          <span className={cx(s.pill, s.pillWait)} data-not-on-pr={gap}>
            <Icon name="up" size={11} />
            {t('native.pr.notOnItYet', { count: gap })}
          </span>
        ) : null}
        {open && (pr.autoMerge || waiting) ? (
          <span className={cx(s.pill, s.pillWait)}>
            <Icon name="clock" size={11} />
            {t('native.pr.mergesWhenChecksPass')}
          </span>
        ) : null}
      </div>
      {pr.checkRuns?.length && pr.state !== 'CLOSED' ? <CheckList checks={pr.checkRuns} /> : null}
      <div className={s.prActions}>
        {open ? pr.conflicts ? <ResolveConflictsButton wsId={wsId} /> : <MergeButton wsId={wsId} pr={pr} onError={setError} /> : null}
        {pr.state === 'MERGED' ? <AfterMergeButton wsId={wsId} /> : null}
        <Tip label={t('native.pr.commentsTip')}>
          <Button icon="chat" onClick={() => (openPrPage(wsId), close())}>
            {t('native.pr.comments')}
          </Button>
        </Tip>
        <Button onClick={() => pick('pr-open')}>{t('native.pr.openOnGitHub')}</Button>
        {pr.checks === 'failing' && open ? (
          <Button icon="claude" onClick={() => pick('pr-fix')}>
            {t('native.pr.fixFailingChecks')}
          </Button>
        ) : null}
        {open ? (
          <Button icon="up" onClick={() => pick('pr-update')}>
            {t('native.pr.pushAndUpdate')}
          </Button>
        ) : null}
      </div>
      {error ? (
        <div className={s.prError} role="alert">
          <Icon name="alert" size={12} />
          {error}
        </div>
      ) : null}
      {pr.state === 'MERGED' ? <div className={s.prNote}>{t('native.pr.mergedNote')}</div> : null}
      {open && pr.conflicts ? <div className={s.prNote}>{t('native.pr.conflictsNote')}</div> : null}
      {open && gap ? <div className={s.prNote}>{t('native.pr.gapNote', { count: gap, number: pr.number })}</div> : null}
      {open && changed ? <div className={s.prNote}>{t('native.pr.changedNote', { count: changed })}</div> : null}
    </div>
  );
}

/**
 * The PR button: create one with Claude (with anything extra to tell it), see the one you have,
 * or, without the GitHub CLI, the two commands that set it up.
 */
export function PullRequestSheet({ menu, close }: NativeMenuProps<'pr'>) {
  const api = useApi();
  const t = useT();
  const { client } = useBeluga();
  const pick = usePick(menu);
  const ws = useApp((st) => findWorkspace(st.projects, menu.id));
  const pr = useApp((st) => st.prs[menu.id]);
  const gh = useApp((st) => st.gh);
  const custom = useApp((st) => st.prCustom);
  const [note, setNote] = useState('');
  const [checking, setChecking] = useState(false);
  if (!ws) return null;
  const instructions = (
    <button type="button" className={f.linkButton} onClick={() => pick('pr-edit-prompt')}>
      {custom ? t('native.pr.yourInstructions') : t('native.pr.instructionsLink')}
    </button>
  );

  if (gh === false) {
    const check = async (): Promise<string | void> => {
      setChecking(true);
      await api.workbench.refreshPrs(menu.id, true);
      setChecking(false);
      if (client.store.getState().gh === false) return t('native.pr.ghNotSetUp');
      toast(client, t('native.pr.ghConnected'), 'success');
    };
    return (
      <FormSheet title={t('native.pr.connectGitHub')} icon="pr" intro={t('native.pr.connectIntro')} submitLabel={checking ? t('native.pr.checking') : t('native.pr.checkAgain')} canSubmit={!checking} onSubmit={check} onCancel={close}>
        <div className={s.ghSteps}>
          <div className={s.ghStep}>
            <div className={s.ghStepTitle}>
              {t('native.pr.ghInstall')} <span>{t('native.pr.ghNeedsHomebrew')}</span>
            </div>
            <CommandLine command="brew install gh" />
          </div>
          <div className={s.ghStep}>
            <div className={s.ghStepTitle}>
              {t('native.pr.ghSignIn')} <span>{t('native.pr.ghOpensBrowser')}</span>
            </div>
            <CommandLine command="gh auth login" />
          </div>
        </div>
      </FormSheet>
    );
  }

  if (pr) {
    return (
      <FormSheet width={560} title={t('native.pr.sheetTitle', { name: ws.name })} intro={slotted(t('native.pr.from'), 'branch', <code>{ws.branch ?? t('native.pr.thisBranch')}</code>)} submitLabel="" hideSubmit onSubmit={() => undefined} onCancel={close} footer={instructions}>
        <PrCard wsId={menu.id} pr={pr} pick={pick} refresh={() => void api.workbench.refreshPrs(menu.id).then(() => toast(client, t('native.pr.statusRefreshed')))} close={close} />
      </FormSheet>
    );
  }

  return (
    <FormSheet
      title={t('native.pr.create')}
      icon="pr"
      intro={slotted(t('native.pr.createIntro'), 'branch', <code>{ws.branch ?? t('native.pr.thisBranch')}</code>)}
      submitLabel={t('native.pr.create')}
      onSubmit={() => {
        // The same as /pr with extra words (or the plain option without them).
        if (note.trim()) void api.workbench.createPr(menu.id, note.trim());
        else pick('pr-create');
        close();
      }}
      onCancel={close}
      footer={instructions}
    >
      <Field label={t('native.pr.instructions')} htmlFor="pr-note" hint={t('native.pr.instructionsHint', { keys: cmdReturn() })}>
        <TextArea id="pr-note" value={note} onChange={setNote} rows={3} placeholder={t('native.pr.instructionsPlaceholder')} />
      </Field>
    </FormSheet>
  );
}
