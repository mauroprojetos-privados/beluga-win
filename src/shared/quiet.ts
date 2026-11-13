import type { NotifySettings } from './settings-schema.js';
import { hhmm } from './clock.js';
import { type Key, t } from './i18n/index.js';

// Do Not Disturb, as data: the core checks it before a desktop notification, the screens show it.

export type DndChoice = 'hour' | 'tomorrow' | 'forever';

const choice = (value: DndChoice, key: Key): { readonly value: DndChoice; readonly label: string } => ({
  value,
  get label() {
    return t(key);
  },
});

/** The choices a screen offers, their labels in the app's language (read when they're said). */
export const DND_CHOICES: ReadonlyArray<{ readonly value: DndChoice; readonly label: string }> = [
  choice('hour', 'shared.quiet.hour'),
  choice('tomorrow', 'shared.quiet.tomorrow'),
  choice('forever', 'shared.quiet.forever'),
];

/** The hour "tomorrow" starts (8 in the morning, local time). */
const MORNING = 8;

/** Do Not Disturb as it is saved, for a choice made at `now`. */
export function dndFor(choice: DndChoice, now = Date.now()): NonNullable<NotifySettings['dnd']> {
  if (choice === 'forever') return {};
  if (choice === 'hour') return { until: now + 3_600_000 };
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(MORNING, 0, 0, 0);
  return { until: d.getTime() };
}

/** Do Not Disturb is on right now. */
export const dndActive = (n: Pick<NotifySettings, 'dnd'>, now = Date.now()): boolean => Boolean(n.dnd) && (n.dnd?.until === undefined || n.dnd.until > now);

/** "until 14:30", "until tomorrow 08:00", "until you turn it off"; '' when off. English: the terminal's settings read it; a screen says dndWords(). */
export function dndLabel(n: Pick<NotifySettings, 'dnd'>, now = Date.now()): string {
  if (!dndActive(n, now)) return '';
  const until = n.dnd?.until;
  if (until === undefined) return 'until you turn it off';
  const end = new Date(until);
  const time = hhmm(until);
  return end.toDateString() === new Date(now).toDateString() ? `until ${time}` : `until tomorrow ${time}`;
}

/** dndLabel in the app's language: "until 14:30", "até 14:30". */
export function dndWords(n: Pick<NotifySettings, 'dnd'>, now = Date.now()): string {
  if (!dndActive(n, now)) return '';
  const until = n.dnd?.until;
  if (until === undefined) return t('shared.quiet.untilOff');
  const time = hhmm(until);
  return t(new Date(until).toDateString() === new Date(now).toDateString() ? 'shared.quiet.until' : 'shared.quiet.untilTomorrow', { time });
}

/** Each press makes it last longer: off → 1 hour → until tomorrow → until you turn it off → off. */
export function nextDnd(n: Pick<NotifySettings, 'dnd'>, now = Date.now()): NotifySettings['dnd'] {
  if (!dndActive(n, now)) return dndFor('hour', now);
  const until = n.dnd?.until;
  if (until === undefined) return null;
  return until <= dndFor('hour', now).until! ? dndFor('tomorrow', now) : dndFor('forever', now);
}
