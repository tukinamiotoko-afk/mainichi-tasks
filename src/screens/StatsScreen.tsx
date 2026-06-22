import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, Platform, StatusBar,
} from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import DateTimePicker from '@react-native-community/datetimepicker';
import { RootStackParamList } from '../../App';
import {
  Task, getToday, subtractDays, daysBetween,
  getTasks, getCompletionCountInRange, getFirstCompletionDate,
} from '../db/database';

const C = {
  carbon:      '#21242e',
  gold:        '#e48600',
  amber:       '#ecab37',
  signal:      '#f68d1f',
  canvas:      '#7a8aba',
  canvasSoft:  '#9fbee7',
  chrome:      '#3d4f97',
  mutedIndigo: '#60619c',
  platinum:    '#dedede',
  surface:     '#ffffff',
  periwinkle:  '#8ba1d4',
  onPrimary:   '#ffffff',
  inkSoft:     '#3d4f97',
  red:         '#e60012',
};

type Period = '7日' | '30日' | '全期間' | '任意';

type Rate = { task: Task; completed: number; total: number; rate: number };

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Stats'> };

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function StatsScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const today = getToday();

  const [period, setPeriod] = useState<Period>('7日');
  const [customStart, setCustomStart] = useState<Date>(() => { const d = new Date(); d.setDate(d.getDate() - 6); return d; });
  const [customEnd, setCustomEnd] = useState<Date>(new Date());
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [rates, setRates] = useState<Rate[]>([]);

  const load = useCallback(async () => {
    const tasks = await getTasks(db);
    if (tasks.length === 0) { setRates([]); return; }

    const computed = await Promise.all(tasks.map(async (task) => {
      let startDate: string;
      let totalDays: number;

      if (period === '7日') {
        startDate = subtractDays(today, 6);
        totalDays = 7;
      } else if (period === '30日') {
        startDate = subtractDays(today, 29);
        totalDays = 30;
      } else if (period === '全期間') {
        const first = await getFirstCompletionDate(db, task.id);
        startDate = first ?? today;
        totalDays = daysBetween(startDate, today);
      } else {
        // custom
        startDate = toDateString(customStart);
        const endStr = toDateString(customEnd);
        totalDays = daysBetween(startDate, endStr);
      }

      const endDate = period === '任意' ? toDateString(customEnd) : today;
      const completed = await getCompletionCountInRange(db, task.id, startDate, endDate);
      return { task, completed, total: Math.max(totalDays, 1), rate: completed / Math.max(totalDays, 1) };
    }));

    setRates(computed);
  }, [db, period, today, customStart, customEnd]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const periodLabel = (): string => {
    if (period === '7日') return '直近7日間';
    if (period === '30日') return '直近30日間';
    if (period === '全期間') return '全期間';
    const s = customStart;
    const e = customEnd;
    return `${s.getMonth() + 1}/${s.getDate()} 〜 ${e.getMonth() + 1}/${e.getDate()}`;
  };

  const barColor = (rate: number) => {
    if (rate >= 0.8) return C.signal;
    if (rate >= 0.5) return C.amber;
    return C.mutedIndigo;
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.carbon} />

      {/* ── Nav bar ────────────────────────────────────────────────── */}
      <View style={s.navBar}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Text style={s.backText}>‹ 戻る</Text>
        </TouchableOpacity>
        <Text style={s.navTitle}>実行率</Text>
      </View>

      {/* ── Period selector ─────────────────────────────────────────── */}
      <View style={s.periodBar}>
        {(['7日', '30日', '全期間', '任意'] as Period[]).map((p) => (
          <TouchableOpacity
            key={p}
            style={[s.periodChip, period === p && s.periodChipActive]}
            onPress={() => { setPeriod(p); }}
          >
            <Text style={[s.periodChipText, period === p && s.periodChipTextActive]}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Custom date range ───────────────────────────────────────── */}
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

      {/* ── Section label ───────────────────────────────────────────── */}
      <View style={s.sectionBar}>
        <Text style={s.sectionLabel}>≡ EXECUTION RATE  {periodLabel()}</Text>
      </View>

      {/* ── Rate list ───────────────────────────────────────────────── */}
      {rates.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyText}>タスクがありません</Text>
        </View>
      ) : (
        <FlatList
          data={rates}
          keyExtractor={(item) => String(item.task.id)}
          style={s.list}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}
          renderItem={({ item }) => {
            const pct = Math.round(item.rate * 100);
            const bc = barColor(item.rate);
            return (
              <View style={s.rateCard}>
                <View style={s.rateHeader}>
                  <Text style={s.rateTitle} numberOfLines={1}>{item.task.title}</Text>
                  <View style={s.rateRight}>
                    <Text style={s.rateDays}>{item.completed} / {item.total}日</Text>
                    <View style={[s.rateBadge, { backgroundColor: bc }]}>
                      <Text style={s.ratePct}>{pct}%</Text>
                    </View>
                  </View>
                </View>
                <View style={s.barBg}>
                  <View style={[s.barFill, { width: `${Math.min(item.rate * 100, 100)}%`, backgroundColor: bc }]} />
                </View>
              </View>
            );
          }}
          ListFooterComponent={<View style={{ height: 16 }} />}
        />
      )}

      {/* ── Date pickers ────────────────────────────────────────────── */}
      {showStartPicker && (
        <DateTimePicker
          value={customStart}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          maximumDate={customEnd}
          onChange={(_, date) => {
            setShowStartPicker(Platform.OS === 'ios');
            if (date) setCustomStart(date);
          }}
        />
      )}
      {showEndPicker && (
        <DateTimePicker
          value={customEnd}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          minimumDate={customStart}
          maximumDate={new Date()}
          onChange={(_, date) => {
            setShowEndPicker(Platform.OS === 'ios');
            if (date) setCustomEnd(date);
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.canvas },

  navBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.carbon, height: 52, paddingHorizontal: 12, borderBottomWidth: 2, borderBottomColor: C.chrome },
  backBtn: { marginRight: 12 },
  backText: { color: C.canvasSoft, fontSize: 14, fontWeight: '700' },
  navTitle: { flex: 1, color: C.gold, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },

  periodBar: { flexDirection: 'row', backgroundColor: C.canvasSoft, paddingHorizontal: 8, paddingVertical: 6, gap: 6 },
  periodChip: { backgroundColor: C.periwinkle, borderRadius: 2, paddingHorizontal: 10, paddingVertical: 5 },
  periodChipActive: { backgroundColor: C.carbon },
  periodChipText: { color: C.carbon, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  periodChipTextActive: { color: C.gold },

  customBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.periwinkle, borderBottomWidth: 1, borderBottomColor: C.chrome, paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  customLabel: { color: C.carbon, fontSize: 11, fontWeight: '700' },
  dateBtn: { backgroundColor: C.surface, borderRadius: 2, borderWidth: 1, borderColor: C.chrome, paddingHorizontal: 8, paddingVertical: 4 },
  dateBtnText: { color: C.carbon, fontSize: 11, fontWeight: '700' },
  customTilde: { color: C.carbon, fontSize: 12, fontWeight: '700' },
  applyBtn: { backgroundColor: C.signal, borderRadius: 2, paddingHorizontal: 10, paddingVertical: 4 },
  applyBtnText: { color: C.onPrimary, fontSize: 11, fontWeight: '700' },

  sectionBar: { paddingHorizontal: 12, paddingVertical: 6 },
  sectionLabel: { color: C.carbon, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  list: { flex: 1 },

  rateCard: { backgroundColor: C.platinum, borderRadius: 4, borderWidth: 1, borderColor: 'rgba(61,79,151,0.3)', padding: 12, gap: 8, elevation: 2 },
  rateHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rateTitle: { flex: 1, color: C.carbon, fontSize: 12, fontWeight: '700' },
  rateRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rateDays: { color: C.inkSoft, fontSize: 11, fontWeight: '700' },
  rateBadge: { borderRadius: 2, paddingHorizontal: 8, paddingVertical: 3 },
  ratePct: { color: C.onPrimary, fontSize: 12, fontWeight: '700' },
  barBg: { height: 6, backgroundColor: 'rgba(96,97,156,0.2)', borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: C.mutedIndigo, fontSize: 12, fontWeight: '700' },
});
