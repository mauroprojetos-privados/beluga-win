import { useEffect, useRef } from 'react';
import { Icon } from '../components/Icon.js';
import { Tip, cx } from '../components/ui.js';
import { copyText } from '../lib/copy.js';
import { toast, useApi, useApp, useBeluga } from '../lib/beluga.js';
import { Markdown } from './Markdown.js';
import { useAgentNameIn } from '../lib/agent-words.js';
import { useT } from '../lib/i18n.js';
import s from './btw.module.css';

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Ask a side question (/btw) here: the card above the box shows the answer as it comes. */
export function askBtw(client: ReturnType<typeof useBeluga>['client'], api: ReturnType<typeof useApi>, channel: string, question: string): void {
  api.session.btw(channel, question).catch((err: unknown) => toast(client, errorText(err), 'warn'));
}

/**
 * A side question (/btw) and the agent's answer, just above the box you type in. It's beside the
 * conversation, never in it: the agent keeps working, and the conversation never sees it. ✕ or esc
 * (with the box empty) closes it; asking another replaces it.
 */
export function BtwCard({ channel }: { channel: string }) {
  const { client } = useBeluga();
  const api = useApi();
  const t = useT();
  const btw = useApp((st) => st.btw?.[channel]);
  const agent = useAgentNameIn(channel);
  const body = useRef<HTMLDivElement>(null);
  // Follow the answer as it grows, unless you scrolled up to read.
  const pinned = useRef(true);
  useEffect(() => {
    const el = body.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [btw?.text]);
  useEffect(() => {
    pinned.current = true;
  }, [btw?.id]);
  if (!btw) return null;
  const close = (): void => void api.session.btwDismiss(channel);
  const thinking = btw.state === 'thinking';
  const writing = btw.state === 'answering';
  return (
    <section key={btw.id} className={cx(s.card, thinking && s.thinking)} aria-label={t('chat.btw.aria')} aria-live="polite">
      <header className={s.head}>
        <span className={s.tag}>
          <Icon name="sparkles" size={11} />
          {t('chat.btw.tag')}
        </span>
        <span className={s.question} title={btw.question}>
          {btw.question}
        </span>
        <span className={s.acts}>
          {btw.state === 'done' && btw.text ? (
            <Tip label={t('chat.btw.copy')}>
              <button type="button" className={s.act} aria-label={t('chat.btw.copy')} onClick={() => void copyText(btw.text).then(() => toast(client, t('chat.btw.copied'), 'success'))}>
                <Icon name="copy" size={12} />
              </button>
            </Tip>
          ) : null}
          <Tip label={thinking || writing ? t('chat.btw.stopClose') : t('common.close')} keys="esc">
            <button type="button" className={s.act} aria-label={t('chat.btw.closeAria')} onClick={close}>
              <Icon name="x" size={12} />
            </button>
          </Tip>
        </span>
      </header>
      <div
        ref={body}
        className={cx(s.body, 'selectable')}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
        }}
      >
        {thinking ? (
          <span className={s.shimmer}>{t('chat.btw.thinking', { agent })}</span>
        ) : btw.text ? (
          <div className={cx(s.answer, writing && s.writing)}>
            <Markdown text={btw.text} live={writing} />
          </div>
        ) : null}
        {btw.state === 'failed' ? (
          <p className={s.error}>
            {btw.error ?? t('chat.btw.couldntAnswer', { agent })}
            <button type="button" className={s.retry} onClick={() => askBtw(client, api, channel, btw.question)}>
              {t('chat.btw.askAgain')}
            </button>
          </p>
        ) : null}
      </div>
      <footer className={s.foot}>{t('chat.btw.foot', { agent })}</footer>
    </section>
  );
}
