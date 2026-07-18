import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Modal,
  TextInput, StyleSheet, Alert, KeyboardAvoidingView,
  Platform, StatusBar, Animated, ScrollView, PanResponder, Dimensions, Switch,
  LayoutAnimation, UIManager, Easing, Image, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import * as StoreReview from 'expo-store-review';
import { RootStackParamList } from '../../App';
import {
  Task, TaskFields, getToday, getTasks, addTask, updateTask, deleteTask,
  getCompletionCounts, markComplete, markIncomplete, resetCompletion, updateTaskSortOrders,
  getSetting, setSetting, getTotalCompletionsCount, getTimerSettingForTask,
} from '../db/database';
import {
  TASK_ICONS, PRIORITIES, priorityMeta, WEEKDAYS,
  FreqType, TaskFreq, FREQ_TYPES, NTH_WEEKS, frequencyLabel, parseDays, parseDateList,
  nextNthWeekdayDate, nextEveryNDaysDate, isDueToday, monthlyNthWeeks, monthlyNthWeekdays,
  targetFor, isTaskDone,
} from '../constants/taskMeta';
import { GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';
import { useTheme, ColorSet } from '../contexts/ThemeContext';
import { usePurchases } from '../contexts/PurchasesContext';
import { useAds } from '../contexts/AdsContext';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Home'> };

const pad = (n: number) => String(n).padStart(2, '0');
const daysToCsv = (days: number[]) => days.slice().sort((a, b) => a - b).join(',');
const DRAG_ROW_HEIGHT = 88;
const DRAG_GAP = 10;
const DRAG_SLOT = DRAG_ROW_HEIGHT + DRAG_GAP; // actual slot size including gap

type FilterStatus = 'all' | 'incomplete' | 'done';
type FilterFreq = 'all' | 'daily' | 'other';
type FilterDue = 'all' | 'today';
type MetaPicker = 'icon' | 'priority' | 'freq' | null;
type SortKey = 'manual' | 'priority' | 'time' | 'name';

const STATUS_OPTS: { k: FilterStatus; l: string }[] = [
  { k: 'all', l: 'すべて' }, { k: 'incomplete', l: '未完了' }, { k: 'done', l: '完了' },
];
const FREQ_OPTS: { k: FilterFreq; l: string }[] = [
  { k: 'all', l: 'すべて' }, { k: 'daily', l: '毎日' }, { k: 'other', l: 'その他' },
];
const DUE_OPTS: { k: FilterDue; l: string }[] = [
  { k: 'all', l: 'すべて' }, { k: 'today', l: '今日' },
];
const SORT_OPTS: { k: SortKey; l: string }[] = [
  { k: 'manual', l: '手動' }, { k: 'priority', l: '優先度' }, { k: 'time', l: '時刻' }, { k: 'name', l: '名前' },
];
const SWIPE_DELETE_THRESHOLD = 92;

// Minimal shape required to schedule a task's reminder.
type Schedulable = {
  title: string;
  icon: string | null;
  scheduled_time: string | null;
  notify: number;
  notify_id?: string | null;
  notify_type?: string;
  freq_type: FreqType;
  freq_days: string | null;
  freq_week: number | null;
  freq_weekday: number | null;
  freq_day: number | null;
  once_date?: string | null;
  freq_dates?: string | null;
  freq_weeks?: string | null;
  freq_interval?: number | null;
};

// Minimal shape required to schedule a task's auto-timer trigger.
type AutoTimerSchedulable = {
  id: number;
  title: string;
  icon: string | null;
  auto_timer_enabled: number;
  auto_timer_time: string | null;
  auto_timer_mode: string;
  auto_timer_minutes: number;
  auto_timer_notify_id?: string | null;
  freq_type: FreqType;
  freq_days: string | null;
  freq_week: number | null;
  freq_weekday: number | null;
  freq_day: number | null;
  once_date?: string | null;
  freq_dates?: string | null;
  freq_weeks?: string | null;
  freq_interval?: number | null;
};

async function ensurePermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('通知の許可が必要です', '端末の設定から通知を許可してください。');
    return false;
  }
  return true;
}

// Schedule reminders for a task according to its recurrence. Returns identifiers.
async function scheduleTaskNotifs(task: Schedulable): Promise<string[]> {
  if (!task.scheduled_time) return [];
  const [h, m] = task.scheduled_time.split(':').map(Number);
  const body = `${task.icon ? task.icon + ' ' : ''}${task.title} の時間です`;
  const isAlarm = task.notify_type === 'alarm';
  const content = {
    title: '毎日タスク', body,
    sound: isAlarm,
    android: { channelId: isAlarm ? 'full' : 'silent' },
  } as any;
  const ids: string[] = [];
  try {
    if (task.freq_type === 'daily') {
      ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { hour: h, minute: m, repeats: true } as any }));
    } else if (task.freq_type === 'weekly') {
      for (const d of parseDays(task.freq_days)) {
        ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { weekday: d + 1, hour: h, minute: m, repeats: true } as any }));
      }
    } else if (task.freq_type === 'monthly_day') {
      ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { day: task.freq_day ?? 1, hour: h, minute: m, repeats: true } as any }));
    } else if (task.freq_type === 'monthly_nth') {
      const when = nextNthWeekdayDate(monthlyNthWeeks(task), monthlyNthWeekdays(task), h, m);
      ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { date: when } as any }));
    } else if (task.freq_type === 'every_n_days') {
      if (task.once_date) {
        const when = nextEveryNDaysDate(task.once_date, task.freq_interval ?? 2, h, m);
        ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { date: when } as any }));
      }
    } else if (task.freq_type === 'once') {
      const when = task.once_date ? new Date(`${task.once_date}T${task.scheduled_time}:00`) : new Date();
      if (when.getTime() > Date.now()) {
        ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { date: when } as any }));
      }
    } else if (task.freq_type === 'dates') {
      for (const ds of parseDateList(task.freq_dates)) {
        const when = new Date(`${ds}T${task.scheduled_time}:00`);
        if (when.getTime() > Date.now()) {
          ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { date: when } as any }));
        }
      }
    }
  } catch {
    // ignore scheduling failures (e.g. permission revoked); UI still works.
  }
  return ids;
}

async function cancelIds(csv: string | null | undefined): Promise<void> {
  if (!csv) return;
  for (const id of csv.split(',').filter(Boolean)) {
    try { await Notifications.cancelScheduledNotificationAsync(id); } catch {}
  }
}

// Cancel any existing reminders for a task and (re)schedule based on its state.
async function rescheduleTask(task: Schedulable): Promise<string | null> {
  await cancelIds(task.notify_id);
  if (!task.notify || !task.scheduled_time) return null;
  const ids = await scheduleTaskNotifs(task);
  return ids.length ? ids.join(',') : null;
}

// Schedule the notification that, when tapped, starts an automatic
// timer/stopwatch measurement for the task. The notification carries the
// task id + mode + duration in its data payload so the tap handler (in
// TimerContext) can start the right measurement without any other state.
async function scheduleAutoTimerNotifs(task: AutoTimerSchedulable): Promise<string[]> {
  if (!task.auto_timer_time) return [];
  const [h, m] = task.auto_timer_time.split(':').map(Number);
  const modeLabel = task.auto_timer_mode === 'timer' ? 'タイマー' : 'ストップウォッチ';
  const body = `${task.icon ? task.icon + ' ' : ''}${task.title} の${modeLabel}計測を開始する時間です（タップで開始）`;
  const content = {
    title: '毎日タスク', body,
    sound: true,
    android: { channelId: 'full' },
    data: { kind: 'auto-timer', taskId: task.id, mode: task.auto_timer_mode, minutes: task.auto_timer_minutes },
  } as any;
  const ids: string[] = [];
  try {
    if (task.freq_type === 'daily') {
      ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { hour: h, minute: m, repeats: true } as any }));
    } else if (task.freq_type === 'weekly') {
      for (const d of parseDays(task.freq_days)) {
        ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { weekday: d + 1, hour: h, minute: m, repeats: true } as any }));
      }
    } else if (task.freq_type === 'monthly_day') {
      ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { day: task.freq_day ?? 1, hour: h, minute: m, repeats: true } as any }));
    } else if (task.freq_type === 'monthly_nth') {
      const when = nextNthWeekdayDate(monthlyNthWeeks(task), monthlyNthWeekdays(task), h, m);
      ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { date: when } as any }));
    } else if (task.freq_type === 'every_n_days') {
      if (task.once_date) {
        const when = nextEveryNDaysDate(task.once_date, task.freq_interval ?? 2, h, m);
        ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { date: when } as any }));
      }
    } else if (task.freq_type === 'once') {
      const when = task.once_date ? new Date(`${task.once_date}T${task.auto_timer_time}:00`) : new Date();
      if (when.getTime() > Date.now()) {
        ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { date: when } as any }));
      }
    } else if (task.freq_type === 'dates') {
      for (const ds of parseDateList(task.freq_dates)) {
        const when = new Date(`${ds}T${task.auto_timer_time}:00`);
        if (when.getTime() > Date.now()) {
          ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { date: when } as any }));
        }
      }
    }
  } catch {
    // ignore scheduling failures (e.g. permission revoked); UI still works.
  }
  return ids;
}

async function rescheduleAutoTimer(task: AutoTimerSchedulable): Promise<string | null> {
  await cancelIds(task.auto_timer_notify_id);
  if (!task.auto_timer_enabled || !task.auto_timer_time) return null;
  const ids = await scheduleAutoTimerNotifs(task);
  return ids.length ? ids.join(',') : null;
}

