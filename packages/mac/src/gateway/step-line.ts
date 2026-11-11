import { humanizeLine } from '../../../../src/shared/step-titles.js';
import { t } from '../../../../src/shared/i18n/index.js';

/**
 * One line of a friend's task ("Bash npm test", or its owner being asked to allow a step) as a
 * plain row: words, the tool it used (for its icon) and the whole line (its tooltip). Only the
 * line travels between Macs, never what ran and what came back, so it has nothing to open.
 */
export interface TaskStepLine {
  readonly words: string;
  /** The tool the step used, when the line names one. */
  readonly tool?: string;
  /** The friend's Claude asked its owner to allow a step. */
  readonly asked: boolean;
  readonly full: string;
}

/** What the gateway writes when it asks its owner (see core/gateway/serve.ts allowTool). */
const ASKED = /^Your agent \(working on .+?'s request\) wants to (?:use (\S+)|change (.+?), a file that can run commands)/;
const TOOL = /^((?:mcp__)?[A-Za-z][\w-]*)\s/;

/** `owner`: whose Mac it ran on, when it's not yours (a task you sent); else the ask was to you. */
export function taskStepLine(line: string, owner?: string): TaskStepLine {
  const asked = ASKED.exec(line);
  if (asked) {
    const what = asked[1] ? asked[1].replace(/^mcp__beluga__/, '') : t('github.step.changing', { file: asked[2] ?? '' });
    return { words: owner !== undefined ? t('github.step.asked', { who: owner, what }) : t('github.step.askedYou', { what }), asked: true, full: line };

  }
  const tool = TOOL.exec(`${line} `)?.[1];
  const words = humanizeLine(line).done;
  return { words, asked: false, full: line, ...(tool && words !== line ? { tool } : {}) };
}
