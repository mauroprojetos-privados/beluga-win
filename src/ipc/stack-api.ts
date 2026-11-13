import { z } from 'zod';

/**
 * Your stack (docs/stack.md): the services and tools your agents lean on, looked at and started by
 * the daemon (core/stack). Looking again is the phone's too (its Needs You card's Check Again);
 * setting a project up for the stack is the Mac's. Browser-safe: zod only.
 */
export const STACK_API = {
  // Look at the stack now (a service that's down is started, when Settings › Stack allows). → StackView
  'stack.check': { args: z.tuple([]) },
  // Set a project up for the stack now: indexes, its docs in OpenViking, a beluga.json and CLAUDE.md
  // where it has none (not committed). → what it did (BootstrapReport), or undefined while it already runs
  'stack.setupProject': { args: z.tuple([z.string().min(1).max(200)]) },
} as const;
