/**
 * Your stack (docs/stack.md), in the shared state: the services and tools your agents lean on
 * (Ollama, OpenViking, hooktop; rtk, token-goat, GitNexus, graphify, graph-loop-solo's gls), as the daemon last found
 * them. The daemon looks (core/stack/monitor.ts); Settings › Stack and Needs You show it.
 * Browser-safe: the Mac app reads it.
 */

/** The services, looked at over the network on this computer. */
export const STACK_SERVICES = ['ollama', 'openviking', 'hooktop'] as const;
/** The tools, looked for on your login PATH. */
export const STACK_TOOLS = ['rtk', 'token-goat', 'gitnexus', 'graphify', 'gls'] as const;
export const STACK_CHECKS = [...STACK_SERVICES, ...STACK_TOOLS] as const;

export type StackService = (typeof STACK_SERVICES)[number];
export type StackTool = (typeof STACK_TOOLS)[number];
export type StackCheckId = (typeof STACK_CHECKS)[number];

/** `up`: it answers (a service) or is installed (a tool); `down`: a service that doesn't answer; `missing`: not installed. */
export type StackState = 'up' | 'down' | 'missing';

export interface StackCheck {
  readonly id: StackCheckId;
  readonly kind: 'service' | 'tool';
  readonly state: StackState;
  /** Beluga started it during this outage (it may still be coming up). */
  readonly started?: boolean;
}

export interface StackView {
  /** Empty until the first look. */
  readonly checks: readonly StackCheck[];
  /** When it last looked (ms). */
  readonly checkedAt?: number;
  /** A look is under way. */
  readonly checking: boolean;
}

export interface StackSlice {
  readonly stack: StackView;
}

export const initialStack: StackSlice = { stack: { checks: [], checking: false } };

export type StackAction = { type: 'stack'; stack: StackView };

export const isService = (id: StackCheckId): id is StackService => (STACK_SERVICES as readonly string[]).includes(id);

/** What's down or missing now. */
export const stackProblems = (view: StackView): readonly StackCheck[] => view.checks.filter((c) => c.state !== 'up');

/** The i18n key part for a check's id (`token-goat` → `tokenGoat`). */
export const stackKey = (id: StackCheckId): string => id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
