/**
 * Experimental features (Settings › Experimental): early work that's off until you turn it on.
 * One list for the daemon (what Claude is told, what the API allows) and the screens (the pane
 * that explains each one). Browser-safe: data, its words read when they're said (the app's language).
 */

import { t } from './i18n/index.js';

export const EXPERIMENTS = ['previews'] as const;
export type Experiment = (typeof EXPERIMENTS)[number];

export interface ExperimentInfo {
  readonly id: Experiment;
  readonly title: string;
  /** One sentence: what it is. */
  readonly summary: string;
  /** What changes in Beluga while it's on, a line each. */
  readonly changes: readonly string[];
  /** What it costs this computer, in plain words. */
  readonly cost: string;
  /** Other words people would search Settings with. */
  readonly keywords: string;
}

export const EXPERIMENT_INFO: Readonly<Record<Experiment, ExperimentInfo>> = {
  previews: {
    id: 'previews',
    get title() {
      return t('shared.experiments.previews.title');
    },
    get summary() {
      return t('shared.experiments.previews.summary');
    },
    get changes() {
      return [t('shared.experiments.previews.change1'), t('shared.experiments.previews.change2'), t('shared.experiments.previews.change3'), t('shared.experiments.previews.change4'), t('shared.experiments.previews.change5')];
    },
    keywords: 'preview component react render storybook page html props live', // i18n-ignore
    get cost() {
      return t('shared.experiments.previews.cost');
    },
  },
};

/** Whether an experiment is on in a list of enabled ones (unknown ids from a newer Beluga are kept, never on). */
export function experimentOn(enabled: readonly string[] | undefined, id: Experiment): boolean {
  return Boolean(enabled?.includes(id));
}

/** The list with `id` turned on or off (a new list; order kept). */
export function withExperiment(enabled: readonly string[], id: Experiment, on: boolean): string[] {
  const rest = enabled.filter((e) => e !== id);
  return on ? [...rest, id] : rest;
}
