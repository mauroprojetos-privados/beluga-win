import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { Project } from '@beluga/workspaces/types.js';
import { Icon, type IconName } from '../components/Icon.js';
import { getPrefs, setPrefs, usePrefs } from '../lib/prefs.js';
import { ActionsContext, type ActionItem } from '../components/SpecMenu.js';
import { cx } from '../components/ui.js';
import { editGroups, newGroupFor, useGroupEdit } from '../lib/group-edit.js';
import { useApi, useApp } from '../lib/beluga.js';
import { type Entry, type Place, type Target, outOfGroup, stepOf } from './project-layout.js';
import { NO_TALLY, type Tally, tallyTip } from './attention-model.js';
import { DotMark, TallyMark } from './signal-marks.js';
import side from './Sidebar.module.css';
import s from './project-groups.module.css';
import { isShortcut } from '../lib/shortcuts.js';
import { shortcutKeys } from '../lib/shortcuts.js';
import { useT } from '../lib/i18n.js';
import { t as tr } from '@beluga/shared/i18n/index.js';

/** The project menu's group options, done the Mac way: these spec options become "Move to Group ▸". */
export const isGroupOption = (id: string): boolean => id.startsWith('p-group:') || id === 'p-newgroup' || id === 'p-ungroup';

/** Moving rows with the keyboard (⌥⌘↑/↓ are Previous/Next Workspace in the menu bar). */
export const moveKey = (e: KeyboardEvent): -1 | 1 | undefined => (isShortcut('project-up', e) ? -1 : isShortcut('project-down', e) ? 1 : undefined);

/** "Move Up" and "Move Down" for a row's menu (greyed at the ends). */
export function moveItems(entries: readonly Entry[], item: Target, arrange: (item: Target, place: Place) => void): ActionItem[] {
  const up = stepOf(entries, item, -1);
  const down = stepOf(entries, item, 1);
  return [
    { label: tr('layout.groups.moveUp'), keys: shortcutKeys('project-up'), disabled: !up, onSelect: () => up && arrange(item, up) },
    { label: tr('layout.groups.moveDown'), keys: shortcutKeys('project-down'), disabled: !down, onSelect: () => down && arrange(item, down) },
  ];
}

/** "Move to Group ▸": the groups (a check on this project's), New Group…, Remove from Group. */
export function groupItems(p: Project, entries: readonly Entry[], arrange: (item: Target, place: Place) => void): readonly ActionItem[] {
  const groups = entries.flatMap((e) => (e.kind === 'group' ? [e] : []));
  const current = groups.find((g) => g.projects.some((x) => x.id === p.id))?.name;
  if (!p.root) return [];
  return [
    {
      label: tr('layout.groups.moveToGroup'),
      separate: true,
      submenu: [
        ...groups.map((g) => ({ label: g.name, checked: g.name === current, onSelect: () => (g.name === current ? undefined : arrange({ project: p.id }, { into: g.name, before: null })) })),
        { label: tr('layout.groups.newGroupDots'), separate: groups.length > 0, onSelect: () => newGroupFor(p.id) },
        ...(current ? [{ label: tr('layout.groups.removeFrom', { name: current }), onSelect: () => arrange({ project: p.id }, outOfGroup(entries, current)) }] : []),
      ],
      onSelect: () => undefined,
    },
  ];
}

