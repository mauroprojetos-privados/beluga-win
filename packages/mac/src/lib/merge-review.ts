// The merge checks live with the workspaces (src/workspaces/merge-review.ts), so the phone's Merge
// (companion.mergeCheck) says exactly what the Mac's sheet says. Relative path: the root tests load it too.
// The Mac says them in the app's language: the same checks, their words read here (docs/i18n.md).
import { t } from '../../../../src/shared/i18n/index.js';
import type { MergePreview } from '../../../../src/workspaces/merge-preview.js';
import { type MergeCheck, type MergeReview, reviewMerge as reviewMergeEn } from '../../../../src/workspaces/merge-review.js';

export * from '../../../../src/workspaces/merge-review.js';

const listed = (files: readonly string[], max = 3): string => (files.length > max ? t('macLib.merge.listedMore', { files: files.slice(0, max).join(', '), n: files.length - max }) : files.join(', '));

function sayCheck(c: MergeCheck, p: MergePreview): string {
  switch (c.id) {
    case 'uncommitted':
      return t('macLib.merge.uncommitted', { count: p.uncommitted });
    case 'nothing':
      return t('macLib.merge.nothing', { into: p.into, from: p.from });
    case 'branch':
      return t('macLib.merge.branch', { on: p.folderOn ?? '', into: p.into });
    case 'dirty':
      return t('macLib.merge.dirty', { files: listed(p.folderChanges) });
    case 'conflicts':
      return c.tone === 'ok' ? t('macLib.merge.noConflicts') : t('macLib.merge.conflicts', { count: p.conflicts?.length ?? 0, files: listed(p.conflicts ?? []) });
    case 'folder':
      return t('macLib.merge.folder', { into: p.into });
    case 'newer':
      return t('macLib.merge.newer', { into: p.into, from: p.from, count: p.newOnTarget });
    default:
      return c.text;
  }
}

/** The checks before a merge, as the daemon reviews them, in the app's language. */
export function reviewMerge(p: MergePreview): MergeReview {
  const r = reviewMergeEn(p);
  return { ...r, checks: r.checks.map((c) => ({ ...c, text: sayCheck(c, p) })), confirm: r.canMerge ? t('macLib.merge.confirm', { count: p.commitCount }) : t('macLib.merge.confirmPlain') };
}
