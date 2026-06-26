import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import { getSetting, setSetting } from '../db/database';
import { GRAD, GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';

const C = {
  header: '#2563eb',
  body: '#ffffff',
  card: '#ffffff',
  border: '#dbeafe',
  primary: '#2563eb',
  onPrimary: '#ffffff',
  onDark: '#2d3748',
  muted: '#111827',
  stone: '#111827',
};

type ScheduleSize = 'small' | 'normal' | 'large';
type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Notifications'> };

export default function NotificationScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const [tagRight, setTagRight] = useState(false);
  const [scheduleSize, setScheduleSize] = useState<ScheduleSize>('normal');

  const load = useCallback(async () => {
    const [layout, size] = await Promise.all([
      getSetting(db, 'card_layout'),
      getSetting(db, 'schedule_size'),
    ]);
    setTagRight(layout === 'tag_right');
    if (size === 'small' || size === 'large' || size === 'normal') setScheduleSize(size);
  }, [db]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleTagRight = async (val: boolean) => {
    setTagRight(val);
    await setSetting(db, 'card_layout', val ? 'tag_right' : 'tag_left');
  };

  const changeScheduleSize = async (val: ScheduleSize) => {
    setScheduleSize(val);
    await setSetting(db, 'schedule_size', val);
  };

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient colors={GRAD.header} start={GRAD_START} end={GRAD_END} style={[s.headerCard, { paddingTop: insets.top + 12 }]}>
        <Text style={s.headerTitle}>設定</Text>
      </LinearGradient>

      <ScrollView style={s.list} contentContainerStyle={{ padding: 16, gap: 12 }}>
        {/* タグ・完了ボタンの位置 */}
        <View style={s.card}>
          <Text style={s.cardLabel}>表示</Text>
          <View style={s.settingRow}>
            <View style={s.settingRowText}>
              <Text style={s.settingRowLabel}>タグ・完了ボタンの位置</Text>
              <Text style={s.settingRowSub}>{tagRight ? 'タグ：右　チェック：左' : 'タグ：左　チェック：右'}</Text>
            </View>
            <Switch
              value={tagRight}
              onValueChange={toggleTagRight}
              trackColor={{ false: C.border, true: C.primary }}
              thumbColor="#ffffff"
            />
          </View>
        </View>

        {/* タイムスケジュールの大きさ */}
        <View style={s.card}>
          <Text style={s.cardLabel}>タイムスケジュール</Text>
          <Text style={s.settingRowLabel}>大きさ</Text>
          <View style={s.typeRow}>
            {([['small', '小'], ['normal', '標準'], ['large', '大']] as [ScheduleSize, string][]).map(([v, label]) => (
              <TouchableOpacity
                key={v}
                style={[s.typeChip, scheduleSize === v && s.typeChipActive]}
                onPress={() => changeScheduleSize(v)}
              >
                <Text style={[s.typeChipText, scheduleSize === v && s.typeChipTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>

      <TabBar current="Notifications" navigation={navigation} />
    </View>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },
  headerCard: { backgroundColor: C.header, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  headerTitle: { color: '#ffffff', fontSize: 20, fontWeight: '700' },

  list: { flex: 1, backgroundColor: C.body },
  card: { backgroundColor: C.card, borderRadius: 12, padding: 16, gap: 12, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
  cardLabel: { color: C.stone, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  settingRowText: { flex: 1, gap: 2 },
  settingRowLabel: { color: C.onDark, fontSize: 13, fontWeight: '700' },
  settingRowSub: { color: '#64748b', fontSize: 11, fontWeight: '600' },

  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingVertical: 10, alignItems: 'center' },
  typeChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  typeChipText: { color: C.muted, fontSize: 13, fontWeight: '700' },
  typeChipTextActive: { color: C.onPrimary },
});
