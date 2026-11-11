import type { Message } from './message.js';
import * as sidebar from './areas/sidebar.js';
import * as composer from './areas/composer.js';
import * as settings from './areas/settings.js';
import * as tasks from './areas/tasks.js';
import * as plans from './areas/plans.js';
import * as phone from './areas/phone.js';

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
  'language.macShort': 'Your Mac',
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

  // ---- the daemon's notifications (src/core/notify.ts)
  'notify.finished': '{who} finished in {where}',
  'notify.done': 'Done',
  'notify.planFor': '{who} has a plan for {where}',
  'notify.planForBody': 'Approve it, or say what to change',
  'notify.yourCall': 'Your call in {where}',
  'notify.conflict': 'Merge conflict in {where}',
  'notify.conflictFiles': '{count} file(s): {files}',
  'notify.joined': '{name} joined',
  'notify.joinedAgent': 'They brought their {agent}',
  'notify.joinedHi': 'Say hi in the group chat',
  'notify.left': '{name} left',
  'notify.leftAgent': 'Their {agent} left with them',
  'notify.leftRoom': 'They left the room',
  'notify.testTitle': 'Notifications work',
  'notify.testBody': 'This is how Beluga tells you your agent finished or needs you',

  // ---- Needs You
  'needs.allowOnce': 'Allow once',
  'needs.approve': 'Approve',
  'needs.decline': 'Decline',
  'needs.always': 'Always',
  'needs.keepPlanning': 'Keep planning',
  'needs.skip': 'Skip',
  'needs.ask': 'Ask',
  'needs.notNow': 'Not now',
  'needs.resume': 'Resume',
  // agent-wording: claude (a plan's merge fixer is Claude, as needs-you.ts always said)
  'needs.askClaudeAgain': 'Ask Claude again',
  'needs.fix': 'Fix',
  'needs.approveAnyway': 'Approve anyway',
  'needs.discard': 'Discard',
  'needs.verifyThenApprove': 'Verify, then approve',
  'needs.pass': 'Pass',
  'needs.checkAgain': 'Check again',
  'needs.letIn': 'Let in',
  'needs.turnAway': 'Turn away',
  'needs.send': 'Send',
  'needs.sendChanges': 'Send changes',
  'needs.next': 'Next',
  'needs.sendBack': 'Send back',
  'needs.planToApprove': '{owner} has a plan for you to approve',
  'needs.askAgent': 'Ask {agent}?',
  'needs.aTask': 'A task',
  'needs.taskStalled': '“{title}” stopped twice: resume it?',
  // agent-wording: claude
  'needs.conflictStuck': 'A merge conflict Claude couldn’t fix',
  'needs.reviewFound': { one: 'The reviewer found one thing to fix in “{title}”', other: 'The reviewer found {count} things to fix in “{title}”' },
  'needs.approvePlan': 'Approve the plan “{title}”?',
  'needs.approveChanges': 'Approve the changes to “{title}”?',
  'needs.milestoneReady': '“{title}” is ready: pass it?',
  'needs.milestoneMergeFailed': '“{title}” couldn’t merge: pass it again?',
  'needs.wantsToComeIn': '{name} wants to come in',
  'needsYou.count': { one: '{count} thing needs you', other: '{count} things need you' },

  // ---- areas (src/shared/i18n/areas): each keeps its English and pt-BR side by side
  ...sidebar.en,
  ...composer.en,
  ...settings.en,
  ...tasks.en,
  ...plans.en,
  ...phone.en,
} as const satisfies Record<string, Message>;

/** Every key the app may say. */
export type Key = keyof typeof en;
