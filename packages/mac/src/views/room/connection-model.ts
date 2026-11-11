import type { AppState, ConnectionTrouble } from '../../../../../src/core/store.js';
import { t } from '../../../../../src/shared/i18n/index.js';

/** Why, for the status's tooltip. */
export function connectionHint(trouble: ConnectionTrouble): string {
  return trouble.attempt > 1 ? t('views.room.tries', { reason: trouble.reason, count: trouble.attempt }) : trouble.reason;
}

/** The one line the room shows while it can't be reached, e.g. "Can’t reach the room · retrying in 12s". */
export function connectionLine(trouble: ConnectionTrouble, now: number): { lead: string; detail: string; canRetry: boolean } {
  if (trouble.state === 'offline') return { lead: t('views.room.offline'), detail: trouble.reason, canRetry: false };
  const left = Math.ceil(((trouble.retryAt ?? now) - now) / 1000);
  const detail = left > 0 ? t('views.room.retryingIn', { n: left }) : t('views.room.retryingNow');
  return { lead: t('views.room.cantReach'), detail, canRetry: left > 0 };
}

/** The sidebar footer's words and tone: who's in the room, or how the link to it is doing. */
export function footerStatus(st: Pick<AppState, 'status' | 'room'> & { readonly people: number; readonly ready: boolean; readonly reconnecting: boolean }): { label: string; tone: 'ok' | 'warn' | 'error' } {
  if (st.status === 'connected') return { label: st.people > 1 ? t('views.room.people', { count: st.people, room: st.room }) : st.ready ? t('views.room.inviteReady') : t('views.room.justYou'), tone: 'ok' };
  if (st.reconnecting) return { label: t('views.room.reconnecting'), tone: 'warn' };
  return st.status === 'connecting' ? { label: t('views.room.connecting'), tone: 'warn' } : { label: t('views.room.offline'), tone: 'error' };
}
