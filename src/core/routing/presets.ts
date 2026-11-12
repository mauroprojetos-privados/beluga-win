import { type CategoryCombos, type Combo, DEFAULT_COMBOS, MAX_COMBOS, type RoleCombos } from './model.js';

/**
 * "Claude by kind of work" (docs/stack.md, docs/routing.md): the model each kind of work and each
 * plan role starts on, with Claude only — planning and hard problems on Opus, building on Sonnet,
 * quick changes, exploring and writing docs on Haiku — each a chain that goes on to the next model
 * when one hits its usage limit. Browser-safe: data the Mac's Combos settings offer too.
 */

export const CLAUDE_KIND_COMBOS: readonly Combo[] = [
  { id: 'claude-opus', name: 'Claude: Opus first', targets: [{ runtime: 'claude', model: 'opus' }, { runtime: 'claude', model: 'sonnet' }] },
  { id: 'claude-sonnet', name: 'Claude: Sonnet first', targets: [{ runtime: 'claude', model: 'sonnet' }, { runtime: 'claude', model: 'opus' }, { runtime: 'claude', model: 'haiku' }] },
  { id: 'claude-haiku', name: 'Claude: Haiku first', targets: [{ runtime: 'claude', model: 'haiku' }, { runtime: 'claude', model: 'sonnet' }] },
];

/** Each kind of work's combo. A review judges work, so it stays on Sonnet. */
export const CLAUDE_KIND_CATEGORIES: CategoryCombos = {
  ultrabrain: { combo: 'claude-opus' },
  deep: { combo: 'claude-sonnet' },
  visual: { combo: 'claude-sonnet' },
  review: { combo: 'claude-sonnet' },
  quick: { combo: 'claude-haiku' },
  docs: { combo: 'claude-haiku' },
  explore: { combo: 'claude-haiku' },
};

/** A plan's roles: its head plans on Opus; milestones, checks and reviews build and judge on Sonnet. */
export const CLAUDE_KIND_ROLES: RoleCombos = { planHead: 'claude-opus', milestone: 'claude-sonnet', checker: 'claude-sonnet', reviewer: 'claude-sonnet' };

/**
 * The prefs that set it: your combos (the saved ones, else the defaults) with the three Claude
 * combos added where they aren't, and the kinds' and roles' combos.
 */
export function claudeByKind(saved: readonly Combo[] | undefined): { combos: Combo[]; categoryCombos: CategoryCombos; roleCombos: RoleCombos } {
  const base = [...(saved ?? DEFAULT_COMBOS)];
  const missing = CLAUDE_KIND_COMBOS.filter((c) => !base.some((b) => b.id === c.id));
  // Never past the limit: a kind whose combo didn't fit starts on your agent, as before.
  return { combos: [...base, ...missing].slice(0, MAX_COMBOS).map((c) => ({ ...c, targets: [...c.targets] })), categoryCombos: { ...CLAUDE_KIND_CATEGORIES }, roleCombos: { ...CLAUDE_KIND_ROLES } };
}
