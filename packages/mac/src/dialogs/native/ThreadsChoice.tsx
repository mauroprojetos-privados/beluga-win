import { type ReactElement, useState } from 'react';
import type { ThreadChildren } from '@beluga/shared/threads.js';
import { Checkbox } from '../../components/Alert.js';
import { useApp } from '../../lib/beluga.js';
import { threadFamily } from '../../lib/thread-family.js';
import { useT } from '../../lib/i18n.js';

/**
 * The one question about a chat's threads inside its archive or delete dialog. `box` is null with no
 * threads, and `children` is then undefined: the call stays as it was. Archive's default is to
 * archive them too. Delete's default is to keep them.
 */
export function useThreadsChoice(picked: string | readonly string[], action: 'archive' | 'delete'): { readonly box: ReactElement | null; readonly children?: ThreadChildren } {
  const n = useApp((st) => threadFamily(st, picked, action).count);
  const running = useApp((st) => threadFamily(st, picked, action).running);
  const [too, setToo] = useState(action === 'archive');
  const t = useT();
  if (!n) return { box: null };
  const one = typeof picked === 'string' || picked.length === 1;
  const working = running ? t('native.threads.working', { count: running }) : '';
  const box =
    action === 'archive' ? (
      <Checkbox checked={too} onChange={setToo} label={t(one ? 'native.threads.archiveIts' : 'native.threads.archiveTheir', { count: n })} detail={t('native.threads.archiveDetail', { working })} />
    ) : (
      <Checkbox checked={too} onChange={setToo} label={t(one ? 'native.threads.deleteIts' : 'native.threads.deleteTheir', { count: n })} detail={t('native.threads.deleteDetail', { working })} />
    );
  return { box, children: too ? 'with' : 'keep' };
}
