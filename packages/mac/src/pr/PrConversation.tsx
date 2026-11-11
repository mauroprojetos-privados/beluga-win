import { useLayoutEffect, useRef, useState } from 'react';
import type { PrComment, PrReview, PrThread } from '@beluga/core/work-store.js';
import { langOf, parseHunk } from '@beluga/shared/code-ref.js';
import { Markdown } from '../chat/Markdown.js';
import { CodeLines, type CodeRow } from '../components/code/CodeLines.js';
import { Icon } from '../components/Icon.js';
import { Avatar, Button, IconButton, Tip, cx } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { useApi, useBeluga } from '../lib/beluga.js';
import { goToCode } from '../lib/go-to-code.js';
import { usePrefs } from '../lib/prefs.js';
import { chordLabel } from '../lib/shortcuts-model.js';
import { agoWords } from '../issues/issues-model.js';
import type { ConversationItem } from './use-pr-conversation.js';
import s from './pr-conversation.module.css';
import { openCodeThere } from '../lib/remote-open.js';
import { t as tr } from '@beluga/shared/i18n/index.js';
import { useT } from '../lib/i18n.js';

/**
 * The pieces a PR's conversation is drawn with: someone's words, a review's verdict, and a thread
 * on lines with the code it's on. The PR page (PrPage.tsx) adds your replies to them; a chat
 * message (PrCommentsBlock.tsx) shows them as they are, one click from the page.
 */

/** How many lines of the diff a thread shows above its comment. */
const HUNK_ROWS = 8;

const VERDICT = (): Record<PrReview['state'], { words: string; tone?: string; icon?: 'check' | 'alert' }> => ({
  APPROVED: { words: tr('github.pr.approved'), tone: s.ok, icon: 'check' },
  CHANGES_REQUESTED: { words: tr('github.pr.changesRequested'), tone: s.bad, icon: 'alert' },
  COMMENTED: { words: tr('github.pr.reviewed') },
  DISMISSED: { words: tr('github.pr.dismissed') },
});

/** The lines a thread is on: where it was written (the hunk's numbering). */
function threadRange(t: PrThread): [number, number] | undefined {
  const end = t.originalLine ?? t.line;
  if (!end) return undefined;
  return [t.originalStartLine ?? t.startLine ?? end, end];
}

/** The last lines of a thread's diff hunk, the commented ones marked. */
export function hunkRows(t: PrThread): CodeRow[] {
  if (!t.diffHunk) return [];
  const range = threadRange(t);
  const rows = parseHunk(t.diffHunk).map((r): CodeRow => ({ text: r.text, kind: r.kind, ...(r.new !== undefined ? { n: r.new } : {}), ...(r.old !== undefined ? { old: r.old } : {}), marked: Boolean(range && r.kind !== 'del' && r.new !== undefined && r.new >= range[0] && r.new <= range[1]) }));
  const span = range ? range[1] - range[0] + 1 : 1;
  return rows.slice(-Math.max(HUNK_ROWS, span + 3));
}

const lineWords = (t: PrThread): string => {
  const range = t.line ? [t.startLine ?? t.line, t.line] : threadRange(t);
  if (!range) return '';
  return range[0] === range[1] ? `:${range[1]}` : `:${range[0]}-${range[1]}`;
};

/** Where a thread's code is now (its first line), for going there. */
export const threadLine = (t: PrThread): number | undefined => t.startLine ?? t.line ?? t.originalStartLine ?? t.originalLine;

