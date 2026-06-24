import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TABS = [
  { name: 'Home', label: 'タスク', icon: '✓' },
  { name: 'Schedule', label: '予定', icon: '🕐' },
  { name: 'Flow', label: 'フロー', icon: '🔀' },
  { name: 'Timer', label: 'タイマー', icon: '⏱' },
  { name: 'Stats', label: '統計', icon: '📊' },
  { name: 'Notifications', label: '通知', icon: '!' },
] as const;

type TabName = typeof TABS[number]['name'];

interface Props {
  current: TabName;
  navigation: { navigate: (screen: string) => void };
}

const C = { card: '#ffffff', border: '#dbeafe', primary: '#111827', muted: '#111827' };

export default function TabBar({ current, navigation }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.tabBar, { height: 56 + insets.bottom, paddingBottom: insets.bottom }]}>
      {TABS.map(({ name, label, icon }) => {
        const active = current === name;
        return (
          <TouchableOpacity
            key={name}
            style={[s.tabItem, active && s.tabItemActive]}
            onPress={() => { if (!active) navigation.navigate(name); }}
          >
            <Text style={[s.tabIcon, active && s.tabLabelActive]}>{icon}</Text>
            <Text style={[s.tabLabel, active && s.tabLabelActive]} numberOfLines={1}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: C.card,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingTop: 4 },
  tabItemActive: { borderTopWidth: 2, borderTopColor: C.primary },
  tabIcon: { color: C.muted, fontSize: 16, fontWeight: '700' },
  tabLabel: { color: C.muted, fontSize: 9, fontWeight: '700' },
  tabLabelActive: { color: C.primary },
});
