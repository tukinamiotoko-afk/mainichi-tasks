import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { GRAD_START, GRAD_END } from '../constants/theme';
import { useTheme, ColorSet } from '../contexts/ThemeContext';

const TABS = [
  { name: 'Home', label: 'タスク', icon: '📋' },
  { name: 'Schedule', label: '予定', icon: '📅' },
  { name: 'Flow', label: 'フロー', icon: '📌' },
  { name: 'Timer', label: '計測', icon: '⏱️' },
  { name: 'Stats', label: '統計', icon: '📊' },
  { name: 'Notifications', label: '設定', icon: '⚙️' },
] as const;

const ACTIVE_GRAD = ['#dcfce7', '#bbf7d0'] as const;

type TabName = typeof TABS[number]['name'];

interface Props {
  current: TabName;
  navigation: { navigate: (screen: string) => void };
}

const makeStyles = (C: ColorSet) => StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: C.card,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingTop: 4, overflow: 'hidden' },
  tabItemActive: { borderTopWidth: 3, borderTopColor: '#22c55e' },
  tabIcon: { fontSize: 20 },
  tabLabel: { color: '#94a3b8', fontSize: 10, fontWeight: '700' },
  tabLabelActive: { color: '#166534', fontWeight: '900' },
});

export default function TabBar({ current, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
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
            {active && <LinearGradient colors={ACTIVE_GRAD} start={GRAD_START} end={GRAD_END} style={StyleSheet.absoluteFill} />}
            <Text style={s.tabIcon}>{icon}</Text>
            <Text style={[s.tabLabel, active && s.tabLabelActive]} numberOfLines={1}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
