/** Whether macOS lets Beluga notify (System Settings › Notifications › Beluga). */
export interface NotificationAccess {
  /**
   * `off`: turned off for Beluga; `unknown`: macOS won't say. Beluga's banners go through macOS's
   * older notification service, which the settings API doesn't describe, so on most Macs this is
   * `unknown` and a test is what tells (`notAsked` from an older app shell counts as `unknown`).
   */
  readonly state: 'allowed' | 'off' | 'notAsked' | 'unknown';
  /** Banners or alerts are on (otherwise they only collect in Notification Center). */
  readonly alerts: boolean;
  /** "Play sound for notifications" is on. */
  readonly sound: boolean;
  /**
   * A Focus (Do Not Disturb, Work…) is on and holding banners. macOS only tells apps with Full
   * Disk Access, so usually `unknown` (missing from an older app shell: `unknown` too).
   */
  readonly focus?: 'on' | 'off' | 'unknown';
  /** The Focus that's on ("Do Not Disturb"). */
  readonly focusName?: string;
}

import { t } from '../../../../../src/shared/i18n/index.js';
import { wordRecord } from '../../../../../src/shared/i18n/words.js';

export const UNKNOWN_ACCESS: NotificationAccess = { state: 'unknown', alerts: true, sound: true, focus: 'unknown' };

/** What fixes it: System Settings › Notifications › Beluga, or Focus settings. */
export type AccessAction = 'notifications' | 'focus';

export const ACTION_LABELS: Readonly<Record<AccessAction, string>> = wordRecord({
  notifications: 'macLib.access.openNotifications',
  focus: 'macLib.access.openFocus',
});

/** Beluga's own switches that keep banners away (Settings › Notifications, above). */
export interface OwnSettings {
  readonly desktop: boolean;
  /** Beluga's Do Not Disturb, while it's on ("until 3:00 PM"). */
  readonly quietUntil: string | null;
}

/** Which system the app runs on: only the Mac says anything about Beluga's notifications. */
export type NotifyOs = 'mac' | 'windows' | 'linux';

/**
 * When the system won't say whether banners are allowed: where to allow them, and where a banner
 * shows. Windows has a settings page to open; Linux desktops each keep their own, so no button.
 */
const UNSAID = (os: NotifyOs): { readonly detail: string; readonly where: string; readonly fix: string; readonly action?: AccessAction } =>
  os === 'linux'
    ? { detail: t('macLib.access.linuxDetail'), where: t('macLib.access.linuxWhere'), fix: t('macLib.access.linuxFix') }
    : os === 'windows'
      ? { detail: t('macLib.access.windowsDetail'), where: t('macLib.access.windowsWhere'), fix: t('macLib.access.windowsFix'), action: 'notifications' }
      : { detail: t('macLib.access.macDetail'), where: t('macLib.access.macWhere'), fix: t('macLib.access.macFix'), action: 'notifications' };

/** The line at the top of Settings › Notifications: how things stand, and what to do about it. */
export interface NotifyStatus {
  readonly tone: 'ok' | 'warn' | 'muted';
  /** "Notifications are on", "Blocked by macOS", "Not set up yet"… */
  readonly title: string;
  readonly detail: string;
  /** What to turn on, in one line (only when something is in the way). */
  readonly fix?: string;
  readonly action?: AccessAction;
}


/** Something in the way, and what it did to a test notification. */
type Block = NotifyStatus & { readonly action: AccessAction; readonly held: string };

