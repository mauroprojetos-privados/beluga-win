import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { type KeyboardEvent, type ReactNode, type Ref } from 'react';
import type { Project } from '@beluga/workspaces/types.js';
import { Icon } from '../../components/Icon.js';
import { ProjectIcon } from '../../components/ProjectIcon.js';
import { ActionsDropdown } from '../../components/SpecMenu.js';
import { Tip, cx } from '../../components/ui.js';
import menu from '../../components/SpecMenu.module.css';
import { FILTERS, type OverviewFilter, type OverviewSort, SORTS, filterLabel, sortLabel } from './overview-model.js';
import s from './filter-bar.module.css';
import { chordLabel } from '../../lib/shortcuts-model.js';
import { t } from '@beluga/shared/i18n/index.js';
import { useT } from '../../lib/i18n.js';

const FILTER_HINTS = (): Record<OverviewFilter, string> => ({
  all: t('views.filter.hintAll'),
  active: t('views.filter.hintActive'),
  needs: t('views.filter.hintNeeds'),
  ready: t('views.filter.hintReady'),
  archived: t('views.filter.hintArchived'),
});

const SORT_HINTS = (): Record<OverviewSort, string> => ({
  recent: t('views.filter.sortHintRecent'),
  name: t('views.filter.sortHintName'),
  size: t('views.filter.sortHintSize'),
});

export interface FilterBarProps {
  readonly filter: OverviewFilter;
  readonly counts: Readonly<Record<OverviewFilter, number>>;
  readonly onFilter: (f: OverviewFilter) => void;
  readonly search: string;
  readonly onSearch: (text: string) => void;
  readonly searchRef: Ref<HTMLInputElement>;
  /** Esc in an empty search field, or ↓: on to the list. */
  readonly onLeaveSearch: () => void;
  readonly sort: OverviewSort;
  readonly onSort: (s: OverviewSort) => void;
  readonly projects: readonly Project[];
  readonly project: Project | undefined;
  readonly onProject: (id: string | undefined) => void;
}

/** Above the Overview: the segments (with counts), the project, the sort, and the search. */
export function FilterBar(props: FilterBarProps) {
  return (
    <div className={s.bar}>
      <Segments filter={props.filter} counts={props.counts} onFilter={props.onFilter} />
      <span className={s.flex} />
      <ProjectPopup projects={props.projects} project={props.project} onProject={props.onProject} />
      <SortPopup sort={props.sort} onSort={props.onSort} />
      <SearchField search={props.search} onSearch={props.onSearch} searchRef={props.searchRef} onLeave={props.onLeaveSearch} />
    </div>
  );
}

/** Like NSSegmentedControl, each segment with its count; ← → move between them. */
function Segments({ filter, counts, onFilter }: Pick<FilterBarProps, 'filter' | 'counts' | 'onFilter'>) {
  const t = useT();
  const hints = FILTER_HINTS();
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const at = FILTERS.indexOf(filter) + (e.key === 'ArrowRight' ? 1 : -1);
    const next = FILTERS[(at + FILTERS.length) % FILTERS.length]!;
    onFilter(next);
    (e.currentTarget.querySelector(`[data-filter="${next}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div className={s.segmented} role="tablist" aria-label={t('views.filter.show')} onKeyDown={onKey}>
      {FILTERS.map((f) => {
        const on = f === filter;
        return (
          <Tip key={f} label={hints[f]}>
            <button
              type="button"
              role="tab"
              data-filter={f}
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              aria-label={t('views.filter.segmentLabel', { label: filterLabel(f), count: counts[f] })}
              className={cx(s.segment, on && s.segmentOn, f === 'needs' && counts.needs > 0 && s.segmentUrgent)}
              onClick={() => onFilter(f)}
            >
              {filterLabel(f)}
              <span className={s.count}>{counts[f]}</span>
            </button>
          </Tip>
        );
      })}
    </div>
  );
}

function SortPopup({ sort, onSort }: Pick<FilterBarProps, 'sort' | 'onSort'>) {
  const t = useT();
  const hints = SORT_HINTS();
  const items = SORTS.map((x) => ({ label: sortLabel(x), hint: hints[x], checked: x === sort, onSelect: () => onSort(x) }));
  return (
    <ActionsDropdown items={items}>
      <button type="button" className={s.popup} aria-label={t('views.filter.sortBy', { sort: sortLabel(sort) })}>
        <span className={s.popupDim}>{t('views.filter.sort')}</span> {sortLabel(sort)}
        <Icon name="chevronDown" size={10} className={s.chevron} />
      </button>
    </ActionsDropdown>
  );
}

/** Which project: all of them, or one (by its icon, like apps in the Dock). */
function ProjectPopup({ projects, project, onProject }: Pick<FilterBarProps, 'projects' | 'project' | 'onProject'>) {
  const t = useT();
  const row = (key: string, checked: boolean, icon: ReactNode, label: string, pick: () => void) => (
    <Dropdown.Item key={key} className={menu.item} onSelect={pick}>
      <span className={menu.line}>
        <span className={menu.icon}>{checked ? <Icon name="check" size={12} /> : null}</span>
        <span className={s.menuIcon}>{icon}</span>
        <span className={menu.label}>{label}</span>
      </span>
    </Dropdown.Item>
  );
  const name = (p: Project): string => (p.root ? p.name : t('views.overview.chats'));
  const iconOf = (p: Project, size: number) => (p.root ? <ProjectIcon id={p.id} name={p.name} size={size} /> : <Icon name="chat" size={size - 2} />);
  return (
    <Dropdown.Root modal={false}>
      <Dropdown.Trigger asChild>
        <button type="button" className={s.popup} aria-label={t('views.filter.projectLabel', { project: project ? name(project) : t('views.overview.allProjects') })}>
          {project ? iconOf(project, 14) : <Icon name="grid" size={12} />}
          <span className={s.popupText}>{project ? name(project) : t('views.overview.allProjects')}</span>
          <Icon name="chevronDown" size={10} className={s.chevron} />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className={menu.menu} align="end" sideOffset={4} collisionPadding={8} onCloseAutoFocus={(e) => e.preventDefault()}>
          {row('all', !project, <Icon name="grid" size={13} />, t('views.overview.allProjects'), () => onProject(undefined))}
          {projects.length ? <Dropdown.Separator className={menu.separator} /> : null}
          {projects.map((p) => row(p.id, project?.id === p.id, iconOf(p, 16), name(p), () => onProject(p.id)))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

/** A Mac search field: Esc clears it (then leaves it), ↓ goes to the first row. */
function SearchField({ search, onSearch, searchRef, onLeave }: { search: string; onSearch: (text: string) => void; searchRef: Ref<HTMLInputElement>; onLeave: () => void }) {
  const t = useT();
  return (
    <label className={s.field} title={t('views.filter.searchTitle', { keys: chordLabel('Cmd+F') })}>
      <Icon name="search" size={12} />
      <input
        ref={searchRef}
        className={s.input}
        type="text"
        role="searchbox"
        aria-label={t('views.filter.searchWorkspaces')}
        placeholder={t('common.search')}
        spellCheck={false}
        autoComplete="off"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (search) onSearch('');
            else onLeave();
          } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
            e.preventDefault();
            onLeave();
          }
        }}
      />
      {search ? (
        <button type="button" className={s.clear} aria-label={t('views.filter.clearSearch')} onClick={() => onSearch('')}>
          <Icon name="x" size={8} strokeWidth={2.4} />
        </button>
      ) : null}
    </label>
  );
}
