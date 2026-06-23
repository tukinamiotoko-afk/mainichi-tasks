import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Platform, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import DateTimePicker from '@react-native-community/datetimepicker';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import { Task, getToday, subtractDays, daysBetween, getTasks, getCompletionCountInRange, getFirstCompletionDate } from '../db/database';
import { GRAD, GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';

const C = {
  header:    '#60a5fa',
  body:      '#ffffff',
  card:      '#ffffff',
  border:    '#dbeafe',
  primary:   '#60a5fa',
  onPrimary: '#ffffff',
  onDark:    '#2d3748',
  muted:     '#93c5fd',
  stone:     '#3b82f6',
  warning:   '#df6500',
};

type Period = '7日' | '30日' | '全期間' | '任意';
type FreqFilter = 'すべて' | '毎日' | 'その他';
type Rate = { task: Task; completed: number; total: number; rate: number };
type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Stats'> };

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function StatsScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const today = getToday();

  const [period, setPeriod] = useState<Period>('7日');
  const [freqFilter, setFreqFilter] = useState<FreqFilter>('すべて');
  const [customStart, setCustomStart] = useState<Date>(() => { const d = new Date(); d.setDate(d.getDate() - 6); return d; });
  const [customEnd, setCustomEnd] = useState<Date>(new Date());
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [rates, setRates] = useState<Rate[]>([]);

  const load = useCallback(async () => {
    const allTasks = await getTasks(db);
    const tasks = freqFilter === 'すべて'
      ? allTasks
      : allTasks.filter((t) => (freqFilter === '毎日' ? t.freq_type === 'daily' : t.freq_type !== 'daily'));
    if (tasks.length === 0) { setRates([]); return; }
    const computed = await Promise.all(tasks.map(async (task) => {
      let startDate: string;
      let totalDays: number;
      if (period === '7日') { startDate = subtractDays(today, 6); totalDays = 7; }
      else if (period === '30日') { startDate = subtractDays(today, 29); totalDays = 30; }
      else if (period === '全期間') {
        const first = await getFirstCompletionDate(db, task.id);
        startDate = first ?? today;
        totalDays = daysBetween(startDate, today);
      } else {
        startDate = toDateString(customStart);
        totalDays = daysBetween(startDate, toDateString(customEnd));
      }
      const endDate = period === '任意' ? toDateString(customEnd) : today;
      const completed = await getCompletionCountInRange(db, task.id, startDate, endDate);
      return { task, completed, total: Math.max(totalDays, 1), rate: completed / Math.max(totalDays, 1) };
    }));
    setRates(computed);
  }, [db, period, freqFilter, today, customStart, customEnd]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const periodLabel = (): string => {
    if (period === '7日') return '直近7日間';
    if (period === '30日') return '直近30日間';
    if (period === '全期間') return '全期間';
    return `${customStart.getMonth() + 1}/${customStart.getDate()} 〜 ${customEnd.getMonth() + 1}/${customEnd.getDate()}`;
  };

  const barColor = (rate: number) => rate >= 0.8 ? C.primary : rate >= 0.5 ? C.warning : C.muted;

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient colors={GRAD.header} start={GRAD_START} end={GRAD_END} style={[s.headerCard, { paddingTop: insets.top + 12 }]}>
        <Text style={s.headerTitle}>実行率</Text>
        <View style={s.periodBar}>
          {(['7日', '30日', '全期間', '任意'] as Period[]).map((p) => (
            <TouchableOpacity
              key={p}
              style={[s.periodChip, period === p && s.periodChipActive]}
              onPress={() => setPeriod(p)}
            >
              <Text style={[s.periodChipText, period === p && s.periodChipTextActive]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={s.periodBar}>
          {(['すべて', '毎日', 'その他'] as FreqFilter[]).map((f) => (
            <TouchableOpacity
              key={f}
              style={[s.periodChip, freqFilter === f && s.periodChipActive]}
              onPress={() => setFreqFilter(f)}
            >
              <Text style={[s.periodChipText, freqFilter === f && s.periodChipTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </LinearGradient>

      {period === '任意' && (
        <View style={s.customBar}>
          <Text style={s.customLabel}>期間：</Text>
          <TouchableOpacity style={s.dateBtn} onPress={() => setShowStartPicker(true)}>
            <Text style={s.dateBtnText}>{toDateString(customStart)}</Text>
          </TouchableOpacity>
          <Text style={s.customTilde}>〜</Text>
          <TouchableOpacity style={s.dateBtn} onPress={() => setShowEndPicker(true)}>
            <Text style={s.dateBtnText}>{toDateString(customEnd)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.applyBtn} onPress={load}>
            <Text style={s.applyBtnText}>適用</Text>
          </TouchableOpacity>
        </View>
      )}

      {rates.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyText}>タスクがありません</Text>
        </View>
      ) : (
        <FlatList
          data={rates}
          keyExtractor={(item) => String(item.task.id)}
          style={s.list}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          ListHeaderComponent={<Text style={s.metaLabel}>{periodLabel()}</Text>}
          renderItem={({ item }) => {
            const pct = Math.round(item.rate * 100);
            const bc = barColor(item.rate);
            return (
              <View style={s.rateCard}>
                <View style={s.rateHeader}>
                  <Text style={s.rateTitle} numberOfLines={1}>
                    {item.task.icon ? `${item.task.icon} ` : ''}{item.task.title}
                  </Text>
                  <View style={s.rateRight}>
                    <Text style={s.rateDays}>{item.completed} / {item.total}日</Text>
                    <View style={[s.rateBadge, { backgroundColor: bc }]}>
                      <Text style={s.ratePct}>{pct}%</Text>
                    </View>
                  </View>
                </View>
                <View style={s.barBg}>
                  <View style={[s.barFill, { width: `${Math.min(item.rate * 100, 100)}%` as any, backgroundColor: bc }]} />
                </View>
              </View>
            );
          }}
          ListFooterComponent={<View style={{ height: 8 }} />}
        />
      )}

      <TabBar current="Stats" navigation={navigation} />

      {showStartPicker && (
        <DateTimePicker value={customStart} mode="date" display={Platform.OS === 'ios' ? 'inline' : 'default'} maximumDate={customEnd}
          onChange={(_, date) => { setShowStartPicker(Platform.OS === 'ios'); if (date) setCustomStart(date); }} />
      )}
      {showEndPicker && (
        <DateTimePicker value={customEnd} mode="date" display={Platform.OS === 'ios' ? 'inline' : 'default'} minimumDate={customStart} maximumDate={new Date()}
          onChange={(_, date) => { setShowEndPicker(Platform.OS === 'ios'); if (date) setCustomEnd(date); }} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },
  headerCard: { backgroundColor: C.header, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, gap: 16 },
  headerTitle: { color: '#ffffff', fontSize: 20, fontWeight: '700' },
  periodBar: { flexDirection: 'row', gap: 8 },
  periodChip: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  periodChipActive: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  periodChipText: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700' },
  periodChipTextActive: { color: C.header },
  customBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, paddingHorizontal: 16, paddingVertical: 10, gap: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  customLabel: { color: C.stone, fontSize: 11, fontWeight: '700' },
  dateBtn: { borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  dateBtnText: { color: C.onDark, fontSize: 11, fontWeight: '700' },
  customTilde: { color: C.muted, fontSize: 12 },
  applyBtn: { backgroundColor: C.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  applyBtnText: { color: C.onPrimary, fontSize: 11, fontWeight: '700' },
  metaLabel: { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  list: { flex: 1, backgroundColor: C.body },
  rateCard: { backgroundColor: C.card, borderRadius: 16, padding: 16, gap: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 3 },
  rateHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rateTitle: { flex: 1, color: C.onDark, fontSize: 14, fontWeight: '600' },
  rateRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rateDays: { color: C.muted, fontSize: 11, fontWeight: '700' },
  rateBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  ratePct: { color: C.onPrimary, fontSize: 11, fontWeight: '700' },
  barBg: { height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%' },
  empty: { flex: 1, backgroundColor: C.body, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: C.muted, fontSize: 14, fontWeight: '600' },
});
