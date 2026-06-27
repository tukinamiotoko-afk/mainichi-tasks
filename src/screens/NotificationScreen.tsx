import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import { getSetting, setSetting } from '../db/database';
import { GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';
import { useTheme, ColorSet, ACCENT_LIST, AccentKey } from '../contexts/ThemeContext';

type ScheduleSize = 'small' | 'normal' | 'large';
type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Notifications'> };

const makeStyles = (C: ColorSet) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },
  headerCard: { backgroundColor: C.primary, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  headerTitle: { color: '#ffffff', fontSize: 20, fontWeight: '700' },
  list: { flex: 1, backgroundColor: C.body },
  card: { backgroundColor: C.card, borderRadius: 12, padding: 16, gap: 12, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
  cardLabel: { color: C.stone, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  settingRowText: { flex: 1, gap: 2 },
  settingRowLabel: { color: C.onDark, fontSize: 13, fontWeight: '700' },
  settingRowSub: { color: C.muted, fontSize: 11, fontWeight: '600' },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingVertical: 10, alignItems: 'center' },
  typeChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  typeChipText: { color: C.muted, fontSize: 13, fontWeight: '700' },
  typeChipTextActive: { color: C.onPrimary },
  accentRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  accentChip: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'transparent' },
  accentChipActive: { borderColor: C.onDark },
  accentCheck: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
});

export default function NotificationScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { C, dark, setDark, accent, setAccent, grad } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);

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

      <LinearGradient colors={grad.header} start={GRAD_START} end={GRAD_END} style={[s.headerCard, { paddingTop: insets.top + 12 }]}>
        <Text style={s.headerTitle}>設定</Text>
      </LinearGradient>

      <ScrollView style={s.list} contentContainerStyle={{ padding: 16, gap: 12 }}>
        {/* 外観 */}
        <View style={s.card}>
          <Text style={s.cardLabel}>外観</Text>
          <View style={s.settingRow}>
            <View style={s.settingRowText}>
              <Text style={s.settingRowLabel}>ダークモード</Text>
              <Text style={s.settingRowSub}>{dark ? 'ON（暗い画面）' : 'OFF（明るい画面）'}</Text>
            </View>
            <Switch
              value={dark}
              onValueChange={setDark}
              trackColor={{ false: C.border, true: C.primary }}
              thumbColor="#ffffff"
            />
          </View>

          {/* アクセントカラー */}
          <View style={{ gap: 8 }}>
            <Text style={s.settingRowLabel}>カラー</Text>
            <View style={s.accentRow}>
              {ACCENT_LIST.map(({ key, label, swatch }) => (
                <TouchableOpacity
                  key={key}
                  style={[s.accentChip, { backgroundColor: swatch }, accent === key && s.accentChipActive]}
                  onPress={() => setAccent(key as AccentKey)}
                  activeOpacity={0.8}
                >
                  {accent === key && <Text style={s.accentCheck}>✓</Text>}
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.settingRowSub}>{ACCENT_LIST.find(a => a.key === accent)?.label ?? ''}</Text>
          </View>
        </View>

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