/** Turned off, or banners or sound off, for Beluga in System Settings (`null`: none of these). */
function macBlock(a: NotificationAccess): Block | null {
  const action = 'notifications';
  if (a.state === 'off') return { tone: 'warn', title: t('macLib.access.blocked'), detail: t('macLib.access.blockedDetail'), fix: t('macLib.access.blockedFix'), action, held: t('macLib.access.blockedHeld') };
  if (a.state !== 'allowed') return null;
  if (!a.alerts) return { tone: 'warn', title: t('macLib.access.bannersOff'), detail: t('macLib.access.bannersOffDetail'), fix: t('macLib.access.bannersOffFix'), action, held: t('macLib.access.bannersOffHeld') };
  if (!a.sound) return { tone: 'warn', title: t('macLib.access.soundsOff'), detail: t('macLib.access.soundsOffDetail'), fix: t('macLib.access.soundsOffFix'), action, held: t('macLib.access.soundsOffHeld') };
  return null;
}

/** A Focus that's on (`null`: none is, or macOS won't say). */
function focusBlock(a: NotificationAccess): Block | null {
  if (a.focus !== 'on') return null;
  return {
    tone: 'warn',
    title: a.focusName ? t('macLib.access.focusOn', { name: a.focusName }) : t('macLib.access.aFocusOn'),
    detail: t('macLib.access.focusDetail'),
    fix: t('macLib.access.focusFix'),
    action: 'focus',
    held: a.focusName ? t('macLib.access.focusHeld', { name: a.focusName }) : t('macLib.access.aFocusHeld'),
  };
}

/** An older app shell's "not asked yet" isn't true for Beluga's banners: macOS just won't say. */
const normalize = (a: NotificationAccess): NotificationAccess => (a.state === 'notAsked' ? { ...a, state: 'unknown', alerts: true, sound: true } : a);

/** How things stand, from what macOS says and Beluga's own switches. */
export function notifyStatus(raw: NotificationAccess | undefined, own: OwnSettings, os: NotifyOs = 'mac'): NotifyStatus {
  if (!raw) return { tone: 'muted', title: t('macLib.access.checking'), detail: t('macLib.access.checkingDetail') };
  const a = normalize(raw);
  const mac = macBlock(a) ?? focusBlock(a);
  if (mac) return mac;
  if (!own.desktop) return { tone: 'muted', title: t('macLib.access.desktopOff'), detail: t('macLib.access.desktopOffDetail') };
  if (own.quietUntil) return { tone: 'muted', title: t('macLib.access.dndOn'), detail: t('macLib.access.dndDetail', { until: own.quietUntil }) };
  if (a.state === 'unknown') {
    const { detail, action } = UNSAID(os);
    return { tone: 'muted', title: t('macLib.access.sendTest'), detail, ...(action ? { action } : {}) };
  }
  if (a.focus === 'off') return { tone: 'ok', title: t('macLib.access.on'), detail: t('macLib.access.onDetail') };
  return { tone: 'ok', title: t('macLib.access.on'), detail: t('macLib.access.onDetailFocus') };
}

/** What happened to the test, in a sentence, and what to do if it didn't show. */
export interface TestOutcome {
  readonly tone: 'ok' | 'warn';
  readonly text: string;
  readonly action?: AccessAction;
}

/**
 * After a test: whether the banner can have shown. When macOS seems fine, say where to look and
 * what can still hold it (a Focus macOS doesn't tell Beluga about).
 */
export function testOutcome(raw: NotificationAccess, soundName: string | null, os: NotifyOs = 'mac'): TestOutcome {
  const a = normalize(raw);
  const heard = soundName ? ` ${t('macLib.access.heard', { name: soundName })}` : '';
  const block = macBlock(a) ?? focusBlock(a);
  if (block) return { tone: 'warn', text: `${block.held}${heard}`, action: block.action };
  // macOS closes the banners of the app you're using as soon as you click in it.
  const unsaid = UNSAID(os);
  const look = t('macLib.access.sent', { where: unsaid.where, heard });
  if (a.state === 'unknown') return { tone: 'ok', text: `${look} ${unsaid.fix}`, ...(unsaid.action ? { action: unsaid.action } : {}) };
  if (a.focus === 'off') return { tone: 'ok', text: look };
  return { tone: 'ok', text: t('macLib.access.sentFocus', { look }), action: 'focus' };
}
