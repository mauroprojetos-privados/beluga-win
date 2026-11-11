import { dockName } from '../lib/os-words.js';
import { t } from '../../../../src/shared/i18n/index.js';

/**
 * Settings › Menu Bar (BLG-280): what the number beside the menu-bar whale counts, how it reads,
 * and when the whale spouts. Kept on this Mac (UiPrefs.menuBar).
 */

/** What the number counts. */
export type MenuBarCount = 'new' | 'waiting' | 'working' | 'room' | 'friends' | 'none';
/** When the whale spouts: once each time a Claude finishes, every few seconds while one works, or never. */
export type MenuBarSpout = 'done' | 'working' | 'off';

export interface MenuBarLook {
  readonly preset: string;
  readonly count: MenuBarCount;
  /** "3 new" instead of "3". */
  readonly words: boolean;
  readonly spout: MenuBarSpout;
  /** 0: a small puff, 1: a big splash. */
  readonly splash: number;
  /** 0: slow, 1: quick. */
  readonly speed: number;
}

/** Each count: its name, what it means (said in Settings), and its word in the menu bar. */
export const COUNTS: ReadonlyArray<{ readonly id: MenuBarCount; readonly label: string; readonly means: string; readonly word: string }> = [
  {
    id: 'new',
    get label() {
      return t('macLib.menubar.count.new');
    },
    get means() {
      return t('macLib.menubar.count.new.means', { dock: dockName() });
    },
    get word() {
      return t('macLib.menubar.count.new.word');
    },
  },
  {
    id: 'waiting',
    get label() {
      return t('macLib.menubar.count.waiting');
    },
    get means() {
      return t('macLib.menubar.count.waiting.means');
    },
    get word() {
      return t('macLib.menubar.count.waiting.word');
    },
  },
  {
    id: 'working',
    get label() {
      return t('macLib.menubar.count.working');
    },
    get means() {
      return t('macLib.menubar.count.working.means');
    },
    get word() {
      return t('macLib.menubar.count.working.word');
    },
  },
  {
    id: 'room',
    get label() {
      return t('macLib.menubar.count.room');
    },
    get means() {
      return t('macLib.menubar.count.room.means');
    },
    get word() {
      return t('macLib.menubar.count.room.word');
    },
  },
  {
    id: 'friends',
    get label() {
      return t('macLib.menubar.count.friends');
    },
    get means() {
      return t('macLib.menubar.count.friends.means');
    },
    get word() {
      return t('macLib.menubar.count.friends.word');
    },
  },
  {
    id: 'none',
    get label() {
      return t('macLib.menubar.count.none');
    },
    get means() {
      return t('macLib.menubar.count.none.means');
    },
    get word() {
      return '';
    },
  },
];

export const DEFAULT_MENU_BAR: MenuBarLook = { preset: 'classic', count: 'new', words: false, spout: 'done', splash: 0.5, speed: 0.5 };

type LookPart = Omit<MenuBarLook, 'preset'>;

export const MENU_BAR_PRESETS: ReadonlyArray<{ readonly id: string; readonly name: string; readonly blurb: string; readonly look: LookPart }> = [
  {
    id: 'classic',
    get name() {
      return t('macLib.menubar.preset.classic');
    },
    get blurb() {
      return t('macLib.menubar.preset.classic.blurb');
    },
    look: { count: 'new', words: false, spout: 'done', splash: 0.5, speed: 0.5 },
  },
  {
    id: 'quiet',
    get name() {
      return t('macLib.menubar.preset.quiet');
    },
    get blurb() {
      return t('macLib.menubar.preset.quiet.blurb');
    },
    look: { count: 'none', words: false, spout: 'off', splash: 0.5, speed: 0.5 },
  },
  {
    id: 'people',
    get name() {
      return t('macLib.menubar.preset.people');
    },
    get blurb() {
      return t('macLib.menubar.preset.people.blurb');
    },
    look: { count: 'room', words: true, spout: 'done', splash: 0.35, speed: 0.5 },
  },
  {
    id: 'busy',
    get name() {
      return t('macLib.menubar.preset.busy');
    },
    get blurb() {
      return t('macLib.menubar.preset.busy.blurb');
    },
    look: { count: 'working', words: true, spout: 'working', splash: 0.75, speed: 0.65 },
  },
];

const same = (a: LookPart, b: LookPart): boolean => a.count === b.count && a.words === b.words && a.spout === b.spout && Math.abs(a.splash - b.splash) < 0.001 && Math.abs(a.speed - b.speed) < 0.001;

/** The preset these settings are ('custom': tuned by you). */
export function menuBarPresetOf(look: LookPart): string {
  return MENU_BAR_PRESETS.find((p) => same(p.look, look))?.id ?? 'custom';
}

const unit = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

/** Saved settings, made whole (and anything unknown put back to the default). */
export function menuBarLookOf(saved: unknown): MenuBarLook {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<keyof MenuBarLook, unknown>>;
  const d = DEFAULT_MENU_BAR;
  const look: LookPart = {
    count: COUNTS.some((c) => c.id === s.count) ? (s.count as MenuBarCount) : d.count,
    words: typeof s.words === 'boolean' ? s.words : d.words,
    spout: s.spout === 'done' || s.spout === 'working' || s.spout === 'off' ? s.spout : d.spout,
    splash: unit(s.splash, d.splash),
    speed: unit(s.speed, d.speed),
  };
  return { ...look, preset: menuBarPresetOf(look) };
}

/** Everything the number can count, right now. */
export type MenuBarCounts = Readonly<Record<Exclude<MenuBarCount, 'none'>, number>>;

/** What the menu bar shows beside the whale: "3", "3 new", or "" (nothing, at zero too). */
export function trayTitle(look: Pick<MenuBarLook, 'count' | 'words'>, counts: MenuBarCounts): string {
  if (look.count === 'none') return '';
  const n = counts[look.count];
  if (n <= 0) return '';
  const word = COUNTS.find((c) => c.id === look.count)?.word;
  return look.words && word ? t('macLib.menubar.tray', { n, word }) : String(n);
}

/** How often the whale spouts while Claude works. */
export const SPOUT_EVERY_MS = 6000;

/**
 * What the spout does as the working count moves from `before` to `now`: 'once' when a Claude
 * finished, 'repeat' / 'stop' to start or stop spouting while one works, nothing otherwise.
 */
export function spoutStep(spout: MenuBarSpout, before: number | undefined, now: number): 'once' | 'repeat' | 'stop' | undefined {
  if (spout === 'working') return now > 0 ? 'repeat' : 'stop';
  if (spout === 'done' && before !== undefined && now < before) return 'once';
  return undefined;
}
