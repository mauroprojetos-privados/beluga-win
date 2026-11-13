import { Tabs } from 'expo-router';
import { TabBar } from '../../components/TabBar';
import { useT } from '../../lib/language';
import { color } from '../../lib/theme';

/** Home · Work · [Ask] · Chats · People, with the bar drawn by the app (components/TabBar.tsx). */
export default function TabsLayout() {
  const t = useT();
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.bg }, animation: 'shift' }}>
      <Tabs.Screen name="index" options={{ title: t('phone.tabs.home') }} />
      <Tabs.Screen name="work" options={{ title: t('phone.tabs.work') }} />
      <Tabs.Screen name="chats" options={{ title: t('phone.tabs.chats') }} />
      <Tabs.Screen name="people" options={{ title: t('phone.tabs.people') }} />
    </Tabs>
  );
}
