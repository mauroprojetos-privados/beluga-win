import type { IconName } from '../components/Icon.js';
import type { Step } from './onboarding-model.js';
import { thisComputer } from '../lib/os-words.js';
// Relative, not @beluga: tests at the repo's root import this file too.
import { t } from '../../../../src/shared/i18n/index.js';

/** The tour's words, one idea a step. Every line says what the app really does. */
export interface TourCopy {
  readonly eyebrow: string;
  readonly icon: IconName;
  readonly title: string;
  readonly body: string;
  readonly points: readonly string[];
}

// Getters: each line is said in the app's language when the step draws, not when this loads.
export const TOUR_COPY: Readonly<Partial<Record<Step, TourCopy>>> = {
  parallel: {
    icon: 'branch',
    get eyebrow() {
      return t('components.onboarding.tour.parallel.eyebrow');
    },
    get title() {
      return t('components.onboarding.tour.parallel.title');
    },
    get body() {
      return t('components.onboarding.tour.parallel.body');
    },
    get points() {
      return [t('components.onboarding.tour.parallel.point1'), t('components.onboarding.tour.parallel.point2'), t('components.onboarding.tour.parallel.point3')];
    },
  },
  agents: {
    icon: 'eye',
    get eyebrow() {
      return t('components.onboarding.tour.agents.eyebrow');
    },
    get title() {
      return t('components.onboarding.tour.agents.title');
    },
    get body() {
      return t('components.onboarding.tour.agents.body');
    },
    get points() {
      return [t('components.onboarding.tour.agents.point1'), t('components.onboarding.tour.agents.point2'), t('components.onboarding.tour.agents.point3')];
    },
  },
  tables: {
    icon: 'table',
    get eyebrow() {
      return t('components.onboarding.tour.tables.eyebrow');
    },
    get title() {
      return t('components.onboarding.tour.tables.title');
    },
    get body() {
      return t('components.onboarding.tour.tables.body');
    },
    get points() {
      return [t('components.onboarding.tour.tables.point1'), t('components.onboarding.tour.tables.point2'), t('components.onboarding.tour.tables.point3')];
    },
  },
  machines: {
    icon: 'server',
    get eyebrow() {
      return t('components.onboarding.tour.machines.eyebrow');
    },
    get title() {
      return t('components.onboarding.tour.machines.title');
    },
    get body() {
      return t('components.onboarding.tour.machines.body', { computer: thisComputer() });
    },
    get points() {
      return [t('components.onboarding.tour.machines.point1'), t('components.onboarding.tour.machines.point2'), t('components.onboarding.tour.machines.point3')];
    },
  },
  friends: {
    icon: 'people',
    get eyebrow() {
      return t('components.onboarding.tour.friends.eyebrow');
    },
    get title() {
      return t('components.onboarding.tour.friends.title');
    },
    get body() {
      return t('components.onboarding.tour.friends.body');
    },
    get points() {
      return [t('components.onboarding.tour.friends.point1'), t('components.onboarding.tour.friends.point2'), t('components.onboarding.tour.friends.point3')];
    },
  },
  sentinel: {
    icon: 'sentinel',
    get eyebrow() {
      return t('components.onboarding.tour.sentinel.eyebrow');
    },
    get title() {
      return t('components.onboarding.tour.sentinel.title');
    },
    get body() {
      return t('components.onboarding.tour.sentinel.body');
    },
    get points() {
      return [t('components.onboarding.tour.sentinel.point1'), t('components.onboarding.tour.sentinel.point2'), t('components.onboarding.tour.sentinel.point3')];
    },
  },
  uses: {
    icon: 'pulse',
    get eyebrow() {
      return t('components.onboarding.tour.uses.eyebrow');
    },
    get title() {
      return t('components.onboarding.tour.uses.title');
    },
    get body() {
      return t('components.onboarding.tour.uses.body');
    },
    get points() {
      return [t('components.onboarding.tour.uses.point1'), t('components.onboarding.tour.uses.point2'), t('components.onboarding.tour.uses.point3')];
    },
  },
  earnings: {
    icon: 'gauge',
    get eyebrow() {
      return t('components.onboarding.tour.earnings.eyebrow');
    },
    get title() {
      return t('components.onboarding.tour.earnings.title');
    },
    get body() {
      return t('components.onboarding.tour.earnings.body');
    },
    get points() {
      return [t('components.onboarding.tour.earnings.point1', { computer: thisComputer() }), t('components.onboarding.tour.earnings.point2'), t('components.onboarding.tour.earnings.point3')];
    },
  },
  archive: {
    icon: 'archive',
    get eyebrow() {
      return t('components.onboarding.tour.archive.eyebrow');
    },
    get title() {
      return t('components.onboarding.tour.archive.title');
    },
    get body() {
      return t('components.onboarding.tour.archive.body');
    },
    get points() {
      return [t('components.onboarding.tour.archive.point1'), t('components.onboarding.tour.archive.point2'), t('components.onboarding.tour.archive.point3')];
    },
  },
};
