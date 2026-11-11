import { type ReactNode, memo } from 'react';
import { Icon } from '../components/Icon.js';
import { cx } from '../components/ui.js';
import { openExternal } from '../lib/system.js';
import type { MergedItem, ShippedItem } from './merged-model.js';
import { type Key, type Params } from '@beluga/shared/i18n/index.js';
import { useT } from '../lib/i18n.js';
import s from './context.module.css';

/** Where a sentence's `{pr}` slot goes: the link, with the words around it said in the app's language. */
const PR_SLOT = '\u0000';
function WithPr({ said, pr }: { said: string; pr: ReactNode }) {
  const [before, after = ''] = said.split(PR_SLOT);
  return (
    <>
      {before}
      {pr}
      {after}
    </>
  );
}
const slotted = (t: (key: Key, params?: Params) => string, key: Key, params: Params): string => t(key, { ...params, pr: PR_SLOT });

/** A PR as a link to it on GitHub (or just its number). */
function PrLink({ number, url }: { number: number; url?: string }) {
  const t = useT();
  const pr = `PR #${number}`; // i18n-ignore
  if (!url) return <>{pr}</>;
  return (
    <button type="button" className={s.prLink} onClick={() => void openExternal(url)} title={t('chat.shipped.openOnGithub', { pr })}>
      {pr}
    </button>
  );
}

/**
 * Continue After Merge: the chat above went out in a pull request that merged, and what's below
 * is new work for the next one. The PR number opens it on GitHub.
 */
export const ShippedDivider = memo(function ShippedDivider({ item }: { item: ShippedItem }) {
  const m = item.shipped;
  const t = useT();
  return (
    <div className={cx(s.divider, s.shipped)} data-shipped-divider={m.number} role="separator" aria-label={item.text}>
      <div className={s.rule}>
        <span className={s.label}>
          <Icon name="merge" size={11} />
          <span>
            <WithPr said={slotted(t, 'chat.shipped.wentTo', { into: m.into })} pr={<PrLink number={m.number} {...(m.url ? { url: m.url } : {})} />} />
          </span>
        </span>
      </div>
      <div className={s.fresh}>{t('chat.shipped.fresh')}</div>
    </div>
  );
});

/**
 * The work above merged: in Beluga, on GitHub, or into the main folder. Said as it happens, so a
 * merge done elsewhere shows in the chat too. The PR number opens it on GitHub.
 */
export const MergedDivider = memo(function MergedDivider({ item }: { item: MergedItem }) {
  const m = item.merged;
  const t = useT();
  return (
    <div className={cx(s.divider, s.shipped)} data-merged-divider={m.number ?? 'merged'} role="separator" aria-label={item.text}>
      <div className={s.rule}>
        <span className={s.label}>
          <Icon name="merge" size={11} />
          <span>
            {m.number !== undefined ? <WithPr said={slotted(t, 'chat.shipped.mergedIn', { into: m.into })} pr={<PrLink number={m.number} {...(m.url ? { url: m.url } : {})} />} /> : t('chat.shipped.merged', { into: m.into })}
          </span>
        </span>
      </div>
    </div>
  );
});
