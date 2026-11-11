import { useEffect, useRef, useState } from 'react';
import type { HistoryFilters as Filters } from '@beluga/workspaces/history.js';
import { Icon } from '../../components/Icon.js';
import { Select, type SelectEntry } from '../../components/Select.js';
import { IconButton, cx } from '../../components/ui.js';
import { AuthorAvatar } from './HistoryList.js';
import { branchChoices } from './history-model.js';
import type { LogQuery } from './use-history.js';
import s from './history.module.css';
import { useT } from '../../lib/i18n.js';

const SEARCH_DELAY_MS = 280;
const EVERYONE = '\u0000everyone';

/** History's filters: which branches, whose commits, and a path. */
export function HistoryFilters({ filters, query, onChange, compact, onRefresh, refreshing }: { filters: Filters | undefined; query: LogQuery; onChange: (q: LogQuery) => void; compact?: boolean; onRefresh?: () => void; refreshing?: boolean }) {
  const t = useT();
  const [path, setPath] = useState(query.path ?? '');
  // The latest query and handler (a branch picked while typing a path isn't undone by the delay).
  const latest = useRef({ query, onChange });
  latest.current = { query, onChange };
  useEffect(() => setPath(query.path ?? ''), [query.path]);
  useEffect(() => {
    if (path === (latest.current.query.path ?? '')) return;
    const timer = setTimeout(() => latest.current.onChange({ ...latest.current.query, path: path.trim() || undefined } as LogQuery), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [path]);
  const ch = branchChoices(filters);
  const branchOptions: SelectEntry<string>[] = [
    ...ch.all.map((b) => ({ ...b, icon: b.value === 'all' ? ('branch' as const) : ('check' as const) })),
    ...(ch.local.length ? [{ section: t('views.history.branches'), options: ch.local.map((b) => ({ ...b, ...(b.value === filters?.current ? { badge: t('views.history.checkedOutBadge') } : {}) })) }] : []),
    ...(ch.remote.length ? [{ section: t('views.history.remote'), options: ch.remote }] : []),
    ...(ch.tags.length ? [{ section: t('views.history.tags'), options: ch.tags }] : []),
  ];
  // An author picked before the list loaded still shows.
  const authors = filters?.authors ?? [];
  const authorOptions: SelectEntry<string>[] = [
    { value: EVERYONE, label: t('views.history.everyone'), icon: 'people' },
    ...(authors.length ? [{ section: t('views.history.people'), options: authors.map((a) => ({ value: a.email || a.name, label: a.name, description: a.email, keywords: [a.email], badge: String(a.commits), icon: <AuthorAvatar name={a.name} email={a.email} size={16} /> })) }] : []),
    ...(query.author && !authors.some((a) => (a.email || a.name) === query.author) ? [{ value: query.author, label: query.author }] : []),
  ];
  return (
    <div className={cx(s.filters, compact && s.filtersCompact)} role="group" aria-label={t('views.history.filterLabel')}>
      <Select size="small" mono label={t('views.history.branch')} value={query.branch} options={branchOptions} onChange={(branch) => onChange({ ...query, branch })} searchPlaceholder={t('views.history.findBranchOrTag')} />
      <Select size="small" label={t('views.history.author')} value={query.author ?? EVERYONE} options={authorOptions} onChange={(a) => onChange({ ...query, author: a === EVERYONE ? undefined : a } as LogQuery)} searchPlaceholder={t('views.history.findPerson')} />
      <label className={s.search}>
        <Icon name="search" size={12} />
        <input className="selectable" type="search" aria-label={t('views.history.path')} placeholder={compact ? t('views.history.path') : t('views.history.pathOrFile')} value={path} spellCheck={false} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && path && (e.stopPropagation(), setPath(''))} />
      </label>
      {onRefresh ? <IconButton icon="refresh" label={refreshing ? t('common.loading') : t('views.history.reload')} className={cx(refreshing && s.spinning)} onClick={onRefresh} /> : null}
    </div>
  );
}