/** A group's name, typed in place: Return keeps it, Esc (or an empty name) gives up. */
function NameField({ initial, onDone, label }: { initial: string; onDone: (name: string | undefined) => void; label: string }) {
  const [name, setName] = useState(initial);
  const box = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (value: string | undefined): void => {
    if (done.current) return;
    done.current = true;
    onDone(value?.trim() ? value.trim() : undefined);
  };
  useEffect(() => {
    // After the menu that asked for it has closed and given the focus back.
    const t = setTimeout(() => {
      box.current?.focus();
      box.current?.select();
      box.current?.scrollIntoView({ block: 'nearest' });
    }, 30);
    return () => clearTimeout(t);
  }, []);
  return (
    <input
      ref={box}
      className={s.field}
      value={name}
      aria-label={label}
      maxLength={30}
      spellCheck={false}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(name);
        else if (e.key === 'Escape') finish(undefined);
      }}
      onBlur={() => finish(name)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** Icons a group can wear instead of the folder (Change Icon ▸ on its right-click menu). */
export const GROUP_ICONS = (): ReadonlyArray<{ readonly icon: IconName; readonly label: string }> => [
  { icon: 'folder', label: tr('layout.groups.icon.folder') },
  { icon: 'grid', label: tr('layout.groups.icon.grid') },
  { icon: 'spark', label: tr('layout.groups.icon.prompt') },
  { icon: 'people', label: tr('layout.groups.icon.people') },
  { icon: 'globe', label: tr('layout.groups.icon.globe') },
  { icon: 'coin', label: tr('layout.groups.icon.coin') },
  { icon: 'bulb', label: tr('layout.groups.icon.idea') },
  { icon: 'wand', label: tr('layout.groups.icon.wand') },
  { icon: 'terminal', label: tr('layout.groups.icon.terminal') },
  { icon: 'lock', label: tr('layout.groups.icon.lock') },
  { icon: 'archive', label: tr('layout.groups.icon.archive') },
  { icon: 'important', label: tr('layout.groups.icon.flag') },
];

const iconOfGroup = (icons: Readonly<Record<string, string>>, name: string): IconName => {
  const picked = icons[name];
  return GROUP_ICONS().find((g) => g.icon === picked)?.icon ?? 'folder';
};

/** A group's disclosure triangle and its icon (a folder unless you picked another). */
function GroupIcon({ open, icon = 'folder' }: { open: boolean; icon?: IconName }) {
  return (
    <span className={s.groupIcon}>
      <Icon name="chevronRight" size={9} className={cx(s.disclosure, open && s.disclosureOpen)} />
      <Icon name={icon} size={15} className={s.folder} />
    </span>
  );
}

/** Pick a group's icon; it follows the group when it's renamed. */
function setGroupIcon(name: string, icon: IconName | undefined): void {
  const { [name]: _old, ...rest } = getPrefs().groupIcons;
  setPrefs({ groupIcons: icon && icon !== 'folder' ? { ...rest, [name]: icon } : rest });
}

function renameGroupIcon(from: string, to: string): void {
  const icons = getPrefs().groupIcons;
  const icon = icons[from];
  if (!icon) return;
  const { [from]: _old, ...rest } = icons;
  setPrefs({ groupIcons: { ...rest, [to]: icon } });
}

/** The row of a group being made: a folder and its name field (like Finder's New Folder). */
export function NewGroupRow() {
  const t = useT();
  const api = useApi();
  const { creating } = useGroupEdit();
  const project = useApp((st) => st.projects.find((p) => p.id === creating?.projectId));
  if (!creating) return null;
  return (
    <div className={cx(side.row, side.groupRow, s.editing)} style={{ paddingLeft: 8 }}>
      <span className={side.rowIcon} style={{ width: 'auto' }}>
        <GroupIcon open />
      </span>
      <NameField
        key={creating.projectId ?? ''}
        initial={t('layout.tree.newGroup')}
        label={project ? t('layout.groups.nameFor', { name: project.name }) : t('layout.groups.nameNew')}
        onDone={(name) => {
          editGroups({ creating: undefined });
          if (name) void api.workspaces.newGroup(name, project ? { project: project.id } : {});
        }}
      />
    </div>
  );
}

export interface GroupHeaderProps {
  readonly name: string;
  readonly count: number;
  readonly open: boolean;
  readonly busy: boolean;
  /** What its projects add up to (folded, it shows instead of how many projects it holds). */
  readonly tally?: Tally;
  /** A project being dragged would go inside: the folder lights up. */
  readonly dropOn: boolean;
  readonly menu: readonly ActionItem[];
  readonly onToggle: () => void;
  readonly onMove: (dir: -1 | 1) => void;
}

/** A group in the sidebar: click to fold, drag to move, right-click to rename or ungroup. */
export function GroupHeader({ name, count, open, busy, tally = NO_TALLY, dropOn, menu, onToggle, onMove }: GroupHeaderProps) {
  const t = useT();
  const api = useApi();
  const { renaming } = useGroupEdit();
  const icon = iconOfGroup(usePrefs().groupIcons, name);
  const items: ActionItem[] = [
    { label: t('layout.groups.rename'), icon: 'pencil', onSelect: () => editGroups({ renaming: name, creating: undefined }) },
    {
      label: t('layout.groups.changeIcon'),
      icon,
      submenu: GROUP_ICONS().map((g) => ({ label: g.label, icon: g.icon, checked: g.icon === icon, onSelect: () => setGroupIcon(name, g.icon) })),
      onSelect: () => undefined,
    },
    ...menu,
    count
      ? { label: t('layout.groups.ungroup'), hint: t('layout.groups.ungroupHint'), icon: 'x', danger: true, separate: true, onSelect: () => void api.workspaces.ungroup(name).then(() => setGroupIcon(name, undefined)) }
      : { label: t('layout.groups.deleteGroup'), icon: 'x', danger: true, separate: true, onSelect: () => void api.workspaces.ungroup(name).then(() => setGroupIcon(name, undefined)) },
  ];
  if (renaming === name) {
    return (
      <div className={cx(side.row, side.groupRow, s.editing)} style={{ paddingLeft: 8 }} data-head>
        <span className={side.rowIcon} style={{ width: 'auto' }}>
          <GroupIcon open={open} icon={icon} />
        </span>
        <NameField
          initial={name}
          label={t('layout.groups.newName', { name })}
          onDone={(to) => {
            editGroups({ renaming: undefined });
            if (to && to !== name) void api.workspaces.renameGroup(name, to).then(() => renameGroupIcon(name, to), () => undefined);
          }}
        />
      </div>
    );
  }
  return (
    <ActionsContext items={items}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={t('layout.groups.group', { name })}
        title={tallyTip(tally) || undefined}
        className={cx(side.row, side.groupRow, s.groupHead, dropOn && s.dropOn)}
        style={{ paddingLeft: 8 }}
        data-head
        data-drag={`group:${name}`}
        onClick={onToggle}
        onDoubleClick={() => editGroups({ renaming: name })}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          const dir = moveKey(e);
          if (dir) {
            e.preventDefault();
            onMove(dir);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            editGroups({ renaming: name });
          } else if (e.key === ' ' || (e.key === 'ArrowLeft' && open) || (e.key === 'ArrowRight' && !open)) {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        <span className={side.rowIcon} style={{ width: 'auto' }}>
          <GroupIcon open={open} icon={icon} />
        </span>
        <span className={side.rowLabel}>{name}</span>
        <span className={side.trailing}>
          {open ? null : (
            <>
              {busy ? <DotMark tone="claude" live signal="busy" /> : null}
              <TallyMark tally={tally} folded fallback={<span className={s.count}>{count}</span>} />
            </>
          )}
          {open && !count ? <span className={s.empty}>{t('layout.groups.empty')}</span> : null}
        </span>
      </div>
    </ActionsContext>
  );
}