// Each option fades up on mount, staggered by index, so the list "floats up".
function RiseIn({ index, style, children }: { index: number; style?: any; children: React.ReactNode }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 260,
      delay: Math.min(index, 14) * 35,
      useNativeDriver: true,
    }).start();
  }, [anim, index]);
  return (
    <Animated.View style={[style, { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

// Quick bounce used across selectable chips for tactile feedback.
function bounce(v: Animated.Value) {
  Animated.sequence([
    Animated.timing(v, { toValue: 1.18, duration: 130, useNativeDriver: true }),
    Animated.timing(v, { toValue: 0.92, duration: 100, useNativeDriver: true }),
    Animated.timing(v, { toValue: 1.08, duration: 90, useNativeDriver: true }),
    Animated.timing(v, { toValue: 1, duration: 80, useNativeDriver: true }),
  ]).start();
}

// A chip that bounces when tapped. `wrapStyle` lets the animated wrapper carry
// layout props (e.g. flex) so the chip keeps its sizing inside flex rows.
function PulseChip({ onPress, style, wrapStyle, children }: { onPress: () => void; style?: any; wrapStyle?: any; children: React.ReactNode }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={[wrapStyle, { transform: [{ scale }] }]}>
      <TouchableOpacity style={style} onPress={() => { bounce(scale); onPress(); }} activeOpacity={0.8}>
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

const makeStyles = (C: ColorSet) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },

  headerCard: { backgroundColor: C.primary, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 },
  dateNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  dateNavBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  dateNavArrow: { color: '#ffffff', fontSize: 26, fontWeight: '800', marginTop: -2 },
  dateNavCenter: { flex: 1, alignItems: 'center' },
  dateText: { color: '#ffffff', fontSize: 22, fontWeight: '800' },
  dateTodayHint: { color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '700', marginTop: 2 },
  headerLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  progressBg: { flex: 1, height: 10, backgroundColor: 'rgba(255,255,255,0.45)', borderRadius: 5, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4, overflow: 'hidden' },
  progressGrad: { flex: 1 },
  progressText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },

  list: { flex: 1, backgroundColor: C.body },
  listWrap: { flex: 1, position: 'relative' },
  panelOverlay: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, paddingTop: 8, zIndex: 20 },
  listHeader: { marginBottom: 4 },
  sectionBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  sectionRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metaLabel: { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  stone: { color: C.stone, fontSize: 11, fontWeight: '700' },
  toggleRow: { flexDirection: 'row', gap: 6, flexShrink: 1 },
  filterToggle: { backgroundColor: C.primarySoft, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  filterToggleActive: { backgroundColor: C.primary },
  filterToggleText: { color: C.primary, fontSize: 11, fontWeight: '800' },
  filterToggleTextActive: { color: C.onPrimary },
  filterPanel: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, marginTop: 8, gap: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10, elevation: 8 },
  filterLabel: { color: C.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, marginTop: 2 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fChip: { borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 5 },
  fChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  fChipText: { color: C.onDark, fontSize: 12, fontWeight: '700' },
  fChipTextActive: { color: C.onPrimary },
  filterHint: { color: C.muted, fontSize: 10, fontWeight: '600', marginTop: 4 },

  swipeWrap: { borderRadius: 12 },
  swipeDeleteBg: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  swipeDeleteGrad: { borderRadius: 12 },
  swipeDeleteIcon: { fontSize: 17 },
  swipeDeleteText: { color: '#ffffff', fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  taskCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 14, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  taskCardDone: { opacity: 0.6 },
  checkBox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  checkBoxDone: { backgroundColor: C.primary, borderColor: C.primary },
  checkMark: { color: C.onPrimary, fontSize: 11, fontWeight: '700' },
  checkCount: { color: C.stone, fontSize: 10, fontWeight: '800' },
  taskBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  taskTextWrap: { flex: 1, gap: 4 },
  taskTitle: { color: C.onDark, fontSize: 14, fontWeight: '500', lineHeight: 20 },
  taskTitleDone: { color: C.muted, textDecorationLine: 'line-through' },
  taskMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  taskSide: { alignItems: 'flex-end', justifyContent: 'center', gap: 6, minHeight: 24 },
  taskStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 18 },
  taskStatusIcon: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffffcc',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  taskStatusIconText: { fontSize: 10, lineHeight: 12 },
  priorityBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  priorityBadgeText: { color: C.onPrimary, fontSize: 9, fontWeight: '800' },
  scheduleTag: { color: C.stone, fontSize: 10, fontWeight: '700' },
  freqTag: { color: C.muted, fontSize: 10, fontWeight: '700' },
  doneBadge: { backgroundColor: '#fef3c7', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  doneBadgeText: { color: '#b45309', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  tagBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  tagIcon: { fontSize: 17 },
  tagIconEmpty: { opacity: 0.35 },

  empty: { paddingVertical: 60, alignItems: 'center', gap: 8 },
  emptyTitle: { color: C.stone, fontSize: 16, fontWeight: '700' },
  emptyBody: { color: C.muted, fontSize: 13 },

  fabWrap: { position: 'absolute', zIndex: 20 },
  fab: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6 },
  fabText: { color: C.onPrimary, fontSize: 26, fontWeight: '400', lineHeight: 30 },

  sheetBg: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.sheetBg, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1.5, borderColor: C.sheetBorder, padding: 20, paddingTop: 12, gap: 8, maxHeight: '88%' },
  sheetHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  sheetSection: { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  sheetTitleRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  sheetTitleInput: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 15, color: C.onDark, backgroundColor: C.body },
  noteInput: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, color: C.onDark, backgroundColor: C.body },
  timerDurationRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  timerDurationInput: { width: 56, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: C.onDark, backgroundColor: C.body, textAlign: 'center' },
  timerDurationLabel: { color: C.muted, fontSize: 12, fontWeight: '700' },
  sheetSaveBtn: { backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  sheetSaveBtnText: { color: C.onPrimary, fontSize: 13, fontWeight: '700' },

  detailScreen: { flex: 1, backgroundColor: C.body },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.card },
  detailHeaderTitle: { color: C.onDark, fontSize: 16, fontWeight: '800' },
  detailCloseText: { fontSize: 22, color: C.muted, paddingHorizontal: 4 },
  detailDeleteBtn: { marginTop: 24, backgroundColor: '#fee2e2', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  detailDeleteText: { color: '#dc2626', fontSize: 14, fontWeight: '800' },

  // Schedule (time + notify)
  scheduleCard: { backgroundColor: C.scheduleCardBg, borderRadius: 14, padding: 14, gap: 8 },
  scheduleTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  scheduleTimeBtn: { flex: 1 },
  scheduleToggleTop: { alignItems: 'center', gap: 2, paddingTop: 1 },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scheduleLeft: { gap: 2 },
  scheduleRight: { alignItems: 'center', gap: 2 },
  scheduleLabel: { color: C.stone, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  scheduleTime: { color: C.onDark, fontSize: 30, fontWeight: '800' },
  scheduleTimeEmpty: { color: C.muted, fontSize: 20, fontWeight: '700' },
  clearTimeBtn: { alignSelf: 'flex-start' },
  clearTimeText: { color: C.muted, fontSize: 11, fontWeight: '700' },
  scheduleHint: { color: C.error, fontSize: 11, fontWeight: '600' },
  notifyTypeLabel: { color: C.muted, fontSize: 11, fontWeight: '700', marginTop: 4 },
  notifyTypeRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  notifyTypeChip: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 8, alignItems: 'center', backgroundColor: C.card },
  notifyTypeChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  notifyTypeText: { color: C.onDark, fontSize: 12, fontWeight: '700' },
  notifyTypeTextActive: { color: C.onPrimary },

  // Icon
  metaSelectBtn: { borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  metaSelectLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  metaSelectIcon: { width: 28, textAlign: 'center', fontSize: 20 },
  metaSelectIconEmpty: { opacity: 0.35 },
  metaSelectText: { color: C.onDark, fontSize: 13, fontWeight: '700' },
  metaSelectArrow: { color: C.muted, fontSize: 11, fontWeight: '800' },
  prioritySwatch: { width: 28, height: 20, borderRadius: 7, borderWidth: 1 },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 6 },
  iconChip: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  iconChipActive: { backgroundColor: C.iconChipActiveBg, borderColor: C.primary },
  iconEmoji: { fontSize: 22 },
  iconNone: { color: C.muted, fontSize: 11, fontWeight: '700' },

  // Priority / generic chips
  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingVertical: 8, alignItems: 'center' },
  typeChipText: { color: C.muted, fontSize: 12, fontWeight: '700' },
  typeChipTextActive: { color: C.onPrimary },

  // Frequency
  freqPanel: { gap: 8, marginTop: 8 },
  freqTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  freqTypeChip: { borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  freqTypeChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  freqTypeText: { color: C.muted, fontSize: 12, fontWeight: '700' },
  freqTypeTextActive: { color: C.onPrimary },
  weekdayRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  dayChip: { flex: 1, height: 38, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  dayChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  dayChipText: { color: C.onDark, fontSize: 13, fontWeight: '700' },
  dayChipTextActive: { color: C.onPrimary },
  daySun: { },
  daySat: { },
  weekChoiceRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  weekChip: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingVertical: 8, alignItems: 'center' },
  weekChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  weekChipText: { color: C.onDark, fontSize: 12, fontWeight: '700' },
  weekChipTextActive: { color: C.onPrimary },
  monthDayRow: { gap: 6, paddingVertical: 8 },
  intervalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 8 },
  monthDayChip: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  monthDayChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  monthDayText: { color: C.onDark, fontSize: 13, fontWeight: '700' },
  monthDayTextActive: { color: C.onPrimary },

  calHint: { fontSize: 12, color: C.muted, marginTop: 6, marginBottom: 2 },
  freqModalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end', paddingHorizontal: 12 },
  freqModalCard: {
    backgroundColor: C.freqCardBg, borderRadius: 24, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16,
    borderWidth: 2, borderColor: C.freqCardBorder,
    elevation: 16, shadowColor: '#1e3a8a', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 20,
  },
  freqModalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  freqModalTitle: { fontSize: 16, fontWeight: '800', color: C.muted },
  freqModalDone: { fontSize: 15, fontWeight: '800', color: C.primary },
  cal: { marginTop: 4, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 10, backgroundColor: C.card },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, marginBottom: 8 },
  calNav: { fontSize: 26, color: C.primary, fontWeight: '700', width: 32, textAlign: 'center' },
  calTitle: { fontSize: 15, fontWeight: '800', color: C.muted },
  calWeekRow: { flexDirection: 'row' },
  calWeekCell: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: C.muted, paddingBottom: 4 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  calDay: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  calDayActive: { backgroundColor: C.primary },
  calDayText: { fontSize: 13, fontWeight: '700', color: C.onDark },
  calDayTextActive: { color: C.onPrimary },
  calSun: { color: '#ef4444' },
  calSat: { color: '#3b82f6' },

  timeModalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  timeModalCard: { width: '100%', backgroundColor: C.card, borderRadius: 18, padding: 20, gap: 12, alignItems: 'center' },
  timeModalTitle: { color: C.onDark, fontSize: 15, fontWeight: '800' },
  timeInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timeInput: { width: 76, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 10, fontSize: 30, fontWeight: '800', color: C.onDark, textAlign: 'center', backgroundColor: C.body },
  timeColon: { fontSize: 30, fontWeight: '800', color: C.onDark },
  timeHint: { color: C.muted, fontSize: 11, fontWeight: '600' },
  timeBtnRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 4 },
  timeCancelBtn: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  timeCancelText: { color: C.stone, fontSize: 14, fontWeight: '700' },
  timeConfirmBtnWrap: { flex: 1 },
  timeConfirmBtn: { borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  timeConfirmText: { color: C.onPrimary, fontSize: 14, fontWeight: '700' },

  thumbOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  thumbEmoji: { fontSize: 72 },
  celebrateText: { fontSize: 22, fontWeight: '800', letterSpacing: 0.5, textShadowColor: 'rgba(0,0,0,0.85)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
});

// Frequency type chip row. Each chip bounces on tap, and the "任意" chip also
// bounces when it becomes active via the calendar auto-switch.
function FreqTypeChips({ freqType, onSetType, s }: {
  freqType: FreqType;
  onSetType: (t: FreqType) => void;
  s: ReturnType<typeof makeStyles>;
}) {
  const scales = useRef<Record<string, Animated.Value>>({}).current;
  const getScale = (k: string) => {
    if (!scales[k]) scales[k] = new Animated.Value(1);
    return scales[k];
  };
  const prevType = useRef<FreqType>(freqType);

  useEffect(() => {
    if (freqType === 'dates' && prevType.current !== 'dates') bounce(getScale('dates'));
    prevType.current = freqType;
  }, [freqType]);

  return (
    <View style={s.freqTypeRow}>
      {FREQ_TYPES.map((ft, i) => {
        const isActive = freqType === ft.value;
        return (
          <RiseIn key={ft.value} index={i}>
            <Animated.View style={{ transform: [{ scale: getScale(ft.value) }] }}>
              <TouchableOpacity
                style={[s.freqTypeChip, isActive && s.freqTypeChipActive]}
                onPress={() => { bounce(getScale(ft.value)); onSetType(ft.value); }}
                activeOpacity={0.8}
              >
                <Text style={[s.freqTypeText, isActive && s.freqTypeTextActive]}>{ft.label}</Text>
              </TouchableOpacity>
            </Animated.View>
          </RiseIn>
        );
      })}
    </View>
  );
}

// Month calendar that previews which days a task's recurrence falls on, and
// lets the user tap a day to configure the rule (set the once-date, toggle a
// weekday, choose the monthly day, or pick the nth-weekday).
function FreqCalendar({ freq, onceDate, onSelect, s }: {
  freq: TaskFreq;
  onceDate: string | null;
  onSelect: (ref: Date, ds: string) => void;
  s: ReturnType<typeof makeStyles>;
}) {
  const isOnce = freq.freq_type === 'once';
  const hasAnchorDate = isOnce || freq.freq_type === 'every_n_days';
  const base = hasAnchorDate && onceDate ? new Date(`${onceDate}T00:00:00`) : new Date();
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() });
  const startDow = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const fmt = (d: number) => `${view.y}-${pad(view.m + 1)}-${pad(d)}`;
  const shift = (delta: number) => {
    const next = new Date(view.y, view.m + delta, 1);
    setView({ y: next.getFullYear(), m: next.getMonth() });
  };
  return (
    <View style={s.cal}>
      <View style={s.calHeader}>
        <TouchableOpacity onPress={() => shift(-1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={s.calNav}>‹</Text>
        </TouchableOpacity>
        <Text style={s.calTitle}>{view.y}年 {view.m + 1}月</Text>
        <TouchableOpacity onPress={() => shift(1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={s.calNav}>›</Text>
        </TouchableOpacity>
      </View>
      <View style={s.calWeekRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={w} style={[s.calWeekCell, i === 0 && s.calSun, i === 6 && s.calSat]}>{w}</Text>
        ))}
      </View>
      <View style={s.calGrid}>
        {cells.map((d, i) => {
          if (d === null) return <View key={`e${i}`} style={s.calCell} />;
          const ds = fmt(d);
          const ref = new Date(view.y, view.m, d);
          const active = isOnce ? onceDate === ds : isDueToday(freq, ref);
          const dow = i % 7;
          return (
            <TouchableOpacity
              key={ds}
              style={s.calCell}
              onPress={() => onSelect(ref, ds)}
              activeOpacity={0.7}
            >
              <View style={[s.calDay, active && s.calDayActive]}>
                <Text style={[s.calDayText, dow === 0 && s.calSun, dow === 6 && s.calSat, active && s.calDayTextActive]}>{d}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

type TaskRowStyles = ReturnType<typeof makeStyles>;

type TaskRowProps = {
  item: Task;
  count: number;
  isDone: boolean;
  isDragging: boolean;
  isSwiping: boolean;
  reorderEnabled: boolean;
  tagRight: boolean;
  s: TaskRowStyles;
  panHandlers: ReturnType<typeof PanResponder.create>['panHandlers'];
  shiftAnim: Animated.Value;
  dragY: Animated.Value;
  dragScale: Animated.Value;
  swipeAnim: Animated.Value;
  onToggle: (id: number) => void;
  onLongPressCheck: (id: number) => void;
  onOpenDetail: (task: Task) => void;
  onStartDrag: (id: number) => void;
  onMeasureHeight: (h: number) => void;
};

// Fields that don't affect what a row looks like: ignoring them lets an
// unaffected row's props compare equal after a reorder, even though every
// task object is freshly spread with a new sort_order at that moment.
const ROW_IGNORED_FIELDS = new Set<keyof Task>(['sort_order']);
function taskContentEqual(a: Task, b: Task): boolean {
  if (a === b) return true;
  for (const key of Object.keys(a) as (keyof Task)[]) {
    if (ROW_IGNORED_FIELDS.has(key)) continue;
    if (a[key] !== b[key]) return false;
  }
  return true;
}

const TaskRow = React.memo(function TaskRow({
  item, count, isDone, isDragging, isSwiping, reorderEnabled, tagRight, s,
  panHandlers, shiftAnim, dragY, dragScale, swipeAnim,
  onToggle, onLongPressCheck, onOpenDetail, onStartDrag, onMeasureHeight,
}: TaskRowProps) {
  const swipeStyle = isSwiping
    ? {
        transform: [
          { translateX: swipeAnim },
          {
            rotate: swipeAnim.interpolate({
              inputRange: [-220, 0, 220],
              outputRange: ['-5deg', '0deg', '5deg'],
              extrapolate: 'clamp' as const,
            }),
          },
          {
            scale: swipeAnim.interpolate({
              inputRange: [-220, 0, 220],
              outputRange: [0.96, 1, 0.96],
              extrapolate: 'clamp' as const,
            }),
          },
        ],
      }
    : null;
  const swipeBgStyle = isSwiping
    ? {
        opacity: swipeAnim.interpolate({
          inputRange: [-SWIPE_DELETE_THRESHOLD, 0, SWIPE_DELETE_THRESHOLD],
          outputRange: [1, 0, 1],
          extrapolate: 'clamp' as const,
        }),
      }
    : { opacity: 0 };
  const dragStyle = isDragging
    ? {
        transform: [{ translateY: dragY }, { scale: dragScale }],
        zIndex: 30,
        elevation: 8,
        shadowOpacity: 0.18,
        shadowRadius: 10,
      }
    : null;
  // always bound (harmless at rest, since it's reset to 0 whenever no drag
  // is active) so this row's props don't have to change just because some
  // OTHER row started or stopped dragging
  const shiftStyle = !isDragging && !isSwiping
    ? { transform: [{ translateY: shiftAnim }] }
    : null;
  const priority = priorityMeta(item.priority);
  const notifyIcon = item.notify ? (item.notify_type === 'alarm' ? '⏰' : '🔔') : null;
  const autoMeasureIcon = item.auto_timer_enabled ? '⏱' : null;

  return (
    <View style={s.swipeWrap} onLayout={(e) => onMeasureHeight(e.nativeEvent.layout.height)}>
      <Animated.View style={[s.swipeDeleteBg, swipeBgStyle]}>
        <LinearGradient
          colors={['#fca5a5', '#ef4444']}
          start={GRAD_START} end={GRAD_END}
          style={[StyleSheet.absoluteFill, s.swipeDeleteGrad]}
        />
        <Text style={s.swipeDeleteIcon}>🗑️</Text>
        <Text style={s.swipeDeleteText}>削除</Text>
      </Animated.View>
      <Animated.View
        style={[
          s.taskCard,
          { backgroundColor: priority.cardColor, borderColor: priority.borderColor },
          isDone && s.taskCardDone,
          shiftStyle,
          swipeStyle,
          dragStyle,
        ]}
        {...panHandlers}
      >
        {(() => {
          const target = targetFor(item);
          const isRepeat = !!item.repeat_enabled && target > 1;
          const tagEl = (
            <TouchableOpacity style={s.tagBtn} onPress={() => onOpenDetail(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[s.tagIcon, !item.icon && s.tagIconEmpty]}>{item.icon ?? ''}</Text>
            </TouchableOpacity>
          );
          const checkEl = (
            <TouchableOpacity
              style={[s.checkBox, isDone && s.checkBoxDone]}
              onPress={() => onToggle(item.id)}
              onLongPress={isRepeat ? () => onLongPressCheck(item.id) : undefined}
              delayLongPress={350}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            >
              {isDone ? (
                <Text style={s.checkMark}>✓</Text>
              ) : isRepeat && count > 0 ? (
                <Text style={s.checkCount}>{count}</Text>
              ) : null}
            </TouchableOpacity>
          );
          return (
            <>
              {tagRight ? checkEl : tagEl}
                <TouchableOpacity
                  style={s.taskBody}
                  onPress={() => onOpenDetail(item)}
                  onLongPress={reorderEnabled ? () => onStartDrag(item.id) : undefined}
                delayLongPress={250}
                activeOpacity={0.7}
                >
                  <View style={s.taskTextWrap}>
                    <Text style={[s.taskTitle, isDone && s.taskTitleDone]} numberOfLines={2}>{item.title}</Text>
                    <View style={s.taskMetaRow}>
                      {item.scheduled_time && <Text style={s.scheduleTag}>{item.notify ? '🔔 ' : ''}{item.scheduled_time}</Text>}
                      <Text style={s.freqTag}>{frequencyLabel(item)}</Text>
                    </View>
                  </View>
                  <View style={s.taskSide}>
                    {(notifyIcon || autoMeasureIcon) && (
                      <View style={s.taskStatusRow}>
                        {notifyIcon && (
                          <View style={s.taskStatusIcon}>
                            <Text style={s.taskStatusIconText}>{notifyIcon}</Text>
                          </View>
                        )}
                        {autoMeasureIcon && (
                          <View style={s.taskStatusIcon}>
                            <Text style={s.taskStatusIconText}>{autoMeasureIcon}</Text>
                          </View>
                        )}
                      </View>
                    )}
                    {isRepeat ? (
                      count > 0 && <View style={s.doneBadge}><Text style={s.doneBadgeText}>{Math.min(count, target)}/{target}完了</Text></View>
                    ) : (
                      isDone && <View style={s.doneBadge}><Text style={s.doneBadgeText}>完了</Text></View>
                    )}
                  </View>
                </TouchableOpacity>
              {tagRight ? tagEl : checkEl}
            </>
          );
        })()}
      </Animated.View>
    </View>
  );
}, (prev, next) => (
  taskContentEqual(prev.item, next.item) &&
  prev.count === next.count &&
  prev.isDone === next.isDone &&
  prev.isDragging === next.isDragging &&
  prev.isSwiping === next.isSwiping &&
  prev.reorderEnabled === next.reorderEnabled &&
  prev.tagRight === next.tagRight &&
  prev.s === next.s &&
  prev.panHandlers === next.panHandlers &&
  prev.shiftAnim === next.shiftAnim &&
  prev.dragY === next.dragY &&
  prev.dragScale === next.dragScale &&
  prev.swipeAnim === next.swipeAnim &&
  prev.onToggle === next.onToggle &&
  prev.onLongPressCheck === next.onLongPressCheck &&
  prev.onOpenDetail === next.onOpenDetail &&
  prev.onStartDrag === next.onStartDrag &&
  prev.onMeasureHeight === next.onMeasureHeight
));

export default function HomeScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { C, grad, dark } = useTheme();
  const { isPremium } = usePurchases();
  const { recordAction } = useAds();
  const s = useMemo(() => makeStyles(C), [C]);
  const screen = Dimensions.get('window');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [tagRight, setTagRight] = useState(false);
  const tasksRef = useRef<Task[]>([]);
  const [completionCounts, setCompletionCounts] = useState<Map<number, number>>(new Map());
  const completionCountsRef = useRef<Map<number, number>>(completionCounts);
  const displayedTasksRef = useRef<Task[]>([]);
  const [showThumb, setShowThumb] = useState(false);
  const thumbAnim = useRef(new Animated.Value(0)).current;
  const thumbOpacity = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const bloomAnim = useRef(new Animated.Value(0)).current;
  const fabPosition = useRef({ x: Math.max(screen.width - 72, 20), y: Math.max(screen.height - insets.bottom - 132, 120) });
  const fabStartPosition = useRef(fabPosition.current);
  const fabAnim = useRef(new Animated.ValueXY(fabPosition.current)).current;
  const [activeDragId, setActiveDragId] = useState<number | null>(null);
  const dragState = useRef({ taskId: null as number | null, startIndex: 0, currentIndex: 0, changed: false });
  const shiftAnims = useRef<Map<number, Animated.Value>>(new Map());
  const currentDragYRef = useRef(0);
  const displayedTasksAtDragStart = useRef<Task[]>([]);
  // Measured at runtime via onLayout so shift animations match actual card height.
  const dragSlotRef = useRef(DRAG_SLOT);
  const dragY = useRef(new Animated.Value(0)).current;
  const dragScale = useRef(new Animated.Value(1)).current;
  const getShiftAnim = (taskId: number): Animated.Value => {
    let anim = shiftAnims.current.get(taskId);
    if (!anim) { anim = new Animated.Value(0); shiftAnims.current.set(taskId, anim); }
    return anim;
  };
  const swipeState = useRef({ taskId: null as number | null });
  const swipeAnim = useRef(new Animated.Value(0)).current;
  // Mirror of the actively-swiping card id, in state so the swipe transform
  // actually binds (a ref alone won't re-render to apply the animated styles).
  const [swipingId, setSwipingId] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterFreq, setFilterFreq] = useState<FilterFreq>('all');
  const [filterDue, setFilterDue] = useState<FilterDue>('all');
  const [sortKey, setSortKey] = useState<SortKey>('manual');
  const [activePanel, setActivePanel] = useState<'filter' | 'sort' | null>(null);
  const panelAnim = useRef(new Animated.Value(0)).current;
  const lastPanelRef = useRef<'filter' | 'sort'>('filter');
  if (activePanel) lastPanelRef.current = activePanel;
  const today = getToday();
  const [selectedDate, setSelectedDate] = useState(today);
  const dateChangeAnim = useRef(new Animated.Value(1)).current;
  const dateDirRef = useRef(1);
  const shiftSelected = (days: number) => {
    dateDirRef.current = days >= 0 ? 1 : -1;
    const d = new Date(`${selectedDate}T00:00:00`);
    d.setDate(d.getDate() + days);
    setSelectedDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  };
  const jumpToToday = () => {
    if (selectedDate === today) return;
    dateDirRef.current = selectedDate < today ? 1 : -1;
    setSelectedDate(today);
  };
  useEffect(() => {
    dateChangeAnim.setValue(0);
    Animated.timing(dateChangeAnim, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [selectedDate, dateChangeAnim]);
  const selDateObj = new Date(`${selectedDate}T00:00:00`);

  // Add task sheet draft
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newIcon, setNewIcon] = useState<string | null>(null);
  const [newPriority, setNewPriority] = useState(-1);
  const [addPicker, setAddPicker] = useState<MetaPicker>(null);
  const [newTime, setNewTime] = useState<string | null>(null);
  const [newNotify, setNewNotify] = useState(false);
  const [newNotifyType, setNewNotifyType] = useState<'push' | 'alarm'>('push');
  const [newFreqType, setNewFreqType] = useState<FreqType>('daily');
  const [newDays, setNewDays] = useState<number[]>([]);
  const [newFreqWeeks, setNewFreqWeeks] = useState<number[]>([1]);
  const [newFreqWeekdays, setNewFreqWeekdays] = useState<number[]>([1]);
  const [newFreqInterval, setNewFreqInterval] = useState(2);
  const [newIntervalPickerOpen, setNewIntervalPickerOpen] = useState(false);
  const [newDay, setNewDay] = useState(1);
  const [newOnceDate, setNewOnceDate] = useState<string>(today);
  const [newFreqDates, setNewFreqDates] = useState<string[]>([]);
  const [newNote, setNewNote] = useState('');
  const [newAutoTimerEnabled, setNewAutoTimerEnabled] = useState(false);
  const [newAutoTimerTime, setNewAutoTimerTime] = useState<string | null>(null);
  const [newAutoTimerMode, setNewAutoTimerMode] = useState<'stopwatch' | 'timer'>('stopwatch');
  const [newAutoTimerMinutes, setNewAutoTimerMinutes] = useState(25);
  const [newRepeatEnabled, setNewRepeatEnabled] = useState(false);
  const [newRepeatTarget, setNewRepeatTarget] = useState(2);
  const [showNotifyGuide, setShowNotifyGuide] = useState(false);
  const [showBatteryGuide, setShowBatteryGuide] = useState(false);
  const onboardingShownRef = useRef(false);

  // Task detail sheet
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [detailTitle, setDetailTitle] = useState('');
  const [detailPicker, setDetailPicker] = useState<MetaPicker>(null);
  const [detailIntervalPickerOpen, setDetailIntervalPickerOpen] = useState(false);

  // Shared time editor (numeric input)
  const [timePickerFor, setTimePickerFor] = useState<'add' | 'edit' | 'autoTimerAdd' | 'autoTimerEdit' | null>(null);
  const [hourInput, setHourInput] = useState('8');
  const [minuteInput, setMinuteInput] = useState('00');

  const splashHiddenRef = useRef(false);
  // Bumped whenever the list is (re)loaded, so rows replay their entrance
  // animation on screen focus / date change instead of just on first mount.
  const [listAnimKey, setListAnimKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const [ts, counts, layout] = await Promise.all([
        getTasks(db),
        getCompletionCounts(db, selectedDate),
        getSetting(db, 'card_layout'),
      ]);
      setTasks(ts);
      setCompletionCounts(counts);
      setTagRight(layout === 'tag_right');
      setTasksLoaded(true);
      setListAnimKey((k) => k + 1);
    } finally {
      if (!splashHiddenRef.current) {
        splashHiddenRef.current = true;
        SplashScreen.hideAsync().catch(() => {});
      }
    }
  }, [db, selectedDate]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    completionCountsRef.current = completionCounts;
  }, [completionCounts]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      UIManager.setLayoutAnimationEnabledExperimental?.(true);
    }
  }, []);

  useEffect(() => {
    if (!tasksLoaded || onboardingShownRef.current) return;
    onboardingShownRef.current = true;
    (async () => {
      const notifyGuideDone = await getSetting(db, 'notifyGuideDone');
      if (!notifyGuideDone) {
        setShowNotifyGuide(true);
        return;
      }
      if (Platform.OS === 'android') {
        const batteryGuideDone = await getSetting(db, 'batterySaverGuideDone');
        if (!batteryGuideDone) setShowBatteryGuide(true);
      }
    })();
  }, [db, tasksLoaded]);

  // Keep monthly-nth / every-n-days reminders (which can't natively repeat) armed for the next occurrence.
  useFocusEffect(useCallback(() => {
    (async () => {
      const ts = await getTasks(db);
      for (const t of ts) {
        const oneShot = t.freq_type === 'monthly_nth' || t.freq_type === 'every_n_days';
        if (t.notify && t.scheduled_time && oneShot) {
          const notify_id = await rescheduleTask(t);
          await updateTask(db, t.id, { notify_id });
        }
        if (t.auto_timer_enabled && t.auto_timer_time && oneShot) {
          const auto_timer_notify_id = await rescheduleAutoTimer(t);
          await updateTask(db, t.id, { auto_timer_notify_id });
        }
      }
    })();
  }, [db]));

  const triggerCelebration = () => {
    setShowThumb(true);
    thumbAnim.setValue(0);
    thumbOpacity.setValue(0);
    bloomAnim.setValue(0);
    Animated.parallel([
      Animated.timing(bloomAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(40),
        Animated.timing(thumbAnim, { toValue: 0.14, duration: 80, useNativeDriver: true }),
        Animated.timing(thumbAnim, { toValue: 0.28, duration: 90, useNativeDriver: true }),
        Animated.timing(thumbAnim, { toValue: 0.44, duration: 90, useNativeDriver: true }),
        Animated.timing(thumbAnim, { toValue: 0.6, duration: 90, useNativeDriver: true }),
        Animated.timing(thumbAnim, { toValue: 0.78, duration: 110, useNativeDriver: true }),
        Animated.timing(thumbAnim, { toValue: 1, duration: 140, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(thumbOpacity, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.delay(1200),
        Animated.timing(thumbOpacity, { toValue: 0, duration: 260, useNativeDriver: true }),
      ]),
    ]).start(() => setShowThumb(false));
  };

  // Gate a premium-only toggle: runs onEnable only if subscribed, otherwise
  // prompts the upgrade screen instead of turning the feature on.
  const requirePremium = useCallback((onEnable: () => void) => {
    if (isPremium) { onEnable(); return; }
    Alert.alert(
      'プレミアム機能です',
      'この機能はプレミアム限定です。アップグレードしますか？',
      [
        { text: 'キャンセル', style: 'cancel' },
        { text: 'プレミアムを見る', onPress: () => navigation.navigate('Upgrade') },
      ]
    );
  }, [isPremium, navigation]);

  // Ask for a store review at most once, and only once the user has some
  // real completion history — a much better moment than right at launch.
  const REVIEW_PROMPT_THRESHOLD = 10;
  const maybeRequestReview = useCallback(async () => {
    const shown = await getSetting(db, 'reviewPromptShown');
    if (shown) return;
    const total = await getTotalCompletionsCount(db);
    if (total < REVIEW_PROMPT_THRESHOLD) return;
    const available = await StoreReview.isAvailableAsync();
    if (!available) return;
    await setSetting(db, 'reviewPromptShown', '1');
    StoreReview.requestReview();
  }, [db]);

  const toggle = useCallback(async (id: number) => {
    const task = tasksRef.current.find((t) => t.id === id);
    const count = completionCountsRef.current.get(id) ?? 0;
    const target = task ? targetFor(task) : 1;
    const wasDone = count >= target;
    if (wasDone) {
      // Already done (including over-complete repeat tasks past target) —
      // tapping resets it back to zero rather than piling on further.
      await resetCompletion(db, id, selectedDate);
    } else {
      await markComplete(db, id, selectedDate);
      if (count + 1 >= target) triggerCelebration();
      recordAction('complete');
      maybeRequestReview();
    }
    load();
  }, [db, selectedDate, load, recordAction, maybeRequestReview]);

  // Long-press removes just one instance — for nudging a repeat task's count
  // down without resetting it all the way to zero.
  const longPressCheck = useCallback(async (id: number) => {
    const count = completionCountsRef.current.get(id) ?? 0;
    if (count <= 0) return;
    await markIncomplete(db, id, selectedDate);
    load();
  }, [db, selectedDate, load]);

  const resetAddDraft = () => {
    setNewTitle('');
    setNewIcon(null);
    setNewPriority(-1);
    setAddPicker(null);
    setNewTime(null);
    setNewNotify(false);
    setNewNotifyType('push');
    setNewFreqType('daily');
    setNewDays([]);
    setNewFreqWeeks([1]);
    setNewFreqWeekdays([1]);
    setNewFreqInterval(2);
    setNewDay(1);
    setNewOnceDate(today);
    setNewFreqDates([]);
    setNewNote('');
    setNewAutoTimerEnabled(false);
    setNewAutoTimerTime(null);
    setNewAutoTimerMode('stopwatch');
    setNewAutoTimerMinutes(25);
    setNewRepeatEnabled(false);
    setNewRepeatTarget(2);
  };

  const handleAdd = async () => {
    const title = newTitle.trim();
    if (!title) return;
    const taskId = await addTask(db, title);
    const fields: TaskFields = {
      icon: newIcon,
      priority: newPriority,
      scheduled_time: newTime,
      notify: newNotify ? 1 : 0,
      notify_type: newNotifyType,
      freq_type: newFreqType,
      freq_days: newFreqType === 'weekly' ? daysToCsv(newDays) : newFreqType === 'monthly_nth' ? daysToCsv(newFreqWeekdays) : null,
      freq_week: null,
      freq_weekday: null,
      freq_weeks: newFreqType === 'monthly_nth' ? daysToCsv(newFreqWeeks) : null,
      freq_interval: newFreqType === 'every_n_days' ? newFreqInterval : null,
      freq_day: newFreqType === 'monthly_day' ? newDay : null,
      once_date: (newFreqType === 'once' || newFreqType === 'every_n_days') ? newOnceDate : null,
      freq_dates: newFreqType === 'dates' ? newFreqDates.slice().sort().join(',') : null,
      note: newNote.trim() || null,
      auto_timer_enabled: newAutoTimerEnabled ? 1 : 0,
      auto_timer_time: newAutoTimerTime,
      auto_timer_mode: newAutoTimerMode,
      auto_timer_minutes: newAutoTimerMinutes,
      repeat_enabled: newRepeatEnabled ? 1 : 0,
      repeat_target: newRepeatTarget,
    };
    await updateTask(db, taskId, fields);
    if (newNotify && newTime) {
      const notify_id = await rescheduleTask({
        title, icon: newIcon, scheduled_time: newTime, notify: 1, notify_id: null, notify_type: newNotifyType,
        freq_type: fields.freq_type!, freq_days: fields.freq_days ?? null,
        freq_week: fields.freq_week ?? null, freq_weekday: fields.freq_weekday ?? null, freq_day: fields.freq_day ?? null,
        once_date: fields.once_date ?? null, freq_dates: fields.freq_dates ?? null,
        freq_weeks: fields.freq_weeks ?? null, freq_interval: fields.freq_interval ?? null,
      });
      await updateTask(db, taskId, { notify_id });
    }
    if (newAutoTimerEnabled && newAutoTimerTime) {
      const auto_timer_notify_id = await rescheduleAutoTimer({
        id: taskId, title, icon: newIcon,
        auto_timer_enabled: 1, auto_timer_time: newAutoTimerTime, auto_timer_mode: newAutoTimerMode, auto_timer_minutes: newAutoTimerMinutes,
        freq_type: fields.freq_type!, freq_days: fields.freq_days ?? null,
        freq_week: fields.freq_week ?? null, freq_weekday: fields.freq_weekday ?? null, freq_day: fields.freq_day ?? null,
        once_date: fields.once_date ?? null, freq_dates: fields.freq_dates ?? null,
        freq_weeks: fields.freq_weeks ?? null, freq_interval: fields.freq_interval ?? null,
      });
      await updateTask(db, taskId, { auto_timer_notify_id });
    }
    resetAddDraft();
    setShowAdd(false);
    load();
    recordAction('add');
  };

  const closeAddSheet = () => {
    setShowAdd(false);
    resetAddDraft();
    setTimePickerFor(null);
  };

  const openDetail = useCallback((task: Task) => {
    setDetailTask(task);
    setDetailTitle(task.title);
    setDetailPicker(null);
  }, []);

  const handleSaveTitle = async () => {
    if (!detailTask || !detailTitle.trim() || detailTitle === detailTask.title) return;
    await updateTask(db, detailTask.id, { title: detailTitle.trim() });
    setDetailTask(t => t ? { ...t, title: detailTitle.trim() } : null);
    load();
  };

  const handleDetailSave = async () => {
    await handleSaveTitle();
    setDetailTask(null);
  };

  // Persist a change to the open task; reschedule reminders when relevant.
  const patchDetail = async (patch: TaskFields) => {
    if (!detailTask) return;
    const merged = { ...detailTask, ...patch } as Task;
    await updateTask(db, detailTask.id, patch);
    const scheduleKeys: (keyof TaskFields)[] = ['scheduled_time', 'notify', 'notify_type', 'freq_type', 'freq_days', 'freq_week', 'freq_weekday', 'freq_day', 'once_date', 'freq_weeks', 'freq_interval'];
    const autoTimerKeys: (keyof TaskFields)[] = ['auto_timer_enabled', 'auto_timer_time', 'auto_timer_mode', 'auto_timer_minutes', 'freq_type', 'freq_days', 'freq_week', 'freq_weekday', 'freq_day', 'once_date', 'freq_weeks', 'freq_interval'];
    let next = merged;
    if (scheduleKeys.some(k => k in patch)) {
      const notify_id = await rescheduleTask(merged);
      await updateTask(db, detailTask.id, { notify_id });
      next = { ...next, notify_id };
    }
    if (autoTimerKeys.some(k => k in patch)) {
      const auto_timer_notify_id = await rescheduleAutoTimer(next);
      await updateTask(db, detailTask.id, { auto_timer_notify_id });
      next = { ...next, auto_timer_notify_id };
    }
    setDetailTask(next);
    load();
  };

  const handleDelete = (task: Task, onCancel?: () => void) => {
    Alert.alert('削除', `「${task.title}」を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel', onPress: onCancel },
      {
        text: '削除', style: 'destructive',
        onPress: async () => {
          const identifiers = await deleteTask(db, task.id);
          await cancelIds(identifiers.join(','));
          if (detailTask?.id === task.id) setDetailTask(null);
          setSwipingId(null);
          load();
        },
      },
    ]);
  };

  const openTimeEditor = (target: 'add' | 'edit' | 'autoTimerAdd' | 'autoTimerEdit', current: string | null) => {
    if (current) {
      const [h, m] = current.split(':');
      setHourInput(String(Number(h)));
      setMinuteInput(m);
    } else {
      setHourInput('8');
      setMinuteInput('00');
    }
    setTimePickerFor(target);
  };

  const confirmTime = async () => {
    const h = Math.max(0, Math.min(23, parseInt(hourInput, 10) || 0));
    const m = Math.max(0, Math.min(59, parseInt(minuteInput, 10) || 0));
    const time = `${pad(h)}:${pad(m)}`;
    const target = timePickerFor;
    setTimePickerFor(null);
    if (target === 'add') setNewTime(time);
    else if (target === 'edit') await patchDetail({ scheduled_time: time });
    else if (target === 'autoTimerAdd') setNewAutoTimerTime(time);
    else if (target === 'autoTimerEdit') await patchDetail({ auto_timer_time: time });
  };

  const toggleNewNotify = async (value: boolean) => {
    if (value && !(await ensurePermission())) return;
    setNewNotify(value);
  };

  const toggleDetailNotify = async (value: boolean) => {
    if (value && !(await ensurePermission())) return;
    await patchDetail({ notify: value ? 1 : 0 });
  };

  const handleNotifyGuideLater = useCallback(async () => {
    setShowNotifyGuide(false);
    await setSetting(db, 'notifyGuideDone', '1');
    if (Platform.OS === 'android') {
      const batteryGuideDone = await getSetting(db, 'batterySaverGuideDone');
      if (!batteryGuideDone) setShowBatteryGuide(true);
    }
  }, [db]);

  const handleNotifyGuideEnable = useCallback(async () => {
    const granted = await ensurePermission();
    setShowNotifyGuide(false);
    await setSetting(db, 'notifyGuideDone', '1');
    if (Platform.OS === 'android') {
      const batteryGuideDone = await getSetting(db, 'batterySaverGuideDone');
      if (!batteryGuideDone) setShowBatteryGuide(true);
    } else if (!granted) {
      Alert.alert('通知は未許可です', 'あとから設定画面で通知をオンにできます。');
    }
  }, [db]);

  const closeBatteryGuide = useCallback(async () => {
    setShowBatteryGuide(false);
    await setSetting(db, 'batterySaverGuideDone', '1');
  }, [db]);

  const openBatterySaverSettings = useCallback(async () => {
    try {
      await Linking.openSettings();
    } catch {
    } finally {
      await closeBatteryGuide();
    }
  }, [closeBatteryGuide]);

  const getTimerPresetMinutes = useCallback(async (taskId: number): Promise<number | null> => {
    const saved = await getTimerSettingForTask(db, taskId);
    if (!saved || saved.target_seconds <= 0) {
      Alert.alert('タイマー未設定', '自動計測でタイマーを使用するためには、計測タブに移動してタイマーの時間を設定してください。');
      return null;
    }
    return Math.max(1, Math.round(saved.target_seconds / 60));
  }, [db]);

  const done = useMemo(() => tasks.filter((t) => isTaskDone(t, completionCounts.get(t.id) ?? 0)).length, [tasks, completionCounts]);
  const total = tasks.length;
  const progress = total > 0 ? done / total : 0;
  // Gauge gradient color by completion ratio.
  const gaugeColors = (
    progress >= 1 ? ['#34d399', '#059669'] :
    progress >= 0.67 ? ['#4ade80', '#16a34a'] :
    progress >= 0.34 ? ['#facc15', '#f59e0b'] :
    ['#fb7185', '#e11d48']
  ) as readonly [string, string];
  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id - b.id;
  }), [tasks]);

  // Drag reorder only makes sense in unfiltered manual order.
  const reorderEnabled = sortKey === 'manual' && filterStatus === 'all' && filterFreq === 'all' && filterDue === 'all';
  const displayedTasks = useMemo(() => {
    // Hide one-time tasks whose day has already passed.
    let list = sortedTasks.filter((t) => {
      if (t.freq_type === 'once' && t.once_date && t.once_date < selectedDate) return false;
      if (t.freq_type === 'dates') {
        const ds = parseDateList(t.freq_dates);
        if (ds.length > 0 && ds.every((d) => d < selectedDate)) return false;
      }
      return true;
    });
    if (filterStatus === 'incomplete') list = list.filter((t) => !isTaskDone(t, completionCounts.get(t.id) ?? 0));
    else if (filterStatus === 'done') list = list.filter((t) => isTaskDone(t, completionCounts.get(t.id) ?? 0));
    if (filterFreq === 'daily') list = list.filter((t) => t.freq_type === 'daily');
    else if (filterFreq === 'other') list = list.filter((t) => t.freq_type !== 'daily');
    if (filterDue === 'today') list = list.filter((t) => isDueToday(t, selDateObj));
    if (sortKey === 'priority') {
      list = [...list].sort((a, b) => (b.priority - a.priority) || (a.sort_order - b.sort_order));
    } else if (sortKey === 'time') {
      list = [...list].sort((a, b) => {
        const at = a.scheduled_time ?? '99:99';
        const bt = b.scheduled_time ?? '99:99';
        return at < bt ? -1 : at > bt ? 1 : a.sort_order - b.sort_order;
      });
    } else if (sortKey === 'name') {
      list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'ja'));
    }
    return list;
  }, [sortedTasks, selectedDate, filterStatus, filterFreq, filterDue, sortKey, completionCounts, selDateObj]);
  displayedTasksRef.current = displayedTasks;

  const persistTaskOrder = async () => {
    const ordered = [...tasksRef.current].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.id - b.id;
    });
    await updateTaskSortOrders(db, ordered.map((task) => task.id));
    load();
  };

  const moveTask = (taskId: number, toIndex: number) => {
    setTasks((current) => {
      const ordered = [...current].sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.id - b.id;
      });
      const fromIndex = ordered.findIndex((task) => task.id === taskId);
      if (fromIndex < 0) return current;
      const nextIndex = Math.max(0, Math.min(toIndex, ordered.length - 1));
      if (fromIndex === nextIndex) return current;
      const [moved] = ordered.splice(fromIndex, 1);
      ordered.splice(nextIndex, 0, moved);
      return ordered.map((task, index) => ({ ...task, sort_order: index }));
    });
  };

  // reads the latest list via a ref (rather than closing over displayedTasks
  // directly) and resolves the index by id, so this callback can stay
  // referentially stable — required for TaskRow's memoization to hold
  const startDrag = useCallback((taskId: number) => {
    const current = displayedTasksRef.current;
    const index = current.findIndex((t) => t.id === taskId);
    if (index < 0) return;
    swipeState.current.taskId = null;
    setSwipingId(null);
    swipeAnim.setValue(0);
    setActiveDragId(taskId);
    displayedTasksAtDragStart.current = current;
    dragState.current = { taskId, startIndex: index, currentIndex: index, changed: false };
    currentDragYRef.current = 0;
    dragY.setValue(0);
    shiftAnims.current.forEach((anim) => anim.setValue(0));
    Animated.spring(dragScale, {
      toValue: 1.04,
      useNativeDriver: true,
      tension: 220,
      friction: 14,
    }).start();
  }, []);

  const updateDrag = (dy: number) => {
    const state = dragState.current;
    if (state.taskId == null) return;
    currentDragYRef.current = dy;
    dragY.setValue(dy);
    const slot = dragSlotRef.current;
    const tasksAtStart = displayedTasksAtDragStart.current;
    const dragStartIndex = state.startIndex;
    // Fractional slots moved — drives both the threshold check and proportional shifts.
    const virtualOffset = dy / slot;
    const newCurrentIndex = Math.max(0, Math.min(
      tasksAtStart.length - 1,
      dragStartIndex + Math.round(virtualOffset),
    ));
    if (newCurrentIndex !== state.currentIndex) {
      state.currentIndex = newCurrentIndex;
      state.changed = true;
    }
    // Move each surrounding card proportionally to where the dragged card is.
    // No threshold, no animation — pure setValue so motion is perfectly continuous.
    tasksAtStart.forEach((task, i) => {
      if (task.id === state.taskId) return;
      const relPos = i - dragStartIndex;
      let shift = 0;
      if (virtualOffset > 0 && relPos > 0) {
        shift = -slot * Math.max(0, Math.min(1, virtualOffset - relPos + 1));
      } else if (virtualOffset < 0 && relPos < 0) {
        shift = slot * Math.max(0, Math.min(1, -virtualOffset + relPos + 1));
      }
      getShiftAnim(task.id).setValue(shift);
    });
  };

  const endDrag = () => {
    const state = dragState.current;
    const rawDy = currentDragYRef.current;
    const startTasks = displayedTasksAtDragStart.current;
    const dragStartIndex = state.startIndex;
    const finalIndex = Math.max(0, Math.min(startTasks.length - 1, state.currentIndex));

    let pendingTasks: Task[] | null = null;
    if (state.changed && state.taskId != null) {
      const reorderedDisplayed = [...startTasks];
      const [moved] = reorderedDisplayed.splice(dragStartIndex, 1);
      reorderedDisplayed.splice(finalIndex, 0, moved);

      // reorderedDisplayed only covers the filtered/displayed subset; overlay
      // its new order onto the full task list (in place of that same subset)
      // so no task outside the display filter gets dropped, and the write
      // below needs no follow-up reload to reconcile — avoiding a second,
      // heavier setTasks right after the drop animation finishes
      const displayedIds = new Set(startTasks.map((t) => t.id));
      const fullSorted = [...tasksRef.current].sort((a, b) =>
        a.sort_order !== b.sort_order ? a.sort_order - b.sort_order : a.id - b.id
      );
      let cursor = 0;
      const merged = fullSorted.map((task) => {
        if (!displayedIds.has(task.id)) return task;
        const next = reorderedDisplayed[cursor];
        cursor += 1;
        return next;
      });
      pendingTasks = merged.map((task, idx) => ({ ...task, sort_order: idx }));
      updateTaskSortOrders(db, pendingTasks.map((t) => t.id));
    }

    // Spring the dragged card AND every card it displaced into their final,
    // fully-settled positions together, so the drop reads as one continuous
    // motion instead of the dragged card alone finishing while its neighbors
    // sit frozen until it lands. Each neighbor's target here is exactly the
    // offset the reorder below will bake into its real position, so handing
    // off from transform to real order (in the completion callback) is
    // seamless — no snap-back frame, no jump.
    const slot = dragSlotRef.current;
    const targetDy = (finalIndex - dragStartIndex) * slot;
    dragState.current = { taskId: null, startIndex: 0, currentIndex: 0, changed: false };
    dragY.setValue(rawDy);

    const settleAnimations = [
      Animated.spring(dragY, { toValue: targetDy, useNativeDriver: true, tension: 220, friction: 14 }),
      Animated.spring(dragScale, { toValue: 1, useNativeDriver: true, tension: 220, friction: 14 }),
    ];
    startTasks.forEach((task, i) => {
      if (task.id === state.taskId) return;
      let finalShift = 0;
      if (finalIndex > dragStartIndex && i > dragStartIndex && i <= finalIndex) finalShift = -slot;
      else if (finalIndex < dragStartIndex && i >= finalIndex && i < dragStartIndex) finalShift = slot;
      settleAnimations.push(
        Animated.spring(getShiftAnim(task.id), { toValue: finalShift, useNativeDriver: true, tension: 220, friction: 14 })
      );
    });

    const tasks = pendingTasks;
    Animated.parallel(settleAnimations).start(({ finished }) => {
      if (!finished) return;
      shiftAnims.current.forEach((anim) => anim.setValue(0));
      if (tasks) setTasks(tasks);
      setActiveDragId(null);
    });
  };

  const resetSwipe = () => {
    swipeState.current.taskId = null;
    setSwipingId(null);
    Animated.spring(swipeAnim, { toValue: 0, useNativeDriver: true, tension: 180, friction: 12 }).start();
  };

  const confirmSwipeDelete = (task: Task, dx: number) => {
    const direction = dx < 0 ? -1 : 1;
    Animated.spring(swipeAnim, {
      toValue: direction * (screen.width + 80),
      speed: 22,
      bounciness: 0,
      useNativeDriver: true,
    }).start(() => {
      handleDelete(task, resetSwipe);
    });
  };

  const createTaskPanResponder = (taskId: number) => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => {
      if (dragState.current.taskId === taskId) return true;
      return Math.abs(gesture.dx) > 18 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4;
    },
    onPanResponderGrant: () => {
      if (dragState.current.taskId !== taskId) {
        swipeState.current.taskId = taskId;
        setSwipingId(taskId);
        swipeAnim.setValue(0);
      }
    },
    onPanResponderTerminationRequest: () => dragState.current.taskId !== taskId,
    onPanResponderMove: (_, gesture) => {
      if (dragState.current.taskId === taskId) {
        updateDrag(gesture.dy);
        return;
      }
      swipeAnim.setValue(Math.max(-220, Math.min(220, gesture.dx)));
    },
    onPanResponderRelease: (_, gesture) => {
      if (dragState.current.taskId === taskId) {
        endDrag();
        return;
      }
      if (Math.abs(gesture.dx) >= SWIPE_DELETE_THRESHOLD) {
        const task = tasksRef.current.find((t) => t.id === taskId);
        if (task) confirmSwipeDelete(task, gesture.dx);
        else resetSwipe();
      } else {
        resetSwipe();
      }
    },
    onPanResponderTerminate: () => {
      if (dragState.current.taskId === taskId) endDrag();
      resetSwipe();
    },
  });

  // Cache pan responders by task id so re-renders during a drag don't swap the
  // active responder (which would interrupt continuous reordering).
  const panResponders = useRef<Map<number, ReturnType<typeof PanResponder.create>>>(new Map());
  const getPanResponder = (taskId: number) => {
    let pr = panResponders.current.get(taskId);
    if (!pr) {
      pr = createTaskPanResponder(taskId);
      panResponders.current.set(taskId, pr);
    }
    return pr;
  };
  const handleRowLayout = useCallback((h: number) => {
    if (h > 10) dragSlotRef.current = h + DRAG_GAP;
  }, []);
  const clampFab = (x: number, y: number) => ({
    x: Math.max(8, Math.min(x, screen.width - 60)),
    y: Math.max(100, Math.min(y, screen.height - insets.bottom - 124)),
  });
  const fabPanResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
    onPanResponderGrant: () => { fabStartPosition.current = fabPosition.current; },
    onPanResponderMove: (_, gesture) => {
      const next = clampFab(fabStartPosition.current.x + gesture.dx, fabStartPosition.current.y + gesture.dy);
      fabAnim.setValue(next);
    },
    onPanResponderRelease: (_, gesture) => {
      const next = clampFab(fabStartPosition.current.x + gesture.dx, fabStartPosition.current.y + gesture.dy);
      fabPosition.current = next;
      fabAnim.setValue(next);
    },
    onPanResponderTerminate: () => { fabAnim.setValue(fabPosition.current); },
  })).current;

  useEffect(() => {
    Animated.timing(progressAnim, { toValue: progress, duration: 450, useNativeDriver: false }).start();
  }, [progress, progressAnim]);

  useEffect(() => {
    Animated.timing(panelAnim, { toValue: activePanel ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [activePanel, panelAnim]);

  const dateLabel = `${selDateObj.getFullYear()}/${pad(selDateObj.getMonth() + 1)}/${pad(selDateObj.getDate())} (${WEEKDAYS[selDateObj.getDay()]})`;
  const isToday = selectedDate === today;

  // ── Reusable editor sections ────────────────────────────────────────────

  // Animate the expand/collapse of the icon/priority/frequency option panels.
  const animateNext = () => LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));

  const renderSchedule = (
    time: string | null,
    notify: boolean,
    onPick: () => void,
    onToggleNotify: (v: boolean) => void,
    notifyType: 'push' | 'alarm',
    onSetNotifyType: (t: 'push' | 'alarm') => void,
  ) => (
    <View style={s.scheduleCard}>
      <View style={s.scheduleTopRow}>
        <TouchableOpacity style={[s.metaSelectBtn, s.scheduleTimeBtn]} onPress={onPick} activeOpacity={0.8}>
          <View style={s.metaSelectLeft}>
            <Text style={s.metaSelectText}>予定の時間：{time ?? '未設定'}</Text>
          </View>
          <Text style={s.metaSelectArrow}>›</Text>
        </TouchableOpacity>
        <View style={s.scheduleToggleTop}>
          <Text style={s.scheduleLabel}>通知する</Text>
          <Switch
            value={notify}
            onValueChange={onToggleNotify}
            trackColor={{ true: C.primary, false: C.border }}
            thumbColor="#ffffff"
          />
        </View>
      </View>
      {notify && !time && <Text style={s.scheduleHint}>※ 通知するには時間を設定してください</Text>}
      {notify && (
        <>
          <Text style={s.notifyTypeLabel}>通知の種類</Text>
          <View style={s.notifyTypeRow}>
            <TouchableOpacity style={[s.notifyTypeChip, notifyType === 'push' && s.notifyTypeChipActive]} onPress={() => onSetNotifyType('push')}>
              <Text style={[s.notifyTypeText, notifyType === 'push' && s.notifyTypeTextActive]}>🔔 プッシュ通知</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.notifyTypeChip, notifyType === 'alarm' && s.notifyTypeChipActive]} onPress={() => onSetNotifyType('alarm')}>
              <Text style={[s.notifyTypeText, notifyType === 'alarm' && s.notifyTypeTextActive]}>⏰ アラート</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );

  // Fires a notification at the set time; tapping it starts the measurement
  // (see the response listener in TimerContext) — no in-app manual button.
  const renderAutoTimer = (
    enabled: boolean,
    time: string | null,
    mode: string,
    onToggleEnabled: (v: boolean) => void,
    onPick: () => void,
    onClear: () => void,
    onSetMode: (m: 'stopwatch' | 'timer') => void,
  ) => (
    <View style={s.scheduleCard}>
      <View style={s.scheduleTopRow}>
        <TouchableOpacity style={[s.metaSelectBtn, s.scheduleTimeBtn]} onPress={onPick} activeOpacity={0.8}>
          <View style={s.metaSelectLeft}>
            <Text style={s.metaSelectText}>開始時刻：{time ?? '未設定'}</Text>
          </View>
          <Text style={s.metaSelectArrow}>›</Text>
        </TouchableOpacity>
        <View style={s.scheduleToggleTop}>
          <Text style={s.scheduleLabel}>有効にする</Text>
          <Switch
            value={enabled}
            onValueChange={onToggleEnabled}
            trackColor={{ true: C.primary, false: C.border }}
            thumbColor="#ffffff"
          />
        </View>
      </View>
      {time && (
        <TouchableOpacity onPress={onClear} style={s.clearTimeBtn}>
          <Text style={s.clearTimeText}>時刻をクリア</Text>
        </TouchableOpacity>
      )}
      {enabled && !time && <Text style={s.scheduleHint}>※ 自動計測には開始時刻の設定が必要です</Text>}
      {enabled && (
        <>
          <View style={s.notifyTypeRow}>
            <TouchableOpacity style={[s.notifyTypeChip, mode === 'stopwatch' && s.notifyTypeChipActive]} onPress={() => onSetMode('stopwatch')}>
              <Text style={[s.notifyTypeText, mode === 'stopwatch' && s.notifyTypeTextActive]}>▶ ストップウォッチ</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.notifyTypeChip, mode === 'timer' && s.notifyTypeChipActive]} onPress={() => onSetMode('timer')}>
              <Text style={[s.notifyTypeText, mode === 'timer' && s.notifyTypeTextActive]}>⏱ タイマー</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.scheduleHint}>指定時刻に通知が届き、タップするとその場で計測が始まります</Text>
        </>
      )}
    </View>
  );

  // Lets a task be checked off multiple times a day. Tapping the checkbox
  // always adds one; long-pressing it removes one — the only way back once
  // the count is past the target.
  const renderRepeat = (
    enabled: boolean,
    targetCount: number,
    onToggleEnabled: (v: boolean) => void,
    onSetTarget: (n: number) => void,
  ) => (
    <View style={s.scheduleCard}>
      <View style={s.scheduleTopRow}>
        <View style={s.metaSelectLeft}>
          <Text style={s.metaSelectText}>複数回タスクにする</Text>
        </View>
        <View style={s.scheduleToggleTop}>
          <Switch
            value={enabled}
            onValueChange={onToggleEnabled}
            trackColor={{ true: C.primary, false: C.border }}
            thumbColor="#ffffff"
          />
        </View>
      </View>
      {enabled && (
        <>
          <View style={s.timerDurationRow}>
            <Text style={s.timerDurationLabel}>1日の目標回数：</Text>
            <TextInput
              style={s.timerDurationInput}
              value={String(targetCount)}
              onChangeText={(v) => onSetTarget(Math.max(2, parseInt(v.replace(/[^0-9]/g, ''), 10) || 2))}
              keyboardType="number-pad"
              maxLength={2}
            />
            <Text style={s.timerDurationLabel}>回</Text>
          </View>
          <Text style={s.scheduleHint}>タップで1回分チェック、長押しで1回分取り消せます</Text>
        </>
      )}
    </View>
  );

  const renderFrequency = (
    freqType: FreqType,
    days: number[],
    weeks: number[],
    weekdays: number[],
    day: number,
    interval: number,
    on: {
      setType: (t: FreqType) => void;
      toggleDay: (d: number) => void;
      toggleWeek: (w: number) => void;
      toggleWeekday: (d: number) => void;
      setDay: (d: number) => void;
      setOnceDate: (d: string) => void;
      toggleDate: (ds: string) => void;
      setInterval: (n: number) => void;
    },
    openPicker: MetaPicker,
    setOpenPicker: (picker: MetaPicker) => void,
    onceDate: string | null,
    freqDates: string | null,
    intervalPickerOpen: boolean,
    setIntervalPickerOpen: (open: boolean) => void,
  ) => {
    const freqText = frequencyLabel({
      freq_type: freqType, freq_days: freqType === 'weekly' ? daysToCsv(days) : daysToCsv(weekdays),
      freq_week: weeks[0] ?? 1, freq_weekday: weekdays[0] ?? 0, freq_weeks: daysToCsv(weeks),
      freq_day: day, once_date: onceDate, freq_dates: freqDates, freq_interval: interval,
    });
    const onSelectDate = (ref: Date, ds: string) => {
      if (freqType === 'dates') {
        on.toggleDate(ds);
      } else if (freqType === 'once' || freqType === 'every_n_days') {
        on.setOnceDate(ds);
      } else {
        // 他の頻度でタップ → 「任意」に自動切り替えしてその日を追加
        on.setType('dates');
        on.toggleDate(ds);
      }
    };
    return (
    <>
      <Text style={[s.sheetSection, { marginTop: 16 }]}>頻度</Text>
      <TouchableOpacity
        style={s.metaSelectBtn}
        onPress={() => setOpenPicker(openPicker === 'freq' ? null : 'freq')}
        activeOpacity={0.8}
      >
        <View style={s.metaSelectLeft}>
          <Text style={s.metaSelectText} numberOfLines={1}>頻度：{freqText}</Text>
        </View>
        <Text style={s.metaSelectArrow}>{openPicker === 'freq' ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      <Modal visible={openPicker === 'freq'} transparent animationType="slide" onRequestClose={() => setOpenPicker(null)}>
        <TouchableOpacity style={s.freqModalBg} activeOpacity={1} onPress={() => setOpenPicker(null)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[s.freqModalCard, { maxHeight: screen.height * 0.8, marginBottom: insets.bottom + 12 }]}>
            <View style={s.sheetHandle} />
            <View style={s.freqModalHead}>
              <Text style={s.freqModalTitle}>頻度</Text>
              <TouchableOpacity onPress={() => setOpenPicker(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={s.freqModalDone}>完了</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 4 }}>
              <View style={s.freqPanel}>
                <FreqTypeChips freqType={freqType} onSetType={on.setType} s={s} />

                {freqType === 'weekly' && (
                  <View style={s.weekdayRow}>
                    {WEEKDAYS.map((w, i) => {
                      const active = days.includes(i);
                      return (
                        <PulseChip
                          key={w}
                          wrapStyle={{ flex: 1 }}
                          style={[s.dayChip, active && s.dayChipActive, i === 0 && s.daySun, i === 6 && s.daySat]}
                          onPress={() => on.toggleDay(i)}
                        >
                          <Text style={[s.dayChipText, active && s.dayChipTextActive]}>{w}</Text>
                        </PulseChip>
                      );
                    })}
                  </View>
                )}

                {freqType === 'monthly_nth' && (
                  <>
                    <View style={s.weekChoiceRow}>
                      {NTH_WEEKS.map((w) => {
                        const active = weeks.includes(w.value);
                        return (
                          <PulseChip
                            key={w.value}
                            wrapStyle={{ flex: 1 }}
                            style={[s.weekChip, active && s.weekChipActive]}
                            onPress={() => on.toggleWeek(w.value)}
                          >
                            <Text style={[s.weekChipText, active && s.weekChipTextActive]}>{w.label}</Text>
                          </PulseChip>
                        );
                      })}
                    </View>
                    <View style={s.weekdayRow}>
                      {WEEKDAYS.map((w, i) => {
                        const active = weekdays.includes(i);
                        return (
                          <PulseChip
                            key={w}
                            wrapStyle={{ flex: 1 }}
                            style={[s.dayChip, active && s.dayChipActive, i === 0 && s.daySun, i === 6 && s.daySat]}
                            onPress={() => on.toggleWeekday(i)}
                          >
                            <Text style={[s.dayChipText, active && s.dayChipTextActive]}>{w}</Text>
                          </PulseChip>
                        );
                      })}
                    </View>
                  </>
                )}

                {freqType === 'every_n_days' && (
                  <>
                    <TouchableOpacity
                      style={s.metaSelectBtn}
                      onPress={() => { animateNext(); setIntervalPickerOpen(!intervalPickerOpen); }}
                      activeOpacity={0.8}
                    >
                      <View style={s.metaSelectLeft}>
                        <Text style={s.metaSelectText}>{interval}日ごと</Text>
                      </View>
                      <Text style={s.metaSelectArrow}>{intervalPickerOpen ? '▲' : '▼'}</Text>
                    </TouchableOpacity>
                    {intervalPickerOpen && (
                      <View style={s.intervalGrid}>
                        {Array.from({ length: 29 }, (_, i) => i + 2).map((n) => (
                          <PulseChip
                            key={n}
                            style={[s.monthDayChip, interval === n && s.monthDayChipActive]}
                            onPress={() => { on.setInterval(n); setIntervalPickerOpen(false); }}
                          >
                            <Text style={[s.monthDayText, interval === n && s.monthDayTextActive]}>{n}</Text>
                          </PulseChip>
                        ))}
                      </View>
                    )}
                  </>
                )}

                {freqType === 'monthly_day' && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.monthDayRow}>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <PulseChip
                        key={d}
                        style={[s.monthDayChip, day === d && s.monthDayChipActive]}
                        onPress={() => on.setDay(d)}
                      >
                        <Text style={[s.monthDayText, day === d && s.monthDayTextActive]}>{d}</Text>
                      </PulseChip>
                    ))}
                  </ScrollView>
                )}

                {(freqType === 'once' || freqType === 'dates' || freqType === 'every_n_days') && (
                  <Text style={s.calHint}>
                    {freqType === 'dates' ? 'カレンダーをタップして任意の日を選択（複数可）'
                      : freqType === 'every_n_days' ? 'カレンダーをタップして開始日を選択'
                      : 'カレンダーをタップして日付を選択'}
                  </Text>
                )}
                <FreqCalendar
                  freq={{
                    freq_type: freqType, freq_days: freqType === 'weekly' ? daysToCsv(days) : daysToCsv(weekdays),
                    freq_week: weeks[0] ?? 1, freq_weekday: weekdays[0] ?? 0, freq_weeks: daysToCsv(weeks),
                    freq_day: day, once_date: onceDate, freq_dates: freqDates, freq_interval: interval,
                  }}
                  onceDate={onceDate}
                  onSelect={onSelectDate}
                  s={s}
                />
              </View>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
    );
  };

  const renderIconPriority = (
    icon: string | null,
    priority: number,
    onIcon: (ic: string | null) => void,
    onPriority: (p: number) => void,
    openPicker: MetaPicker,
    setOpenPicker: (picker: MetaPicker) => void,
  ) => (
    <>
      <Text style={[s.sheetSection, { marginTop: 16 }]}>アイコン</Text>
      <TouchableOpacity
        style={s.metaSelectBtn}
        onPress={() => { animateNext(); setOpenPicker(openPicker === 'icon' ? null : 'icon'); }}
        activeOpacity={0.8}
      >
        <View style={s.metaSelectLeft}>
          <Text style={[s.metaSelectIcon, !icon && s.metaSelectIconEmpty]}>{icon ?? ''}</Text>
          <Text style={s.metaSelectText}>{icon ? 'アイコンを変更' : 'アイコンなし'}</Text>
        </View>
        <Text style={s.metaSelectArrow}>{openPicker === 'icon' ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {openPicker === 'icon' && (
        <View style={s.iconGrid}>
          <RiseIn index={0}>
            <TouchableOpacity style={[s.iconChip, icon === null && s.iconChipActive]} onPress={() => { onIcon(null); setOpenPicker(null); }}>
              <Text style={s.iconNone}>なし</Text>
            </TouchableOpacity>
          </RiseIn>
          {TASK_ICONS.map((ic, i) => (
            <RiseIn key={ic} index={i + 1}>
              <TouchableOpacity style={[s.iconChip, icon === ic && s.iconChipActive]} onPress={() => { onIcon(ic); setOpenPicker(null); }}>
                <Text style={s.iconEmoji}>{ic}</Text>
              </TouchableOpacity>
            </RiseIn>
          ))}
        </View>
      )}

      <Text style={[s.sheetSection, { marginTop: 16 }]}>優先度</Text>
      <TouchableOpacity
        style={s.metaSelectBtn}
        onPress={() => { animateNext(); setOpenPicker(openPicker === 'priority' ? null : 'priority'); }}
        activeOpacity={0.8}
      >
        <View style={s.metaSelectLeft}>
          <View style={[s.prioritySwatch, { backgroundColor: priorityMeta(priority).cardColor, borderColor: priorityMeta(priority).borderColor }]} />
          <Text style={s.metaSelectText}>優先度：{priorityMeta(priority).label}</Text>
        </View>
        <Text style={s.metaSelectArrow}>{openPicker === 'priority' ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {openPicker === 'priority' && (
        <View style={s.typeRow}>
          {PRIORITIES.map((p, i) => (
            <RiseIn key={p.value} index={i} style={{ flex: 1 }}>
              <TouchableOpacity
                style={[s.typeChip, priority === p.value && { backgroundColor: p.color, borderColor: p.color }]}
                onPress={() => { onPriority(p.value); setOpenPicker(null); }}
              >
                <Text style={[s.typeChipText, priority === p.value && s.typeChipTextActive]}>{p.label}</Text>
              </TouchableOpacity>
            </RiseIn>
          ))}
        </View>
      )}
    </>
  );

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient colors={grad.header} start={GRAD_START} end={GRAD_END} style={[s.headerCard, { paddingTop: insets.top + 12 }]}>
        <View style={s.dateNavRow}>
          <TouchableOpacity onPress={() => shiftSelected(-1)} style={s.dateNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.dateNavArrow}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={jumpToToday} activeOpacity={0.7} style={s.dateNavCenter}>
            <Animated.Text
              style={[
                s.dateText,
                {
                  opacity: dateChangeAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
                  transform: [
                    { translateY: dateChangeAnim.interpolate({ inputRange: [0, 1], outputRange: [dateDirRef.current * 14, 0], extrapolate: 'clamp' }) },
                    { scale: dateChangeAnim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.92, 1.08, 1], extrapolate: 'clamp' }) },
                  ],
                },
              ]}
            >
              {dateLabel}
            </Animated.Text>
            {!isToday && <Text style={s.dateTodayHint}>タップで今日へ</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => shiftSelected(1)} style={s.dateNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.dateNavArrow}>›</Text>
          </TouchableOpacity>
        </View>
        <Text style={s.headerLabel}>{isToday ? '今日の進捗' : 'この日の進捗'}</Text>
        <View style={s.progressRow}>
          <View style={s.progressBg}>
            <Animated.View
              style={[s.progressFill, { width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
            >
              <LinearGradient colors={gaugeColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.progressGrad} />
            </Animated.View>
          </View>
          <Text style={s.progressText}>{done} / {total}</Text>
        </View>
      </LinearGradient>

      {/* fixed section bar with toggles */}
      <View style={s.sectionBar}>
        <Text style={s.metaLabel}>チェックリスト</Text>
        <View style={s.toggleRow}>
          <TouchableOpacity style={[s.filterToggle, activePanel === 'filter' && s.filterToggleActive]} onPress={() => setActivePanel((p) => (p === 'filter' ? null : 'filter'))}>
            <Text style={[s.filterToggleText, activePanel === 'filter' && s.filterToggleTextActive]}>絞り込み {activePanel === 'filter' ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.filterToggle, activePanel === 'sort' && s.filterToggleActive]} onPress={() => setActivePanel((p) => (p === 'sort' ? null : 'sort'))}>
            <Text style={[s.filterToggleText, activePanel === 'sort' && s.filterToggleTextActive]}>並び替え {activePanel === 'sort' ? '▲' : '▼'}</Text>
          </TouchableOpacity>
        </View>
        {total > 0 && <Text style={s.stone}>{displayedTasks.length}/{total}件</Text>}
      </View>

      <View style={s.listWrap}>
      <FlatList
        data={displayedTasks}
        keyExtractor={(item) => String(item.id)}
        style={s.list}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListEmptyComponent={
          tasksLoaded ? (
            <View style={s.empty}>
              <Text style={s.emptyTitle}>{total > 0 ? '該当なし' : 'タスクなし'}</Text>
              <Text style={s.emptyBody}>{total > 0 ? '絞り込み条件を変えてみてください' : '右下の ＋ から追加できます'}</Text>
            </View>
          ) : null
        }
        renderItem={({ item, index }) => (
          <RiseIn key={listAnimKey} index={index}>
            <TaskRow
              item={item}
              count={completionCounts.get(item.id) ?? 0}
              isDone={isTaskDone(item, completionCounts.get(item.id) ?? 0)}
              isDragging={activeDragId === item.id}
              isSwiping={swipingId === item.id}
              reorderEnabled={reorderEnabled}
              tagRight={tagRight}
              s={s}
              panHandlers={getPanResponder(item.id).panHandlers}
              shiftAnim={getShiftAnim(item.id)}
              dragY={dragY}
              dragScale={dragScale}
              swipeAnim={swipeAnim}
              onToggle={toggle}
              onLongPressCheck={longPressCheck}
              onOpenDetail={openDetail}
              onStartDrag={startDrag}
              onMeasureHeight={handleRowLayout}
            />
          </RiseIn>
        )}
        ListFooterComponent={<View style={{ height: 80 }} />}
      />

      {/* Slide-down filter / sort overlay (overlaps the list) */}
      <Animated.View
        pointerEvents={activePanel ? 'auto' : 'none'}
        style={[s.panelOverlay, {
          opacity: panelAnim,
          transform: [{ translateY: panelAnim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }],
        }]}
      >
        {lastPanelRef.current === 'filter' ? (
          <View style={s.filterPanel}>
            <Text style={s.filterLabel}>状態</Text>
            <View style={s.filterRow}>
              {STATUS_OPTS.map((o) => (
                <TouchableOpacity key={o.k} style={[s.fChip, filterStatus === o.k && s.fChipActive]} onPress={() => setFilterStatus(o.k)}>
                  <Text style={[s.fChipText, filterStatus === o.k && s.fChipTextActive]}>{o.l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.filterLabel}>頻度</Text>
            <View style={s.filterRow}>
              {FREQ_OPTS.map((o) => (
                <TouchableOpacity key={o.k} style={[s.fChip, filterFreq === o.k && s.fChipActive]} onPress={() => setFilterFreq(o.k)}>
                  <Text style={[s.fChipText, filterFreq === o.k && s.fChipTextActive]}>{o.l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.filterLabel}>対象</Text>
            <View style={s.filterRow}>
              {DUE_OPTS.map((o) => (
                <TouchableOpacity key={o.k} style={[s.fChip, filterDue === o.k && s.fChipActive]} onPress={() => setFilterDue(o.k)}>
                  <Text style={[s.fChipText, filterDue === o.k && s.fChipTextActive]}>{o.l}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <View style={s.filterPanel}>
            <Text style={s.filterLabel}>並べ替え</Text>
            <View style={s.filterRow}>
              {SORT_OPTS.map((o) => (
                <TouchableOpacity key={o.k} style={[s.fChip, sortKey === o.k && s.fChipActive]} onPress={() => setSortKey(o.k)}>
                  <Text style={[s.fChipText, sortKey === o.k && s.fChipTextActive]}>{o.l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {!reorderEnabled && <Text style={s.filterHint}>※ この表示中はドラッグでの並び替えはできません（「手動」かつ絞り込み「すべて」で可能）</Text>}
          </View>
        )}
      </Animated.View>
      </View>

      <TabBar current="Home" navigation={navigation} />

      <Animated.View style={[s.fabWrap, fabAnim.getLayout()]} {...fabPanResponder.panHandlers}>
        <TouchableOpacity onPress={() => setShowAdd(true)} activeOpacity={0.85}>
          <LinearGradient colors={grad.brand} start={GRAD_START} end={GRAD_END} style={s.fab}>
            <Text style={s.fabText}>＋</Text>
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>

      {showThumb && (
        <View style={s.thumbOverlay} pointerEvents="none">
          {/* ソフトな光のブルーム */}
          <Animated.View style={{
            position: 'absolute',
            width: 240,
            height: 240,
            borderRadius: 120,
            backgroundColor: '#ffffff',
            opacity: bloomAnim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.14, 0] }),
            transform: [{ scale: bloomAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 2.6] }) }],
          }} />
          {/* 👍 + 達成しました */}
          <Animated.View style={{
            alignItems: 'center',
            gap: 8,
            opacity: thumbOpacity,
          }}>
            <Animated.Text style={[
              s.thumbEmoji,
              {
                transform: [
                  {
                    translateY: thumbAnim.interpolate({
                      inputRange: [0, 0.14, 0.28, 0.44, 0.6, 0.78, 1],
                      outputRange: [18, -16, 4, -12, 3, -6, 0],
                    }),
                  },
                  {
                    rotate: thumbAnim.interpolate({
                      inputRange: [0, 0.14, 0.28, 0.44, 0.6, 0.78, 1],
                      outputRange: ['0deg', '-8deg', '5deg', '7deg', '-4deg', '3deg', '0deg'],
                    }),
                  },
                  {
                    scale: thumbAnim.interpolate({
                      inputRange: [0, 0.14, 0.28, 0.44, 0.6, 0.78, 1],
                      outputRange: [0.7, 1.18, 0.96, 1.12, 0.98, 1.06, 1],
                    }),
                  },
                ],
              },
            ]}>👍</Animated.Text>
            <Text style={[
              s.celebrateText,
              dark
                ? { color: '#ffffff', textShadowColor: 'rgba(0,0,0,0.85)' }
                : { color: '#1f2937', textShadowColor: 'rgba(255,255,255,0.9)' },
            ]}>達成しました！</Text>
          </Animated.View>
        </View>
      )}

      {/* Add task bottom sheet */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={closeAddSheet}>
        <View style={{ flex: 1 }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeAddSheet} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[s.sheet, { maxHeight: screen.height * 0.85 }]}>
                <View style={s.sheetHandle} />
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>

                  {/* Task name (top) */}
                  <Text style={s.sheetSection}>タスク名</Text>
                  <View style={s.sheetTitleRow}>
                    <TextInput
                      style={s.sheetTitleInput}
                      value={newTitle}
                      onChangeText={setNewTitle}
                      placeholder="例：歯磨き、運動、水を飲む"
                      placeholderTextColor="#9ca3af"
                      returnKeyType="done"
                      onSubmitEditing={handleAdd}
                    />
                    <TouchableOpacity onPress={handleAdd} disabled={!newTitle.trim()} activeOpacity={0.85}>
                      <LinearGradient
                        colors={!newTitle.trim() ? [C.border, C.border] : grad.brand}
                        start={GRAD_START} end={GRAD_END} style={s.sheetSaveBtn}
                      >
                        <Text style={s.sheetSaveBtnText}>追加</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                  <TextInput
                    style={s.noteInput}
                    value={newNote}
                    onChangeText={setNewNote}
                    placeholder="メモ（任意）"
                    placeholderTextColor="#9ca3af"
                    returnKeyType="done"
                  />

                  {renderIconPriority(newIcon, newPriority, setNewIcon, setNewPriority, addPicker, setAddPicker)}

                  {renderFrequency(newFreqType, newDays, newFreqWeeks, newFreqWeekdays, newDay, newFreqInterval, {
                    setType: (t: FreqType) => {
                      setNewFreqType(t);
                      if (t === 'weekly' && newDays.length === 0) setNewDays([new Date().getDay()]);
                    },
                    toggleDay: (d: number) => setNewDays((ds) => ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]),
                    toggleWeek: (w: number) => setNewFreqWeeks((ws) => ws.includes(w) ? ws.filter((x) => x !== w) : [...ws, w]),
                    toggleWeekday: (d: number) => setNewFreqWeekdays((ds) => ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]),
                    setDay: setNewDay,
                    setOnceDate: setNewOnceDate,
                    toggleDate: (ds: string) => setNewFreqDates((cur) => cur.includes(ds) ? cur.filter((x) => x !== ds) : [...cur, ds]),
                    setInterval: setNewFreqInterval,
                  }, addPicker, setAddPicker, newOnceDate, newFreqDates.slice().sort().join(','),
                  newIntervalPickerOpen, setNewIntervalPickerOpen)}

                  {/* Notification time + notify (second) */}
                  <Text style={[s.sheetSection, { marginTop: 16 }]}>通知</Text>
                  {renderSchedule(
                    newTime,
                    newNotify,
                    () => openTimeEditor('add', newTime),
                    toggleNewNotify,
                    newNotifyType,
                    setNewNotifyType,
                  )}

                  {/* Auto timer/stopwatch: fires a notification at the set time; tapping it starts the measurement */}
                  <Text style={[s.sheetSection, { marginTop: 16 }]}>自動計測</Text>
                  {renderAutoTimer(
                    newAutoTimerEnabled,
                    newAutoTimerTime,
                    newAutoTimerMode,
                    (v) => (v ? requirePremium(() => setNewAutoTimerEnabled(true)) : setNewAutoTimerEnabled(false)),
                    () => openTimeEditor('autoTimerAdd', newAutoTimerTime),
                    () => setNewAutoTimerTime(null),
                    (mode) => {
                      if (mode === 'timer') {
                        Alert.alert('タイマー未設定', '自動計測でタイマーを使用するためには、計測タブに移動してタイマーの時間を設定してください。');
                        return;
                      }
                      setNewAutoTimerMode(mode);
                    },
                  )}

                  <Text style={[s.sheetSection, { marginTop: 16 }]}>複数回</Text>
                  {renderRepeat(
                    newRepeatEnabled, newRepeatTarget,
                    (v) => (v ? requirePremium(() => setNewRepeatEnabled(true)) : setNewRepeatEnabled(false)),
                    setNewRepeatTarget,
                  )}

                  <View style={{ height: 12 }} />
                </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Task detail — full-screen editor */}
      <Modal visible={!!detailTask} animationType="slide" onRequestClose={() => setDetailTask(null)}>
        <View style={[s.detailScreen, { paddingTop: insets.top }]}>
          <View style={s.detailHeader}>
            <TouchableOpacity onPress={() => setDetailTask(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.detailCloseText}>✕</Text>
            </TouchableOpacity>
            <Text style={s.detailHeaderTitle}>タスクを編集</Text>
            <TouchableOpacity onPress={handleDetailSave} activeOpacity={0.85}>
              <LinearGradient colors={grad.brand} start={GRAD_START} end={GRAD_END} style={s.sheetSaveBtn}>
                <Text style={s.sheetSaveBtnText}>保存</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 16 }}>
                  {detailTask && (
                    <>
                      {/* Task name (top) */}
                      <Text style={s.sheetSection}>タスク名</Text>
                      <TextInput
                        style={s.sheetTitleInput}
                        value={detailTitle}
                        onChangeText={setDetailTitle}
                        returnKeyType="done"
                        onSubmitEditing={handleSaveTitle}
                      />
                      <TextInput
                        style={s.noteInput}
                        value={detailTask.note ?? ''}
                        onChangeText={(text) => setDetailTask(t => t ? { ...t, note: text } : null)}
                        onEndEditing={(e) => patchDetail({ note: e.nativeEvent.text.trim() || null })}
                        placeholder="メモ（任意）"
                        placeholderTextColor="#9ca3af"
                        returnKeyType="done"
                      />

                      {renderIconPriority(
                        detailTask.icon,
                        detailTask.priority,
                        (ic) => patchDetail({ icon: ic }),
                        (p) => patchDetail({ priority: p }),
                        detailPicker,
                        setDetailPicker,
                      )}

                      {renderFrequency(
                        detailTask.freq_type,
                        parseDays(detailTask.freq_days),
                        monthlyNthWeeks(detailTask),
                        monthlyNthWeekdays(detailTask),
                        detailTask.freq_day ?? 1,
                        detailTask.freq_interval ?? 2,
                        {
                          setType: (t: FreqType) => {
                            const patch: TaskFields = { freq_type: t };
                            if (t === 'weekly') patch.freq_days = daysToCsv(parseDays(detailTask.freq_days).length ? parseDays(detailTask.freq_days) : [new Date().getDay()]);
                            if (t === 'monthly_nth') {
                              patch.freq_weeks = daysToCsv(monthlyNthWeeks(detailTask));
                              patch.freq_days = daysToCsv(monthlyNthWeekdays(detailTask));
                            }
                            if (t === 'monthly_day') patch.freq_day = detailTask.freq_day ?? 1;
                            if (t === 'every_n_days') {
                              patch.once_date = detailTask.once_date ?? today;
                              patch.freq_interval = detailTask.freq_interval ?? 2;
                            }
                            if (t === 'once') patch.once_date = detailTask.once_date ?? today;
                            if (t === 'dates') patch.freq_dates = detailTask.freq_dates ?? '';
                            patchDetail(patch);
                          },
                          toggleDay: (d: number) => {
                            const cur = parseDays(detailTask.freq_days);
                            const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
                            patchDetail({ freq_days: daysToCsv(next) });
                          },
                          toggleWeek: (w: number) => {
                            const cur = monthlyNthWeeks(detailTask);
                            const next = cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w];
                            patchDetail({ freq_weeks: daysToCsv(next) });
                          },
                          toggleWeekday: (d: number) => {
                            const cur = monthlyNthWeekdays(detailTask);
                            const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
                            patchDetail({ freq_days: daysToCsv(next) });
                          },
                          setDay: (d: number) => patchDetail({ freq_day: d }),
                          setOnceDate: (d: string) => patchDetail({ once_date: d }),
                          toggleDate: (ds: string) => {
                            const cur = parseDateList(detailTask.freq_dates);
                            const next = cur.includes(ds) ? cur.filter((x) => x !== ds) : [...cur, ds];
                            patchDetail({ freq_dates: next.sort().join(',') });
                          },
                          setInterval: (n: number) => patchDetail({ freq_interval: n }),
                        },
                        detailPicker,
                        setDetailPicker,
                        detailTask.once_date,
                        detailTask.freq_dates,
                        detailIntervalPickerOpen,
                        setDetailIntervalPickerOpen,
                      )}

                      {/* Notification time + notify (second) */}
                      <Text style={[s.sheetSection, { marginTop: 16 }]}>通知</Text>
                      {renderSchedule(
                        detailTask.scheduled_time,
                        !!detailTask.notify,
                        () => openTimeEditor('edit', detailTask.scheduled_time),
                        toggleDetailNotify,
                        (detailTask.notify_type === 'alarm' ? 'alarm' : 'push'),
                        (t) => patchDetail({ notify_type: t }),
                      )}

                      {/* Auto timer/stopwatch: fires a notification at the set time; tapping it starts the measurement */}
                      <Text style={[s.sheetSection, { marginTop: 16 }]}>自動計測</Text>
                      {renderAutoTimer(
                        !!detailTask.auto_timer_enabled,
                        detailTask.auto_timer_time,
                        detailTask.auto_timer_mode,
                        async (v) => {
                          if (!v) {
                            await patchDetail({ auto_timer_enabled: 0 });
                            return;
                          }
                          requirePremium(async () => {
                            if (detailTask.auto_timer_mode === 'timer') {
                              const minutes = await getTimerPresetMinutes(detailTask.id);
                              if (minutes == null) return;
                              await patchDetail({ auto_timer_enabled: 1, auto_timer_minutes: minutes });
                              return;
                            }
                            await patchDetail({ auto_timer_enabled: 1 });
                          });
                        },
                        () => openTimeEditor('autoTimerEdit', detailTask.auto_timer_time),
                        () => patchDetail({ auto_timer_time: null }),
                        async (mode) => {
                          if (mode === 'timer') {
                            const minutes = await getTimerPresetMinutes(detailTask.id);
                            if (minutes == null) return;
                            await patchDetail({ auto_timer_mode: mode, auto_timer_minutes: minutes });
                            return;
                          }
                          await patchDetail({ auto_timer_mode: mode });
                        },
                      )}

                      <Text style={[s.sheetSection, { marginTop: 16 }]}>複数回</Text>
                      {renderRepeat(
                        !!detailTask.repeat_enabled,
                        detailTask.repeat_target,
                        (v) => (v
                          ? requirePremium(() => patchDetail({
                              repeat_enabled: 1,
                              ...(detailTask.repeat_target < 2 ? { repeat_target: 2 } : {}),
                            }))
                          : patchDetail({ repeat_enabled: 0 })),
                        (n) => patchDetail({ repeat_target: n }),
                      )}

                      <TouchableOpacity style={s.detailDeleteBtn} onPress={() => handleDelete(detailTask)}>
                        <Text style={s.detailDeleteText}>🗑 このタスクを削除</Text>
                      </TouchableOpacity>

                      <View style={{ height: 12 }} />
                    </>
                  )}
                </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Shared time editor (numeric) */}
      <Modal visible={!!timePickerFor} transparent animationType="fade" onRequestClose={() => setTimePickerFor(null)}>
        <View style={s.timeModalBg}>
          <View style={s.timeModalCard}>
            <Text style={s.timeModalTitle}>時間を入力</Text>
            <View style={s.timeInputRow}>
              <TextInput
                style={s.timeInput}
                value={hourInput}
                onChangeText={setHourInput}
                keyboardType="number-pad"
                maxLength={2}
                selectTextOnFocus
                placeholder="8"
                placeholderTextColor="#9ca3af"
              />
              <Text style={s.timeColon}>:</Text>
              <TextInput
                style={s.timeInput}
                value={minuteInput}
                onChangeText={setMinuteInput}
                keyboardType="number-pad"
                maxLength={2}
                selectTextOnFocus
                placeholder="00"
                placeholderTextColor="#9ca3af"
              />
            </View>
            <Text style={s.timeHint}>24時間制（時 0〜23 ／ 分 0〜59）</Text>
            <View style={s.timeBtnRow}>
              <TouchableOpacity style={s.timeCancelBtn} onPress={() => setTimePickerFor(null)}>
                <Text style={s.timeCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.timeConfirmBtnWrap} onPress={confirmTime} activeOpacity={0.85}>
                <LinearGradient colors={grad.brand} start={GRAD_START} end={GRAD_END} style={s.timeConfirmBtn}>
                  <Text style={s.timeConfirmText}>決定</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showNotifyGuide} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={s.timeModalBg}>
          <View style={[s.timeModalCard, { gap: 14 }]}>
            <Text style={s.timeModalTitle}>通知をオンにしてください</Text>
            <Text style={s.emptyBody}>通知がオフだと、予定時刻の通知や自動計測の開始通知が届きません。</Text>
            <View style={s.timeBtnRow}>
              <TouchableOpacity style={s.timeCancelBtn} onPress={handleNotifyGuideLater}>
                <Text style={s.timeCancelText}>あとで</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.timeConfirmBtnWrap} onPress={handleNotifyGuideEnable} activeOpacity={0.85}>
                <LinearGradient colors={grad.brand} start={GRAD_START} end={GRAD_END} style={s.timeConfirmBtn}>
                  <Text style={s.timeConfirmText}>通知をオンにする</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showBatteryGuide} transparent animationType="fade" onRequestClose={closeBatteryGuide}>
        <View style={s.timeModalBg}>
          <View style={[s.timeModalCard, { width: Math.min(screen.width - 24, 430), maxHeight: screen.height * 0.84, gap: 14 }]}>
            <Text style={s.timeModalTitle}>バッテリーセーバーを確認してください</Text>
            <Text style={s.emptyBody}>バッテリーセーバーがオンだと、通知が来ないことがあります。</Text>
            <Image
              source={require('../../assets/images/onboarding/guide_battery.jpg')}
              style={{ width: '100%', height: Math.min(360, screen.height * 0.42), borderRadius: 14, resizeMode: 'contain', backgroundColor: '#ffffff' }}
            />
            <View style={s.timeBtnRow}>
              <TouchableOpacity style={s.timeCancelBtn} onPress={closeBatteryGuide}>
                <Text style={s.timeCancelText}>あとで</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.timeConfirmBtnWrap} onPress={openBatterySaverSettings} activeOpacity={0.85}>
                <LinearGradient colors={grad.brand} start={GRAD_START} end={GRAD_END} style={s.timeConfirmBtn}>
                  <Text style={s.timeConfirmText}>設定を開く</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
