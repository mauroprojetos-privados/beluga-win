import { BELUGA } from '../../components/beluga-path.js';
import { DotMatrix } from '../../components/DotMatrix.js';
import { Icon } from '../../components/Icon.js';
import { Button, Empty, cx } from '../../components/ui.js';
import { GHOST_WIDTHS } from './scratch-model.js';
import k from './scratch.module.css';
import { revealLabel } from '../../lib/os-words.js';
import { useT } from '../../lib/i18n.js';

/**
 * The Scratch tab before it has a listing: the list and the preview drawn in outline, softly
 * moving, while the first look is on its way. Once looked and nothing's there, `ScratchEmpty`
 * says so instead (the skeleton never stays up on an empty folder).
 */

function GhostRow({ width }: { width: number }) {
  return (
    <div className={k.ghost}>
      <span className={k.icon} />
      <span className={cx(k.bar, k.name)} style={{ width: `${width}%` }} />
      <span className={cx(k.bar, k.meta)} />
    </div>
  );
}

export function ScratchSkeleton() {
  const t = useT();
  return (
    <div className={cx(k.skeleton, k.live)} aria-busy>
      <div className={k.status} role="status">
        <Icon name="pulse" size={13} />
        <span>{t('layout.scratch.looking')}</span>
      </div>
      <div className={k.ghosts} aria-hidden>
        {GHOST_WIDTHS.map((w) => (
          <GhostRow key={w} width={w} />
        ))}
      </div>
      <div className={k.tile} aria-hidden>
        <Icon name="image" size={22} />
      </div>
    </div>
  );
}

interface ScratchEmptyProps {
  readonly working: boolean;
  /** Claude is given no scratch folder (Settings › Claude). */
  readonly off: boolean;
  /** Beluga's own folder (where Show in Finder goes). */
  readonly dir: string;
  /** Show in Finder (not for a friend's worktree: it's on their Mac). */
  readonly onReveal?: () => void;
}

/** The app's beluga, quiet, over the empty state. */
function BelugaMark() {
  return (
    <svg className={k.mark} width="40" height="32" viewBox="56 147 912 730" aria-hidden="true">
      <path d={BELUGA} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/** Looked, and nothing's there yet: what will land here, and where it is. */
export function ScratchEmpty({ working, off, dir, onReveal }: ScratchEmptyProps) {
  const t = useT();
  return (
    <div className={k.empty}>
      <Empty
        icon="image"
        mark={<BelugaMark />}
        title={t('layout.scratch.nothingYet')}
        detail={off ? t('layout.scratch.off') : t('layout.scratch.emptyDetail')}
        action={
          <>
            {working ? (
              <div className={k.emptyWorking} role="status">
                <DotMatrix size={12} />
                <span>{t('layout.scratch.working')}</span>
              </div>
            ) : null}
            {onReveal ? (
              <Button icon="folder" title={dir} onClick={onReveal}>
              {revealLabel()}
            </Button>
            ) : null}
          </>
        }
      />
    </div>
  );
}

/** On top of the list while Claude works: a file row on its way, its size and time still to come. */
export function NextFileRow() {
  const t = useT();
  return (
    <div className={cx(k.next, k.live)} role="status">
      <DotMatrix size={12} />
      <span className={k.nextLabel}>{t('layout.scratch.working')}</span>
      <span className={cx(k.bar, k.nextSize)} aria-hidden />
      <span className={cx(k.bar, k.nextAgo)} aria-hidden />
    </div>
  );
}
