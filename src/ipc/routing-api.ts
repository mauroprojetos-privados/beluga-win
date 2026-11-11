import { z } from 'zod';
import { Combo, MAX_COMBOS } from '../core/routing/model.js';

/**
 * Combos (core/routing, docs/routing.md): named, ordered chains of agents and models a conversation
 * picks instead of one model; each run goes to the first that can run. Reading them, and which one a
 * run used, is the phone's too; changing them is Settings › Agents › Combos on the Mac.
 * Browser-safe: zod only.
 */

const channel = z.string().min(1).max(200);
const id = z.string().min(1).max(200);

export const ROUTING_API = {
  // Your combos (the defaults as this computer has them until you change one), each target with why
  // it can't run now, and the one it would run on. → { combos: ComboChoice[], custom }
  'routing.combos': { args: z.tuple([]) },
  // The combo and target a conversation's newest run on a combo used, or the run `requestId` names. → RunRoute | undefined
  'routing.runRoute': { args: z.tuple([channel, id.optional()]) },
  // Your combos, the whole list (add, rename, reorder targets, delete). → the saved list
  'routing.setCombos': { args: z.tuple([z.array(Combo).max(MAX_COMBOS)]) },
  // Back to the defaults. → the defaults as this computer has them
  'routing.resetCombos': { args: z.tuple([]) },
} as const;
