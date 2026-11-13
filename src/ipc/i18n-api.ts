import { z } from 'zod';
import { LANGUAGE_CHOICES, LOCALES } from '../shared/i18n/locales.js';

/**
 * Languages (docs/i18n.md): the app's, from Settings › General › Language (`auto` is the system's;
 * the agents answer in it too), and a project's for its commits and pull requests, from its
 * Settings sheet (null: English). Only the Mac sets them. Browser-safe: zod only.
 */
export const I18N_API = {
  'settings.language': { args: z.tuple([z.enum(LANGUAGE_CHOICES)]) },
  'settings.commitLanguage': { args: z.tuple([z.string().min(1).max(80), z.enum(LOCALES).nullable().optional()]) },
} as const;
