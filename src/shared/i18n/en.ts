import type { Message } from './message.js';

/**
 * English, the source catalog: every key is here first (docs/i18n.md). Keys are `area.thing`;
 * `{name}` is a slot, and a plural entry has its forms (`one`, `other`, and `count` in its params).
 * A key is added here, then in pt-BR.ts (tests/i18n.test.ts lists the ones missing there).
 */
export const en = {
  // ---- words used everywhere
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.save': 'Save',
  'common.done': 'Done',
  'common.ok': 'OK',
  'common.on': 'On',
  'common.off': 'Off',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.allow': 'Allow',
  'common.deny': 'Deny',
  'common.send': 'Send',
  'common.stop': 'Stop',
  'common.retry': 'Try Again',
  'common.delete': 'Delete',
  'common.open': 'Open',
  'common.back': 'Back',
  'common.more': 'More',
  'common.loading': 'Loading…',
  'common.search': 'Search',
  'common.settings': 'Settings',
  'common.notNow': 'Not Now',

  // ---- the language itself (Settings › General › Language)
  'language.title': 'Language',
  'language.auto': 'Automatic ({language})',
  'language.autoPlain': 'Automatic (the system’s)',
  'language.hint': 'Menus, buttons and notifications, and the language your agents answer in.',
  'language.followMac': 'Same as the Mac ({language})',
  'language.phoneHint': 'This phone’s language. By default it follows your Mac.',
  'language.commits': 'Language for commits and PRs',
  'language.commitsHint': 'What this project’s commit messages and pull requests are written in. It doesn’t follow the app’s language.',

  'common.and': 'and',

  // ---- time in words, where the engine has no Intl.RelativeTimeFormat (some phones)
  'time.now': 'now',
  'time.ago': '{n} {unit} ago',
  'time.in': 'in {n} {unit}',
  'time.second': { one: 'second', other: 'seconds' },
  'time.minute': { one: 'minute', other: 'minutes' },
  'time.hour': { one: 'hour', other: 'hours' },
  'time.day': { one: 'day', other: 'days' },
  'time.month': { one: 'month', other: 'months' },
  'time.year': { one: 'year', other: 'years' },

  // ---- Needs You
  'needsYou.count': { one: '{count} thing needs you', other: '{count} things need you' },
} as const satisfies Record<string, Message>;

/** Every key the app may say. */
export type Key = keyof typeof en;
