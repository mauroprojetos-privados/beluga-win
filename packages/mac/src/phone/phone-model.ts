import type { DeviceView } from '../../../../src/companion/protocol.js';
import type { PhoneTouchData } from '../../../../src/ipc/client.js';
import { t } from '../../../../src/shared/i18n/index.js';

/**
 * What the Mac says about your phones (docs/companion.md, "On the Mac"): pure, so it's tested
 * without a window.
 */

/** "just now", "12 min ago", "3 h ago", "yesterday", "4 days ago". */
export function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return t('project.phoneModel.justNow');
  const m = Math.round(s / 60);
  if (m < 60) return t('project.phoneModel.minAgo', { m });
  const h = Math.round(m / 60);
  if (h < 24) return t('project.phoneModel.hAgo', { h });
  const d = Math.round(h / 24);
  return d === 1 ? t('project.phoneModel.yesterday') : t('project.phoneModel.daysAgo', { d });
}

/** One phone's state in words: "linked", "last seen 12 min ago", "not linked yet". */
export function seenText(d: { readonly linked: boolean; readonly lastSeen?: number }, now: number): string {
  if (d.linked) return t('project.phoneModel.linked');
  return d.lastSeen ? t('project.phoneModel.lastSeen', { ago: ago(d.lastSeen, now) }) : t('project.phoneModel.notLinkedYet');
}

/** The footer mark: lit while any phone is linked, outlined while they're all away; its hover text. */
export function markOf(devices: readonly DeviceView[], now: number): { readonly lit: boolean; readonly title: string } {
  const linked = devices.filter((d) => d.linked);
  if (linked.length) return { lit: true, title: linked.map((d) => t('project.phoneModel.nameLinked', { name: d.name })).join(', ') };
  const last = [...devices].sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))[0];
  return { lit: false, title: last ? `${last.name} · ${seenText(last, now)}` : t('project.phone.pairAPhone') };
}

/** "8 min left" for an open pairing. */
export function leftText(expiresAt: number, now: number): string {
  const m = Math.max(0, Math.ceil((expiresAt - now) / 60_000));
  return m <= 1 ? t('project.phoneModel.lessThanMinute') : t('project.phoneModel.minLeft', { m });
}

const keyWords = (): Record<string, string> => ({
  back: t('common.back'),
  home: t('project.phoneModel.key.home'),
  recents: t('project.phoneModel.key.recents'),
  enter: 'Enter', // i18n-ignore
  notifications: t('project.phoneModel.key.notifications'),
  quick_settings: t('project.phoneModel.key.quickSettings'),
  lock: t('project.phoneModel.key.lock'),
  power_dialog: t('project.phoneModel.key.powerMenu'),
});

/** What Claude just did on the phone, as the mirror's caption says it (BLG-186). Never what it typed. */
export function touchCaption(touch: PhoneTouchData): string {
  switch (touch.op) {
    case 'tap':
      return t('project.phoneModel.tapped');
    case 'long_press':
      return t('project.phoneModel.pressedHeld');
    case 'swipe':
      return t('project.phoneModel.swiped');
    case 'type':
      return t('project.phoneModel.typed');
    case 'key':
      return t('project.phoneModel.pressed', { what: keyWords()[touch.what ?? ''] ?? touch.what ?? t('project.phoneModel.aKey') });
    case 'scroll':
      return touch.what ? t('project.phoneModel.scrolledWhat', { what: touch.what }) : t('project.phoneModel.scrolled');
    case 'open':
      return t('project.phoneModel.opened', { what: touch.what ?? t('project.phoneModel.anApp') });
  }
}
