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
  list: { flex: 1 },
  listContent: { padding: 16 },

  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionLabel: {
    color: C.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: C.grid, marginLeft: 16 },
  sectionDivider: { height: 1, backgroundColor: C.grid },

  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  itemBlock: { paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  itemLabel: { color: C.ink, fontSize: 15, fontWeight: '600' },
  itemSub: { color: C.muted, fontSize: 12, marginTop: 2 },
  itemFlex: { flex: 1 },

  accentRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  accentChip: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'transparent' },
  accentChipActive: { borderColor: C.ink },
  accentCheck: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  accentName: { color: C.muted, fontSize: 12, marginTop: 2 },

  segRow: { flexDirection: 'row', gap: 8 },
  segChip: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 20, paddingVertical: 10, alignItems: 'center' },
  segChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  segChipText: { color: C.muted, fontSize: 13, fontWeight: '700' },
  segChipTextActive: { color: '#ffffff' },
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

      <ScrollView style={s.list} contentContainerStyle={s.listContent}>
        <View style={s.card}>

          {/* ─── 外観 ─── */}
          <Text style={s.sectionLabel}>外観</Text>
          <View style={s.divider} />

          <View style={s.itemRow}>
            <View style={s.itemFlex}>
              <Text style={s.itemLabel}>ダークモード</Text>
              <Text style={s.itemSub}>{dark ? 'ON（暗い画面）' : 'OFF（明るい画面）'}</Text>
            </View>
            <Switch
              value={dark}
              onValueChange={setDark}
              trackColor={{ false: C.border, true: C.primary }}
              thumbColor="#ffffff"
            />
          </View>
          <View style={s.divider} />

          <View style={s.itemBlock}>
            <Text style={s.itemLabel}>テーマカラー</Text>
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
            <Text style={s.accentName}>{ACCENT_LIST.find((a) => a.key === accent)?.label ?? ''}</Text>
          </View>

          {/* ─── 表示 ─── */}
          <View style={s.sectionDivider} />
          <Text style={s.sectionLabel}>表示</Text>
          <View style={s.divider} />

          <View style={s.itemRow}>
            <View style={s.itemFlex}>
              <Text style={s.itemLabel}>タグ・完了ボタンの位置</Text>
              <Text style={s.itemSub}>{tagRight ? 'タグ：右　チェック：左' : 'タグ：左　チェック：右'}</Text>
            </View>
            <Switch
              value={tagRight}
              onValueChange={toggleTagRight}
              trackColor={{ false: C.border, true: C.primary }}
              thumbColor="#ffffff"
            />
          </View>

          {/* ─── タイムスケジュール ─── */}
          <View style={s.sectionDivider} />
          <Text style={s.sectionLabel}>タイムスケジュール</Text>
          <View style={s.divider} />

          <View style={s.itemBlock}>
            <Text style={s.itemLabel}>行の高さ</Text>
            <View style={s.segRow}>
              {([['small', '小'], ['normal', '標準'], ['large', '大']] as [ScheduleSize, string][]).map(([v, label]) => (
                <TouchableOpacity
                  key={v}
                  style={[s.segChip, scheduleSize === v && s.segChipActive]}
                  onPress={() => changeScheduleSize(v)}
                >
                  <Text style={[s.segChipText, scheduleSize === v && s.segChipTextActive]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

        </View>
      </ScrollView>

      <TabBar current="Notifications" navigation={navigation} />
    </View>
  );
}
