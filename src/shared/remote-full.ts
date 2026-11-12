import { t } from './i18n/index.js';

/** What the owner reads before a hosted service gets Full trust: in the CLI and on the sign-in page (English: they read it as it is). */
export const REMOTE_FULL_WARNING = "This gives the hosted service your full power on this Mac, with no card. It can reach Beluga's own token, and anyone who runs that service gets it.";

/** The same warning on a screen, in the app's language. */
export const remoteFullWarning = (): string => t('shared.remoteFull.warning');
