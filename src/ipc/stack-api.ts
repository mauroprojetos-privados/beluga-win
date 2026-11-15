import { z } from 'zod';
import { CHECKLIST_ITEMS } from '../core/stack-store.js';

/**
 * Your stack (docs/stack.md): the services and tools your agents lean on, looked at and started by
 * the daemon (core/stack). Looking again is the phone's too (its Needs You card's Check Again), and
 * so is reading the checklist; setting a project up and fixing an item are the Mac's. Browser-safe.
 */

/** A project's or a worktree's id (its folder works too). */
const place = z.string().min(1).max(4096);

export const STACK_API = {
  // Look at the stack now (a service that's down is started, when Settings › Stack allows). → StackView
  'stack.check': { args: z.tuple([]) },
  // Set a project up for the stack now: indexes, its docs in OpenViking, a beluga.json and CLAUDE.md
  // where it has none (not committed). → what it did (BootstrapReport), or undefined while it already runs
  'stack.setupProject': { args: z.tuple([z.string().min(1).max(200)]) },
  // The checklist (docs/stack.md › Checklist): run it now for this computer and a project or worktree
  // (none: every project's main checkout), in the background. Changes nothing of yours (only what's the
  // project's own may start fixing itself, as on the daily run). → the checklist as it is (StackChecklist)
  'stack.checklist': { args: z.tuple([place.optional()]) },
  // Fix one checklist item: what changes a file of yours (~/.claude/settings.json, ~/.claude/CLAUDE.md,
  // .claude/agents/*.md, beluga.json) is backed up first; this call is your yes. → FixResult
  'stack.fix': { args: z.tuple([z.enum(CHECKLIST_ITEMS), place.optional()]) },
} as const;
