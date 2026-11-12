import { type Player, cantPlay as cantPlayEnglish, videoFormat } from '../../../src/companion/media';
import { t } from '../../../src/shared/i18n/index';

/** Which videos play here, and their URLs under the media server (shared with the Mac: src/companion/media.ts). */
export { isGif, mediaPath, type Player, videoFormat } from '../../../src/companion/media';

/** Undefined when it should play here; else why not, in the phone's language. */
export function cantPlay(name: string, on: Player): string | undefined {
  if (!cantPlayEnglish(name, on)) return undefined;
  return t(videoFormat(name) ? 'shared.media.noWebm' : 'shared.media.noKind');
}
