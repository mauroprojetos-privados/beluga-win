import { hhmm } from './clock.js';
import { formatDateWith } from './i18n/format.js';
import { type Key, t } from './i18n/index.js';

// Remind Me Later on one conversation (BLG-748, BLG-770), as data: it stays quiet until then, then
// Beluga reminds you once. The core keeps the time (core/triage) and reminds; the screens offer it
// and show it. The Mac's menus and the phone's sheet offer these same times.

export type RemindChoice = 'hour' | 'hours' | 'tomorrow' | 'week';

const choice = (value: RemindChoice, key: Key): { readonly value: RemindChoice; readonly label: string } => ({
  value,
  get label() {
    return t(key);
  },
});

/** The times a screen offers, their labels in the app's language (read when they're said). */
export const REMIND_CHOICES: ReadonlyArray<{ readonly value: RemindChoice; readonly label: string }> = [
  choice('hour', 'shared.remind.hour'),
  choice('hours', 'shared.remind.hours'),
  choice('tomorrow', 'shared.remind.tomorrow'),
  choice('week', 'shared.remind.week'),
];

/** The hour a day starts (8 in the morning, local time), as Do Not Disturb's "tomorrow" (quiet.ts). */
const MORNING = 8;
const HOUR = 3_600_000;

/** When to remind you, for a choice made at `now`: tomorrow and next week (Monday) in the morning. */
export function remindTime(choice: RemindChoice, now = Date.now()): number {
  if (choice === 'hour') return now + HOUR;
  if (choice === 'hours') return now + 3 * HOUR;
  const d = new Date(now);
  // Next Monday (a week on, from a Monday).
  d.setDate(d.getDate() + (choice === 'tomorrow' ? 1 : ((8 - d.getDay()) % 7 || 7)));
  d.setHours(MORNING, 0, 0, 0);
  return d.getTime();
}

/** Each choice with its time, for a menu made at `now`. */
export const remindPresets = (now = Date.now()): ReadonlyArray<{ readonly label: string; readonly at: number }> => REMIND_CHOICES.map((c) => ({ label: c.label, at: remindTime(c.value, now) }));

/** Put off until later right now: quiet until it reminds you. */
export const remindPending = (until: number | undefined, now = Date.now()): until is number => until !== undefined && until > now;

/** When it reminds you, in the app's language: "at 14:30", "tomorrow at 08:00", "Mon at 08:00"; '' when nothing is put off. */
export function remindWhen(until: number | undefined, now = Date.now()): string {
  if (!remindPending(until, now)) return '';
  const end = new Date(until);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const time = hhmm(until);
  if (end.toDateString() === new Date(now).toDateString()) return t('shared.remind.at', { time });
  if (end.toDateString() === tomorrow.toDateString()) return t('shared.remind.tomorrowAt', { time });
  return t('shared.remind.dayAt', { day: formatDateWith(end, { weekday: 'short' }), time });
}

/** "Reminds you at 14:30", "… tomorrow at 08:00", "… Mon at 08:00"; '' when nothing is put off. */
export function remindLabel(until: number | undefined, now = Date.now()): string {
  const when = remindWhen(until, now);
  return when ? t('shared.remind.label', { when }) : '';
}
