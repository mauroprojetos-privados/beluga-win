import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { type ReactNode, useEffect, useState } from 'react';
import type { MergePreview } from '@beluga/workspaces/merge-preview.js';
import type { Workspace } from '@beluga/workspaces/types.js';
import { Icon, type IconName } from '../../components/Icon.js';
import { Button, cx } from '../../components/ui.js';
import { useApi, useApp } from '../../lib/beluga.js';
import { type CheckTone, reviewMerge } from '../../lib/merge-review.js';
import { askBeforeWork } from '../../lib/work-confirm.js';
import { timeAgo } from '../../views/history/history-model.js';
import s from './merge-review.module.css';
import { formatNumber } from '@beluga/shared/i18n/format.js';
import { useT } from '../../lib/i18n.js';

/**
 * Merge, the careful way: before anything changes, where it goes (this branch → main, in your
 * main folder), the commits and files it brings, and checks for what would stop it. The green
 * button only works when every check passes; nothing is pushed.
 */

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const SHOWN_COMMITS = 5;

const TONE_ICON: Record<CheckTone, IconName> = { ok: 'check', info: 'info', block: 'alert' };

function usePreview(wsId: string): { preview?: MergePreview; error?: string } {
  const api = useApi();
  const [state, setState] = useState<{ preview?: MergePreview; error?: string }>({});
  // Checked again when the worktree changes (a commit made from here, say).
  const status = useApp((st) => JSON.stringify(st.projects.flatMap((p) => p.workspaces).find((w) => w.id === wsId)?.status ?? null));
  useEffect(() => {
    let alive = true;
    api.git.mergePreview(wsId).then(
      (preview) => alive && setState({ preview }),
      (err: unknown) => alive && setState({ error: errorText(err) }),
    );
    return () => {
      alive = false;
    };
  }, [wsId, status]);
  return state;
}

function Flow({ preview, home }: { preview: MergePreview; home: string }) {
  const folder = home && preview.folder.startsWith(home) ? `~${preview.folder.slice(home.length)}` : preview.folder;
  const t = useT();
  return (
    <div className={s.flow} aria-label={t('native.merge.flowAria', { from: preview.from, into: preview.into })}>
      <div className={s.end}>
        <span className={s.endLabel}>{t('native.merge.fromWorktree')}</span>
        <span className={s.branch} title={preview.from}>
          <Icon name="branch" size={12} />
          <span className={s.branchName}>{preview.from}</span>
        </span>
      </div>
      <span className={s.arrow} aria-hidden="true">
        <Icon name="arrowRight" size={14} />
      </span>
      <div className={s.end}>
        <span className={s.endLabel}>{t('native.merge.intoMain')}</span>
        <span className={cx(s.branch, s.target)} title={t('native.merge.inFolder', { branch: preview.into, folder })}>
          <Icon name="branch" size={12} />
          <span className={s.branchName}>{preview.into}</span>
        </span>
        <span className={s.folder} title={preview.folder}>
          {folder}
        </span>
      </div>
    </div>
  );
}

function Commits({ preview }: { preview: MergePreview }) {
  const t = useT();
  if (!preview.commitCount) return null;
  const more = preview.commitCount - Math.min(preview.commits.length, SHOWN_COMMITS);
  return (
    <section className={s.section} aria-label={t('native.merge.whatMerges')}>
      <div className={s.summary}>
        <strong>{t('native.confirm.commits', { count: preview.commitCount })}</strong>
        {preview.files ? (
          <>
            <span className={s.dot}>·</span>
            {t('native.merge.files', { count: preview.files })}
            <span className={s.added}>+{formatNumber(preview.insertions)}</span>
            <span className={s.removed}>−{formatNumber(preview.deletions)}</span>
          </>
        ) : null}
      </div>
      <ul className={s.commits}>
        {preview.commits.slice(0, SHOWN_COMMITS).map((c) => (
          <li key={c.hash} className={s.commit} title={`${c.subject}\n${c.author} · ${c.hash.slice(0, 7)}`}>
            <span className={s.subject}>{c.subject}</span>
            <span className={s.meta}>{timeAgo(c.when * 1000)}</span>
          </li>
        ))}
      </ul>
      {more > 0 ? <div className={s.more}>{t('native.merge.earlier', { count: more })}</div> : null}
    </section>
  );
}

