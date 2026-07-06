import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Platform, StatusBar, ScrollView, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import DateTimePicker from '@react-native-community/datetimepicker';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import {
  Task, getToday, subtractDays, daysBetween, getTasks,
  getCompletionCountInRange, getFirstCompletionDate, getCompletionsForMonth,
  getSetting, setSetting,
  TimeLog, TimeLogTotal, getTimeLogsForDate, getTimeLogTotalsInRange,
} from '../db/database';
import { GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';
import { useTheme, ColorSet } from '../contexts/ThemeContext';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const PAGE_PAD = 12;
const GRID_GAP = 10;

type Mode = 'rate' | 'calendar' | 'timer';
type Period = '7日' | '30日' | '全期間' | '任意';
type FreqFilter = 'すべて' | '毎日' | 'その他';
type DropdownKey = 'period' | 'freq';
type TimerSubMode = 'daily' | 'summary';
type Rate = { task: Task; completed: number; total: number; rate: number };
type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Stats'> };

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}時間${m}分`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const makeStyles = (C: ColorSet) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },
  headerCard: { backgroundColor: C.primary, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, gap: 12 },

  segRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 10, padding: 3 },
  segChip: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  segChipActive: { backgroundColor: '#ffffff' },
  segText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  segTextActive: { color: '#2563eb' },

  // compact selector buttons (replaces chip rows)
  selectorRow: { flexDirection: 'row', gap: 8 },
  selectorBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  selectorBtnOpen: { backgroundColor: 'rgba(255,255,255,0.3)' },
  selectorLeft: { gap: 1 },
  selectorLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  selectorValue: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  selectorArrow: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700' },

  // dropdown card
  dropdown: {
    position: 'absolute', left: 12, right: 12, zIndex: 100,
    backgroundColor: C.card, borderRadius: 14, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 12,
  },
  dropdownItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border,
  },
  dropdownItemLast: { borderBottomWidth: 0 },
  dropdownItemText: { color: C.onDark, fontSize: 14, fontWeight: '600' },
  dropdownItemTextActive: { color: C.primary, fontWeight: '800' },
  dropdownCheck: { color: C.primary, fontSize: 16, fontWeight: '800' },
  dropdownBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 },

  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { padding: 6 },
  navBtnText: { color: '#ffffff', fontSize: 26, fontWeight: '300' },
  monthLabel: { color: '#ffffff', fontSize: 17, fontWeight: '700' },

  chipRow: { flexDirection: 'row', gap: 8 },
  chip: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  chipActive: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  chipText: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: '#2563eb' },

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
  timerDuration: { color: C.primary, fontSize: 13, fontWeight: '800' },
  timerClock: { color: C.muted, fontSize: 12, fontWeight: '600' },

  calBody: { flex: 1, backgroundColor: C.body },
  gridPage: { padding: PAGE_PAD, flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  calCard: {
    backgroundColor: C.card, borderRadius: 14, padding: 10, gap: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  calHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  calTitle: { flex: 1, color: C.onDark, fontSize: 13, fontWeight: '700' },
  countBadge: { backgroundColor: C.primary, borderRadius: 9, paddingHorizontal: 7, paddingVertical: 2, minWidth: 22, alignItems: 'center' },
  countText: { color: C.onPrimary, fontSize: 11, fontWeight: '800' },
  weekRow: { flexDirection: 'row' },
  weekLabel: { textAlign: 'center', color: C.muted, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.28%', alignItems: 'center', paddingVertical: 1.5, paddingHorizontal: 1 },
  dayBox: { width: '100%', aspectRatio: 1, borderRadius: 6, backgroundColor: C.cellEmpty, alignItems: 'center', justifyContent: 'center' },
  dayBoxDone: { backgroundColor: C.primary },
  dayBoxToday: { borderWidth: 1.5, borderColor: C.primary },
  dayNum: { fontWeight: '600', color: C.onDark },
  dayNumDone: { color: C.onPrimary, fontWeight: '800' },
  sun: { color: '#e53e3e' },
  sat: { color: C.onDark },
  calEmpty: { paddingVertical: 60, alignItems: 'center', gap: 8 },
  calEmptyTitle: { color: C.stone, fontSize: 16, fontWeight: '700' },
  calEmptyBody: { color: C.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
});

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: '7日', label: '直近 7日間' },
  { value: '30日', label: '直近 30日間' },
  { value: '全期間', label: '全期間' },
  { value: '任意', label: '任意の期間を指定…' },
];

const FREQ_OPTIONS: { value: FreqFilter; label: string }[] = [
  { value: 'すべて', label: 'すべてのタスク' },
  { value: '毎日', label: '毎日タスクのみ' },
  { value: 'その他', label: 'その他（毎日以外）' },
];

export default function StatsScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { C, grad } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const today = getToday();

  const [mode, setMode] = useState<Mode>('rate');
  const [openDropdown, setOpenDropdown] = useState<DropdownKey | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  // ── Rate (execution rate) state ──
  const [period, setPeriod] = useState<Period>('7日');
  const [freqFilter, setFreqFilter] = useState<FreqFilter>('すべて');
  const [customStart, setCustomStart] = useState<Date>(() => { const d = new Date(); d.setDate(d.getDate() - 6); return d; });
  const [customEnd, setCustomEnd] = useState<Date>(new Date());
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [rates, setRates] = useState<Rate[]>([]);
  const [ratesLoaded, setRatesLoaded] = useState(false);

  // ── Calendar state ──
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [columns, setColumns] = useState<1 | 2>(2);
  const [calTasks, setCalTasks] = useState<Task[]>([]);
  const [calTasksLoaded, setCalTasksLoaded] = useState(false);

  useEffect(() => {
    getSetting(db, 'calendar_columns').then((v) => {
      if (v === '1' || v === '2') setColumns(Number(v) as 1 | 2);
    });
  }, [db]);
  const changeColumns = (n: 1 | 2) => {
    setColumns(n);
    setSetting(db, 'calendar_columns', String(n));
  };
  const [doneByTask, setDoneByTask] = useState<Record<number, Set<number>>>({});

  // ── Timer history state ──
  const [timerSubMode, setTimerSubMode] = useState<TimerSubMode>('daily');
  const [timerDate, setTimerDate] = useState(today);
  const [dayLogs, setDayLogs] = useState<TimeLog[]>([]);
  const [timeTotals, setTimeTotals] = useState<TimeLogTotal[]>([]);

  const loadRates = useCallback(async () => {
    const allTasks = await getTasks(db);
    const tasks = freqFilter === 'すべて'
      ? allTasks
      : allTasks.filter((t) => (freqFilter === '毎日' ? t.freq_type === 'daily' : t.freq_type !== 'daily'));
    if (tasks.length === 0) { setRates([]); setRatesLoaded(true); return; }
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
    setRatesLoaded(true);
  }, [db, period, freqFilter, today, customStart, customEnd]);

  const loadCalendar = useCallback(async () => {
    const [allTasks, completions] = await Promise.all([
      getTasks(db),
      getCompletionsForMonth(db, year, month),
    ]);
    const map: Record<number, Set<number>> = {};
    for (const c of completions) {
      const day = Number(c.date.slice(8, 10));
      (map[c.task_id] ??= new Set()).add(day);
    }
    setCalTasks(allTasks);
    setDoneByTask(map);
    setCalTasksLoaded(true);
  }, [db, year, month]);

  const loadDayLogs = useCallback(async () => {
    setDayLogs(await getTimeLogsForDate(db, timerDate));
  }, [db, timerDate]);

  const loadTimeTotals = useCallback(async () => {
    let start: string;
    const end = period === '任意' ? toDateString(customEnd) : today;
    if (period === '7日') start = subtractDays(today, 6);
    else if (period === '30日') start = subtractDays(today, 29);
    else if (period === '全期間') start = '0000-01-01';
    else start = toDateString(customStart);
    setTimeTotals(await getTimeLogTotalsInRange(db, start, end));
  }, [db, period, today, customStart, customEnd]);

  useFocusEffect(useCallback(() => { loadRates(); loadCalendar(); loadDayLogs(); loadTimeTotals(); }, [loadRates, loadCalendar, loadDayLogs, loadTimeTotals]));

  const periodLabel = (): string => {
    if (period === '7日') return '直近7日間';
    if (period === '30日') return '直近30日間';
    if (period === '全期間') return '全期間';
    return `${customStart.getMonth() + 1}/${customStart.getDate()} 〜 ${customEnd.getMonth() + 1}/${customEnd.getDate()}`;
  };
  const barColor = (rate: number) => rate >= 0.8 ? C.primary : rate >= 0.5 ? C.warning : C.muted;

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const screenW = Dimensions.get('window').width;
  const cardW = (screenW - PAGE_PAD * 2 - GRID_GAP * (columns - 1)) / columns;
  const numSize = columns === 1 ? 13 : 11;
  const labelSize = columns === 1 ? 11 : 10;

  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const isThisMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const todayDay = now.getDate();

  const renderMini = (taskId: number) => {
    const done = doneByTask[taskId];
    return (
      <View style={s.grid}>
        {cells.map((day, i) => {
          if (!day) return <View key={`e-${i}`} style={s.cell} />;
          const isDone = !!done?.has(day);
          const isToday = isThisMonth && day === todayDay;
          const dow = i % 7;
          return (
            <View key={`d-${i}`} style={s.cell}>
              <View style={[s.dayBox, isDone && s.dayBoxDone, isToday && !isDone && s.dayBoxToday]}>
                <Text style={[s.dayNum, { fontSize: numSize }, dow === 0 && s.sun, dow === 6 && s.sat, isDone && s.dayNumDone]}>
                  {day}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const toggleDropdown = (key: DropdownKey) =>
    setOpenDropdown(prev => prev === key ? null : key);

  const periodDisplay = PERIOD_OPTIONS.find(o => o.value === period)?.label ?? period;
  const freqDisplay = freqFilter;

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient
        colors={grad.header}
        start={GRAD_START}
        end={GRAD_END}
        style={[s.headerCard, { paddingTop: insets.top + 12 }]}
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height + insets.top)}
      >
        <View style={s.segRow}>
          {(['rate', 'calendar', 'timer'] as Mode[]).map((m) => (
            <TouchableOpacity key={m} style={[s.segChip, mode === m && s.segChipActive]} onPress={() => { setOpenDropdown(null); setMode(m); }}>
              <Text style={[s.segText, mode === m && s.segTextActive]}>{m === 'rate' ? '実行率' : m === 'calendar' ? 'カレンダー' : 'タイマー'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {mode === 'rate' ? (
          <View style={s.selectorRow}>
            {/* 期間セレクター */}
            <TouchableOpacity
              style={[s.selectorBtn, openDropdown === 'period' && s.selectorBtnOpen]}
              onPress={() => toggleDropdown('period')}
              activeOpacity={0.8}
            >
              <View style={s.selectorLeft}>
                <Text style={s.selectorLabel}>期間</Text>
                <Text style={s.selectorValue} numberOfLines={1}>{periodDisplay}</Text>
              </View>
              <Text style={s.selectorArrow}>{openDropdown === 'period' ? '▲' : '▼'}</Text>
            </TouchableOpacity>

            {/* 頻度セレクター */}
            <TouchableOpacity
              style={[s.selectorBtn, openDropdown === 'freq' && s.selectorBtnOpen]}
              onPress={() => toggleDropdown('freq')}
              activeOpacity={0.8}
            >
              <View style={s.selectorLeft}>
                <Text style={s.selectorLabel}>頻度</Text>
                <Text style={s.selectorValue}>{freqDisplay}</Text>
              </View>
              <Text style={s.selectorArrow}>{openDropdown === 'freq' ? '▲' : '▼'}</Text>
            </TouchableOpacity>
          </View>
        ) : mode === 'calendar' ? (
          <>
            <View style={s.monthNav}>
              <TouchableOpacity onPress={prevMonth} style={s.navBtn}>
                <Text style={s.navBtnText}>‹</Text>
              </TouchableOpacity>
              <Text style={s.monthLabel}>{year}年{month}月</Text>
              <TouchableOpacity onPress={nextMonth} style={s.navBtn}>
                <Text style={s.navBtnText}>›</Text>
              </TouchableOpacity>
            </View>
            <View style={s.chipRow}>
              {([1, 2] as const).map((n) => (
                <TouchableOpacity key={n} style={[s.chip, columns === n && s.chipActive]} onPress={() => changeColumns(n)}>
                  <Text style={[s.chipText, columns === n && s.chipTextActive]}>{n}列</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : (
          <>
            <View style={s.chipRow}>
              {([{ k: 'daily' as const, l: '日別' }, { k: 'summary' as const, l: '集計' }]).map((o) => (
                <TouchableOpacity key={o.k} style={[s.chip, timerSubMode === o.k && s.chipActive]} onPress={() => setTimerSubMode(o.k)}>
                  <Text style={[s.chipText, timerSubMode === o.k && s.chipTextActive]}>{o.l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {timerSubMode === 'daily' ? (
              <View style={s.monthNav}>
                <TouchableOpacity onPress={() => setTimerDate(subtractDays(timerDate, 1))} style={s.navBtn}>
                  <Text style={s.navBtnText}>‹</Text>
                </TouchableOpacity>
                <Text style={s.monthLabel}>{timerDate}{timerDate === today ? '（今日）' : ''}</Text>
                <TouchableOpacity onPress={() => setTimerDate(subtractDays(timerDate, -1))} style={s.navBtn}>
                  <Text style={s.navBtnText}>›</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.selectorRow}>
                <TouchableOpacity
                  style={[s.selectorBtn, openDropdown === 'period' && s.selectorBtnOpen]}
                  onPress={() => toggleDropdown('period')}
                  activeOpacity={0.8}
                >
                  <View style={s.selectorLeft}>
                    <Text style={s.selectorLabel}>期間</Text>
                    <Text style={s.selectorValue} numberOfLines={1}>{periodDisplay}</Text>
                  </View>
                  <Text style={s.selectorArrow}>{openDropdown === 'period' ? '▲' : '▼'}</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </LinearGradient>

      {/* ドロップダウンの背後タップで閉じる */}
      {openDropdown && (
        <TouchableOpacity
          style={s.dropdownBackdrop}
          activeOpacity={1}
          onPress={() => setOpenDropdown(null)}
        />
      )}

      {/* 期間ドロップダウン */}
      {openDropdown === 'period' && (
        <View style={[s.dropdown, { top: headerHeight }]}>
          {PERIOD_OPTIONS.map((opt, i) => {
            const isActive = period === opt.value;
            const isLast = i === PERIOD_OPTIONS.length - 1;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[s.dropdownItem, isLast && s.dropdownItemLast]}
                onPress={() => { setPeriod(opt.value); setOpenDropdown(null); }}
              >
                <Text style={[s.dropdownItemText, isActive && s.dropdownItemTextActive]}>{opt.label}</Text>
                {isActive && <Text style={s.dropdownCheck}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* 頻度ドロップダウン */}
      {openDropdown === 'freq' && (
        <View style={[s.dropdown, { top: headerHeight }]}>
          {FREQ_OPTIONS.map((opt, i) => {
            const isActive = freqFilter === opt.value;
            const isLast = i === FREQ_OPTIONS.length - 1;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[s.dropdownItem, isLast && s.dropdownItemLast]}
                onPress={() => { setFreqFilter(opt.value); setOpenDropdown(null); }}
              >
                <Text style={[s.dropdownItemText, isActive && s.dropdownItemTextActive]}>{opt.label}</Text>
                {isActive && <Text style={s.dropdownCheck}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {mode === 'rate' ? (
        <>
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
              <TouchableOpacity onPress={loadRates} activeOpacity={0.85}>
                <LinearGradient colors={grad.brand} start={GRAD_START} end={GRAD_END} style={s.applyBtn}>
                  <Text style={s.applyBtnText}>適用</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}

          {rates.length === 0 ? (
            ratesLoaded ? (
              <View style={s.empty}>
                <Text style={s.emptyText}>タスクがありません</Text>
              </View>
            ) : null
          ) : (
            <FlatList
              data={rates}
              keyExtractor={(item) => String(item.task.id)}
              style={s.list}
              contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 24 }}
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
            />
          )}
        </>
      ) : mode === 'calendar' ? (
        <ScrollView style={s.calBody} contentContainerStyle={[s.gridPage, { paddingBottom: 24 }]}>
          {calTasks.length === 0 ? (
            calTasksLoaded ? (
              <View style={[s.calEmpty, { width: '100%' }]}>
                <Text style={s.calEmptyTitle}>タスクがありません</Text>
                <Text style={s.calEmptyBody}>タスク画面で追加すると、ここに月別の記録が出ます</Text>
              </View>
            ) : null
          ) : (
            calTasks.map((task) => {
              const count = doneByTask[task.id]?.size ?? 0;
              return (
                <View key={task.id} style={[s.calCard, { width: cardW }]}>
                  <View style={s.calHeader}>
                    <Text style={s.calTitle} numberOfLines={1}>{task.icon ? `${task.icon} ` : ''}{task.title}</Text>
                    <LinearGradient colors={grad.brand} start={GRAD_START} end={GRAD_END} style={s.countBadge}><Text style={s.countText}>{count}</Text></LinearGradient>
                  </View>
                  <View style={s.weekRow}>
                    {WEEKDAYS.map((w, i) => (
                      <View key={w} style={s.cell}>
                        <Text style={[s.weekLabel, { fontSize: labelSize }, i === 0 && s.sun, i === 6 && s.sat]}>{w}</Text>
                      </View>
                    ))}
                  </View>
                  {renderMini(task.id)}
                </View>
              );
            })
          )}
        </ScrollView>
      ) : timerSubMode === 'daily' ? (
        dayLogs.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyText}>この日の記録はありません</Text>
          </View>
        ) : (
          <FlatList
            data={dayLogs}
            keyExtractor={(item) => String(item.id)}
            style={s.list}
            contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 24 }}
            ListHeaderComponent={<Text style={s.metaLabel}>合計 {formatDuration(dayLogs.reduce((sum, l) => sum + l.duration_seconds, 0))}</Text>}
            renderItem={({ item }) => (
              <View style={s.rateCard}>
                <View style={s.rateHeader}>
                  <Text style={s.rateTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={s.timerDuration}>{formatDuration(item.duration_seconds)}</Text>
                </View>
                <Text style={s.timerClock}>{formatClock(item.started_at)} 〜 {formatClock(item.ended_at)}</Text>
              </View>
            )}
          />
        )
      ) : (
        <>
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
              <TouchableOpacity onPress={loadTimeTotals} activeOpacity={0.85}>
                <LinearGradient colors={grad.brand} start={GRAD_START} end={GRAD_END} style={s.applyBtn}>
                  <Text style={s.applyBtnText}>適用</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
          {timeTotals.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyText}>この期間の記録はありません</Text>
            </View>
          ) : (
            <FlatList
              data={timeTotals}
              keyExtractor={(item) => String(item.task_id)}
              style={s.list}
              contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 24 }}
              ListHeaderComponent={<Text style={s.metaLabel}>{periodLabel()}</Text>}
              renderItem={({ item }) => (
                <View style={s.rateCard}>
                  <View style={s.rateHeader}>
                    <Text style={s.rateTitle} numberOfLines={1}>
                      {item.icon ? `${item.icon} ` : ''}{item.title}
                    </Text>
                    <Text style={s.timerDuration}>{formatDuration(item.total_seconds)}</Text>
                  </View>
                </View>
              )}
            />
          )}
        </>
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
