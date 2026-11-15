import { BUDGET_NEAR, type BudgetConfig, type BudgetNear, BUDGET_NEAR_DEFAULT, budgetTokens } from '@beluga/shared/budget.js';
import { Button } from '../components/ui.js';
import { toast, useApi, useApp, useBeluga } from '../lib/beluga.js';
import { Group, Row, Select } from './settings-controls.js';
import { useT } from '../lib/i18n.js';

/** The budgets offered (tokens); one set by hand in settings.json shows too. */
const CONVERSATION_STEPS = [500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000] as const;
const DAY_STEPS = [5_000_000, 10_000_000, 15_000_000, 20_000_000, 30_000_000, 50_000_000] as const;

/**
 * Settings › Agent › Budget (docs/budget.md): how many tokens a conversation and your day may
 * spend, and what happens at one: go on cheaper, ask (Needs You, on the phone too) or stop. A
 * project's beluga.json and a bot's bot.json set their own (`budget`); usage nearing one is said in
 * the conversation, and 80% of your plan's 5-hour window is said either way.
 */
export function BudgetSettings() {
  const t = useT();
  const api = useApi();
  const { client } = useBeluga();
  const budget = useApp((st) => st.prefs.budget);
  const allowed = useApp((st) => Object.keys(st.prefs.budgetAllow).length + st.prefs.budgetCheaper.length);
  const save = (next: BudgetConfig): void => {
    const set = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as BudgetConfig;
    void api.session.setPrefs({ budget: set.conversation === undefined && set.day === undefined && set.near === undefined ? null : set }).catch((err: unknown) => toast(client, err instanceof Error ? err.message : String(err), 'error'));
  };
  const options = (steps: readonly number[], now: number | undefined) => [
    { value: '', label: t('budget.settings.none') },
    ...[...new Set([...steps, ...(now !== undefined ? [now] : [])])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: t('budget.settings.tokens', { n: budgetTokens(n) }) })),
  ];
  const pick = (v: string): number | undefined => (v ? Number(v) : undefined);
  const near = budget?.near ?? BUDGET_NEAR_DEFAULT;
  return (
    <Group title={t('budget.settings.group')}>
      <Row label={t('budget.settings.conversation')} detail={t('budget.settings.conversationDetail')}>
        <Select label={t('budget.settings.conversation')} value={budget?.conversation !== undefined ? String(budget.conversation) : ''} onChange={(v) => save({ ...budget, conversation: pick(v) })} options={options(CONVERSATION_STEPS, budget?.conversation)} />
      </Row>
      <Row label={t('budget.settings.day')} detail={t('budget.settings.dayDetail')}>
        <Select label={t('budget.settings.day')} value={budget?.day !== undefined ? String(budget.day) : ''} onChange={(v) => save({ ...budget, day: pick(v) })} options={options(DAY_STEPS, budget?.day)} />
      </Row>
      <Row label={t('budget.settings.near')} detail={t(`budget.settings.nearDetail.${near}`)}>
        <Select<BudgetNear> label={t('budget.settings.near')} value={near} onChange={(v) => save({ ...budget, near: v })} options={BUDGET_NEAR.map((n) => ({ value: n, label: t(`budget.settings.nearChoice.${n}`) }))} />
      </Row>
      {allowed > 0 ? (
        <Row label={t('budget.settings.allowed')} detail={t('budget.settings.allowedDetail', { count: allowed })}>
          <Button size="small" onClick={() => void api.session.setPrefs({ budgetAllow: {}, budgetCheaper: [] })}>
            {t('budget.settings.clearAllowed')}
          </Button>
        </Row>
      ) : null}
    </Group>
  );
}
