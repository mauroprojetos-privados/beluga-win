import { memo, useState } from 'react';
import { Icon } from '../components/Icon.js';
import { cx } from '../components/ui.js';
import { useApp, useScopedKey } from '../lib/beluga.js';
import { type CompactItem, dividerText } from './context-model.js';
import { Markdown } from './Markdown.js';
import { useT } from '../lib/i18n.js';
import s from './context.module.css';

/** Dividers you opened (kept while the chat scrolls them out of view and back). */
const opened = new Set<string>();

/**
 * Where Claude compacted its working memory. The chat above stays as it was; the chevron shows
 * the summary Claude continues from. Each divider opens on its own.
 */
export const CompactDivider = memo(function CompactDivider({ item }: { item: CompactItem }) {
  const key = useScopedKey(item.id);
  const t = useT();
  const [open, setOpen] = useState(() => opened.has(key));
  // "Compacting…" only while Claude still is (a daemon that quit mid-way leaves it unfinished).
  const live = useApp((st) => Boolean(st.context[item.channel]?.compacting));
  const m = item.compact;
  const running = m.state === 'running' && live;
  const failed = m.state === 'failed' || (m.state === 'running' && !live);
  const text = dividerText(item, !live);
  const toggle = (): void => {
    const next = !open;
    if (next) opened.add(key);
    else opened.delete(key);
    setOpen(next);
  };
  return (
    <div className={cx(s.divider, running && s.running, failed && s.failed, open && s.open)} data-compact-divider={running ? 'running' : failed ? 'failed' : 'done'} role="separator" aria-label={text}>
      <div className={s.rule}>
        {m.state === 'done' ? (
          <button type="button" className={s.label} aria-expanded={open} onClick={toggle} title={open ? t('chat.compact.hideKept') : t('chat.compact.showKept')}>
            <Icon name="gauge" size={11} />
            {text}
            <Icon name="chevronRight" size={10} className={s.chev} />
          </button>
        ) : (
          <span className={s.label} role="status">
            {running ? <span className={s.shimmer}>{text}</span> : text}
          </span>
        )}
      </div>
      {open && m.state === 'done' ? (
        <div className={`${s.summary} selectable`}>
          <div className={s.summaryHead}>
            <strong>{t('chat.compact.kept')}</strong>
            <span>{t('chat.compact.keptDetail')}</span>
          </div>
          {m.summary ? <Markdown text={m.summary} paths localImages tasks /> : <div className={s.summaryEmpty}>{t('chat.compact.noSummary')}</div>}
        </div>
      ) : null}
    </div>
  );
});