function Body({ ws, close, children }: { ws: Workspace; close: () => void; children: (title: ReactNode, body: ReactNode, buttons: ReactNode) => ReactNode }) {
  const api = useApi();
  const t = useT();
  const home = useApp((st) => st.home);
  const { preview, error } = usePreview(ws.id);
  const review = preview ? reviewMerge(preview) : undefined;
  const go = (): void => {
    if (!review?.canMerge) return;
    close();
    void api.workspaces.merge(ws.id);
  };
  const fix = (kind: 'commit' | 'claude'): void => {
    close();
    if (kind === 'commit') askBeforeWork(ws.id, 'commit');
    else void api.workspaces.askClaudeToMerge(ws.id);
  };
  const into = preview?.into ?? 'main';
  const title = t('native.merge.title', { into });
  const body = error ? (
    <p className={s.error}>{t('native.merge.couldntLook', { error })}</p>
  ) : !preview || !review ? (
    <p className={s.loading}>{t('native.merge.checking')}</p>
  ) : (
    <>
      <Flow preview={preview} home={home} />
      <Commits preview={preview} />
      <ul className={s.checks} aria-label={t('native.pr.checks')}>
        {review.checks.map((c) => (
          <li key={c.id} className={cx(s.check, s[c.tone])} data-check={c.id} data-tone={c.tone}>
            <Icon name={TONE_ICON[c.tone]} size={13} className={s.checkIcon} />
            <span className={s.checkText}>{c.text}</span>
            {c.fix ? (
              <Button size="small" onClick={() => fix(c.fix!)}>
                {c.fix === 'commit' ? t('native.merge.commitFix') : t('native.merge.askAgent')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <p className={s.note}>{t('native.merge.note')}</p>
    </>
  );
  const buttons = (
    <div className={s.buttons}>
      <Button size="small" onClick={close}>
        {t('common.cancel')}
      </Button>
      <Button size="small" variant="merge" icon="merge" disabled={!review?.canMerge} onClick={go} data-merge-confirm>
        {review?.confirm ?? t('native.work.merge')}
      </Button>
    </div>
  );
  return <>{children(title, body, buttons)}</>;
}

export function MergeReview({ ws, anchor, close }: { ws: Workspace; anchor: HTMLElement | null; close: () => void }) {
  const t = useT();
  const head = (title: ReactNode, Title: typeof Dialog.Title | typeof Popover.Title) => (
    <div className={s.head}>
      <span className={s.icon} aria-hidden="true">
        <Icon name="merge" size={16} />
      </span>
      <Title className={s.title}>{title}</Title>
    </div>
  );
  if (!anchor) {
    return (
      <Dialog.Root open onOpenChange={(open) => (open ? undefined : close())}>
        <Dialog.Portal>
          <Dialog.Overlay className={s.overlay} />
          <Dialog.Content className={cx(s.panel, s.sheet)} aria-describedby={undefined}>
            <Body ws={ws} close={close}>
              {(title, body, buttons) => (
                <>
                  {head(title, Dialog.Title)}
                  {body}
                  {buttons}
                </>
              )}
            </Body>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }
  return (
    <Popover.Root open onOpenChange={(open) => (open ? undefined : close())}>
      <Popover.Anchor virtualRef={{ current: anchor }} />
      <Popover.Portal>
        <Popover.Content
          className={s.panel}
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          aria-label={t('native.work.merge')}
          // Its own button pressed again closes it (see askBeforeWork), instead of closing and reopening.
          onPointerDownOutside={(e) => (anchor.contains(e.target as Node) ? e.preventDefault() : undefined)}
        >
          <Body ws={ws} close={close}>
            {(title, body, buttons) => (
              <>
                {head(title, Popover.Title)}
                {body}
                {buttons}
              </>
            )}
          </Body>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
