import type { IconName } from '../components/Icon.js';
import type { Grant, PrivacyPane } from '../lib/privacy-model.js';
import type { AccessStep } from './onboarding-model.js';
// Relative, not @beluga: tests at the repo's root import this file too.
import { t } from '../../../../src/shared/i18n/index.js';

/**
 * The permission steps' words: what each lets Claude do, in one sentence, and where it lives in
 * System Settings. Every one is optional; nothing in Beluga stops working without it.
 */
export interface AccessCopy {
  readonly pane: PrivacyPane;
  readonly icon: IconName;
  /** As System Settings names it. */
  readonly name: string;
  readonly title: string;
  /** Why it may be useful, in one sentence. */
  readonly why: string;
  /** What happens without it. */
  readonly without: string;
  /** What to do once System Settings is open. */
  readonly how: string;
}

// Getters: each line is said in the app's language when the step draws, not when this loads.
export const ACCESS_COPY: Readonly<Record<AccessStep, AccessCopy>> = {
  screen: {
    pane: 'screen',
    icon: 'eye',
    get name() {
      return t('components.onboarding.access.screen.name');
    },
    get title() {
      return t('components.onboarding.access.screen.title');
    },
    get why() {
      return t('components.onboarding.access.screen.why');
    },
    get without() {
      return t('components.onboarding.access.screen.without');
    },
    get how() {
      return t('components.onboarding.access.screen.how');
    },
  },
  accessibility: {
    pane: 'accessibility',
    icon: 'hand',
    get name() {
      return t('components.onboarding.access.accessibility.name');
    },
    get title() {
      return t('components.onboarding.access.accessibility.title');
    },
    get why() {
      return t('components.onboarding.access.accessibility.why');
    },
    get without() {
      return t('components.onboarding.access.accessibility.without');
    },
    get how() {
      return t('components.onboarding.access.turnOn');
    },
  },
  disk: {
    pane: 'disk',
    icon: 'folder',
    get name() {
      return t('components.onboarding.access.disk.name');
    },
    get title() {
      return t('components.onboarding.access.disk.title');
    },
    get why() {
      return t('components.onboarding.access.disk.why');
    },
    get without() {
      return t('components.onboarding.access.disk.without');
    },
    get how() {
      return t('components.onboarding.access.disk.how');
    },
  },
  automation: {
    pane: 'automation',
    icon: 'wand',
    get name() {
      return t('components.onboarding.access.automation.name');
    },
    get title() {
      return t('components.onboarding.access.automation.title');
    },
    get why() {
      return t('components.onboarding.access.automation.why');
    },
    get without() {
      return t('components.onboarding.access.automation.without');
    },
    get how() {
      return t('components.onboarding.access.automation.how');
    },
  },
};

/** The step's main button: what pressing it does now. */
export function accessAction(grant: Grant | undefined): string {
  return grant === 'granted' ? t('components.onboarding.access.openSettings') : t('components.onboarding.access.allowInSettings');
}

/** The footer's button on a permission step: go on, or pass on this one (its English; the footer says it in the app's language). */
export const accessNext = (grant: Grant | undefined): 'Continue' | 'Not Now' => (grant === 'granted' ? 'Continue' : 'Not Now');

/** The line under the step's title: how it stands. */
export function grantText(grant: Grant | undefined, asked: boolean): string {
  if (grant === 'granted') return t('components.onboarding.access.allowed');
  if (grant === 'off') return asked ? t('components.onboarding.access.waiting') : t('components.onboarding.access.notYet');
  return asked ? t('components.onboarding.access.opened') : t('components.onboarding.access.optional');
}
