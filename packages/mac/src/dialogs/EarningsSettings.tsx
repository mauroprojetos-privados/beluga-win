import { useCurrencyChoice } from '../lib/earnings.js';
import { Group, Row, Select } from './settings-controls.js';
import { say, useT } from '../lib/i18n.js';

/** "Show earnings in": the one currency every earnings total is added up in. */
export function CurrencySelect({ id, size, className }: { id?: string; size?: 'regular' | 'small'; className?: string }) {
  const t = useT();
  const choice = useCurrencyChoice();
  return <Select id={id} className={className} label={t('prefs.earnings.row')} value={choice.value} options={choice.options} onChange={choice.onChange} size={size} searchPlaceholder={t('prefs.earnings.search')} />;
}

/** Settings › General › Earnings. */
export function EarningsSettings() {
  const t = useT();
  return (
    <Group title={say('Earnings')}>
      <Row label={say('Show earnings in')} detail={t('prefs.earnings.detail')}>
        <CurrencySelect />
      </Row>
    </Group>
  );
}