/** A box to write in: grows with the text, sends with your send key. */
export function WriteBox({ placeholder, label, busyLabel, onSend, onCancel, autoFocus }: { placeholder: string; label: string; busyLabel: string; onSend: (body: string) => Promise<boolean>; onCancel?: () => void; autoFocus?: boolean }) {
  const prefs = usePrefs();
  const t = useT();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const sendKeys = prefs.sendWith === 'enter' ? '↩' : chordLabel('Cmd+Enter');
  const ready = !busy && Boolean(body.trim());
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 38), 240)}px`;
  }, [body]);
  const go = async (): Promise<void> => {
    if (!ready) return;
    setBusy(true);
    const ok = await onSend(body);
    setBusy(false);
    if (ok) setBody('');
  };
  return (
    <div className={cx(s.write, busy && s.busy)}>
      <textarea
        ref={box}
        className={cx(s.writeInput, 'selectable')}
        aria-label={placeholder.replace(/…$/, '')}
        placeholder={placeholder}
        value={body}
        rows={1}
        spellCheck
        autoFocus={autoFocus}
        disabled={busy}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && onCancel) {
            e.preventDefault();
            onCancel();
            return;
          }
          if (e.nativeEvent.isComposing || e.key !== 'Enter') return;
          const modKey = e.metaKey || e.ctrlKey;
          if (prefs.sendWith === 'enter' ? e.shiftKey || modKey : !modKey) return;
          e.preventDefault();
          void go();
        }}
      />
      <div className={s.writeBar}>
        <span className={s.writeNote}>
          <Icon name="globe" size={11} />
          {t('github.pr.note')}
        </span>
        <span className={s.grow} />
        {onCancel ? (
          <Button size="small" variant="quiet" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        ) : null}
        <Tip label={label} keys={sendKeys}>
          <Button size="small" variant="primary" icon="send" disabled={!ready} onClick={() => void go()}>
            {busy ? busyLabel : label}
          </Button>
        </Tip>
      </div>
    </div>
  );
}

/** One person's words: who, when, and what (yours are marked "you"). */
export function Said({ c, what, compact }: { c: PrComment; what?: string; compact?: boolean }) {
  const actions = useActions();
  const t = useT();
  return (
    <article className={cx(s.said, compact && s.saidCompact)}>
      <header className={s.saidHead}>
        <Avatar name={c.author} id={`gh:${c.author}`} size={compact ? 18 : 20} />
        <strong>{c.author}</strong>
        {c.mine ? <span className={s.you}>{t('github.pr.you')}</span> : null}
        <span className={s.when}>
          {what ?? t('github.pr.commented')} {agoWords(c.at)}
        </span>
        <span className={s.grow} />
        {c.url ? (
          <button type="button" className={s.link} aria-label={t('github.openOnGitHub')} title={t('github.openOnGitHub')} onClick={() => actions.openLink({ kind: 'url', url: c.url })}>
            <Icon name="external" size={11} />
          </button>
        ) : null}
      </header>
      {c.body.trim() ? (
        <div className={s.body}>
          <Markdown text={c.body} html />
        </div>
      ) : null}
    </article>
  );
}

/** A review: its verdict as a mark, and what the reviewer said. */
export function ReviewCard({ review }: { review: PrReview }) {
  useT();
  const verdict = VERDICT()[review.state];
  return (
    <div className={s.review}>
      {verdict.icon ? (
        <span className={cx(s.verdict, verdict.tone)}>
          <Icon name={verdict.icon} size={11} />
        </span>
      ) : null}
      <Said c={review} what={verdict.words} />
    </div>
  );
}

/**
 * A conversation on lines: where (the path goes straight to the file at that line), the code it's
 * on, and what was said. `children`: what you can do with it, under the comments (the page's
 * Reply and Resolve; a chat message's way to the page).
 */
export function ThreadCard({ wsId, thread, folded = thread.resolved, children }: { wsId: string; thread: PrThread; folded?: boolean; children?: React.ReactNode }) {
  const api = useApi();
  const { client } = useBeluga();
  const [open, setOpen] = useState(!folded);
  const rows = hunkRows(thread);
  const lang = langOf(thread.path);
  const first = thread.comments[0];
  const line = threadLine(thread);
  const t = useT();
  return (
    <section className={cx(s.thread, thread.resolved && s.resolved)} data-pr-thread={thread.id} aria-label={t('github.pr.commentsOn', { path: thread.path })}>
      <header className={s.threadHead}>
        <button type="button" className={s.fold} aria-expanded={open} aria-label={open ? t('github.pr.fold') : t('github.pr.unfold')} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={11} />
        </button>
        <Tip label={t('github.pr.goToLine')}>
          <button type="button" className={s.path} data-go-to-code={thread.path} onClick={() => void goToCode(client, wsId, thread.path, line)}>
            <Icon name="file" size={12} />
            <span>{thread.path}</span>
            <em>{lineWords(thread)}</em>
          </button>
        </Tip>
        {thread.outdated ? <span className={s.pill}>{t('github.pr.outdated')}</span> : null}
        {thread.resolved ? (
          <span className={cx(s.pill, s.ok)}>
            <Icon name="check" size={10} />
            {t('github.pr.resolved')}
          </span>
        ) : null}
        {!open && first ? (
          <span className={s.peek}>
            <strong>{first.author}</strong> {first.body.split('\n')[0]}
          </span>
        ) : (
          <span className={s.grow} />
        )}
        <span className={s.count}>{thread.comments.length > 1 ? t('github.pr.threadComments', { count: thread.comments.length }) : ''}</span>
        <IconButton icon="external" label={t('github.pr.openInEditor')} className={s.small} onClick={() => void openCodeThere(client, wsId, thread.path, line)} />
      </header>
      {open ? (
        <>
          {rows.length ? (
            <div className={s.code}>
              <CodeLines rows={rows} diff {...(lang ? { lang } : {})} />
            </div>
          ) : null}
          <div className={s.comments}>
            {thread.comments.map((c, i) => (
              <Said key={c.id} c={c} compact what={i === 0 ? t('github.pr.commented') : t('github.pr.replied')} />

            ))}
          </div>
          {children}
        </>
      ) : null}
    </section>
  );
}

/** One thing in the conversation, read-only (`thread` draws threads, for what's around them). */
export function ItemCard({ wsId, item, thread }: { wsId: string; item: ConversationItem; thread?: (t: PrThread) => React.ReactNode }) {
  if (item.kind === 'thread') return <>{thread ? thread(item.thread) : <ThreadCard wsId={wsId} thread={item.thread} />}</>;
  if (item.kind === 'comment') return <Said c={item.comment} />;
  return <ReviewCard review={item.review} />;
}
