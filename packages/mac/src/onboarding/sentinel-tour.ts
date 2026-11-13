import type { Access, ClaudeWhere, StepKind, TriggerKind } from '../../../../src/core/sentinel/model.js';
import { computerWord } from '../lib/os-words.js';
// Relative, not @beluga: tests at the repo's root import this file too.
import { t } from '../../../../src/shared/i18n/index.js';

/**
 * The tour's Sentinel step (BLG-362): a few real sentinels, each said in a sentence (when, what,
 * and how you hear of it) and built from the same parts the Sentinel page has. One trigger, a
 * few steps, the access they need, and the report the run leaves. Pure, so a test can hold every
 * one to what Sentinel really allows (tests/mac-onboarding.test.ts).
 */

export interface TourStep {
  readonly kind: StepKind;
  /** What this step does here ("Write a brief of what changed"). */
  readonly detail: string;
  /** Where Claude works, for an Ask Claude step (a worktree needs Work access). */
  readonly where?: ClaudeWhere;
}

export interface TourSentinel {
  readonly id: string;
  readonly name: string;
  /** The sentence it's described in: when, what Claude does, and how you hear of it. */
  readonly said: readonly [when: string, what: string, then: string];
  readonly trigger: TriggerKind;
  /** The trigger in the Sentinel page's own words. */
  readonly when: string;
  readonly steps: readonly TourStep[];
  readonly access: Access;
  /** What the run left, in a line. */
  readonly report: { readonly title: string; readonly line: string };
}

/** What a tour sentinel says, said in the app's language each time it's read. */
interface TourWords {
  readonly name: string;
  readonly said: TourSentinel['said'];
  readonly when: string;
  /** Each step's detail, in the steps' order. */
  readonly details: readonly string[];
  readonly report: TourSentinel['report'];
}

function tour(base: Omit<TourSentinel, 'name' | 'said' | 'when' | 'steps' | 'report'> & { readonly steps: ReadonlyArray<Omit<TourStep, 'detail'>> }, words: () => TourWords): TourSentinel {
  const { steps, ...rest } = base;
  return {
    ...rest,
    get name() {
      return words().name;
    },
    get said() {
      return words().said;
    },
    get when() {
      return words().when;
    },
    get steps() {
      const details = words().details;
      return steps.map((st, i) => ({ ...st, detail: details[i] ?? '' }));
    },
    get report() {
      return words().report;
    },
  };
}

const K = 'components.onboarding.sentinelTour';

export const TOUR_SENTINELS: readonly TourSentinel[] = [
  tour(
    { id: 'brief', trigger: 'schedule', access: 'look', steps: [{ kind: 'claude', where: 'project' }, { kind: 'notify' }] },
    () => ({
      name: t(`${K}.brief.name`),
      said: [t(`${K}.brief.when`), t(`${K}.brief.what`), t(`${K}.brief.then`)],
      when: t(`${K}.brief.trigger`),
      details: [t(`${K}.brief.step1`), t(`${K}.brief.step2`, { computer: computerWord() })],
      report: { title: t(`${K}.brief.name`), line: t(`${K}.brief.report`) },
    }),
  ),
  tour(
    { id: 'ci', trigger: 'github', access: 'ship', steps: [{ kind: 'claude', where: 'worktree' }, { kind: 'pr' }, { kind: 'merge' }] },
    () => ({
      name: t(`${K}.ci.name`),
      said: [t(`${K}.ci.when`), t(`${K}.ci.what`), t(`${K}.ci.then`)],
      when: t(`${K}.ci.trigger`),
      details: [t(`${K}.ci.step1`), t(`${K}.ci.step2`), t(`${K}.ci.step3`)],
      report: { title: t(`${K}.ci.reportTitle`), line: t(`${K}.ci.report`) },
    }),
  ),
  tour(
    { id: 'payment', trigger: 'stripe', access: 'look', steps: [{ kind: 'claude', where: 'project' }, { kind: 'message' }] },
    () => ({
      name: t(`${K}.payment.name`),
      said: [t(`${K}.payment.when`), t(`${K}.payment.what`), t(`${K}.payment.then`)],
      when: t(`${K}.payment.trigger`),
      details: [t(`${K}.payment.step1`), t(`${K}.payment.step2`)],
      report: { title: t(`${K}.payment.reportTitle`), line: t(`${K}.payment.report`) },
    }),
  ),
  tour(
    { id: 'site', trigger: 'uptime', access: 'look', steps: [{ kind: 'script' }, { kind: 'http' }, { kind: 'notify' }] },
    () => ({
      name: t(`${K}.site.name`),
      said: [t(`${K}.site.when`), t(`${K}.site.what`), t(`${K}.site.then`)],
      when: t(`${K}.site.trigger`),
      details: ['./scripts/health.sh', t(`${K}.site.step2`), t(`${K}.site.step3`)],
      report: { title: t(`${K}.site.reportTitle`), line: t(`${K}.site.report`) },
    }),
  ),
  tour(
    { id: 'numbers', trigger: 'schedule', access: 'look', steps: [{ kind: 'measure' }] },
    () => ({
      name: t(`${K}.numbers.name`),
      said: [t(`${K}.numbers.when`), t(`${K}.numbers.what`), t(`${K}.numbers.then`)],
      when: t(`${K}.numbers.trigger`),
      details: [t(`${K}.numbers.step1`)],
      report: { title: t(`${K}.numbers.reportTitle`), line: t(`${K}.numbers.report`) },
    }),
  ),
];
