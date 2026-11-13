import { CircleCheck, CircleX, Clock } from 'lucide-react-native';
import { View } from 'react-native';
import { type Send, sends } from '../lib/sends';
import { t } from '../lib/language';
import { color } from '../lib/theme';
import { Press, T } from './ui';

/** Under a bubble of yours the Mac hasn't confirmed: its state in words, and Retry / Remove once it failed. */
export function SendStatus({ s }: { s: Send }) {
  if (s.state === 'failed') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, marginRight: 4 }}>
        <CircleX color={color.error} size={12} />
        <T v="caption" c={color.error} numberOfLines={2} style={{ flexShrink: 1 }}>
          {s.error ? t('phoneParts.send.notSentWhy', { why: s.error }) : t('phoneParts.send.notSent')}
        </T>
        <Press onPress={() => sends.retry(s.id)} hitSlop={8} accessibilityLabel={t('phoneParts.screen.tryAgain')}>
          <T v="caption" c={color.text} style={{ fontWeight: '700' }}>
            {t('phoneParts.screen.retry')}
          </T>
        </Press>
        <Press onPress={() => sends.remove(s.id)} hitSlop={8} accessibilityLabel={t('phoneParts.send.remove')}>
          <T v="caption" c={color.text2} style={{ fontWeight: '700' }}>
            {t('phoneParts.send.remove')}
          </T>
        </Press>
      </View>
    );
  }
  const words = s.state === 'waiting' ? t('phoneParts.send.waits') : s.state === 'unsure' ? t('phoneParts.send.checking') : s.state === 'sent' ? t('phone.needs.sent') : t('phoneParts.send.sending');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, marginRight: 4 }}>
      {s.state === 'sent' ? <CircleCheck color={color.text2} size={12} /> : <Clock color={color.text2} size={12} />}
      <T v="caption">{words}</T>
    </View>
  );
}
