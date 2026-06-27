import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Modal,
  TextInput, StyleSheet, Alert, KeyboardAvoidingView,
  Platform, StatusBar, Animated, ScrollView, PanResponder, Dimensions, Switch,
  LayoutAnimation, UIManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import * as Notifications from 'expo-notifications';
import { RootStackParamList } from '../../App';
import {
  Task, TaskFields, getToday, getTasks, addTask, updateTask, deleteTask,
  getCompletedTaskIds, markComplete, markIncomplete, updateTaskSortOrders,
  getSetting,
} from '../db/database';
import {
  TASK_ICONS, PRIORITIES, priorityMeta, WEEKDAYS,
  FreqType, TaskFreq, FREQ_TYPES, NTH_WEEKS, frequencyLabel, parseDays, parseDateList, nextNthWeekdayDate, isDueToday,
} from '../constants/taskMeta';
import { GRAD, GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';
import { useTheme, ColorSet } from '../contexts/ThemeContext';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Home'> };

const pad = (n: number) => String(n).padStart(2, '0');
const daysToCsv = (days: number[]) => days.slice().sort((a, b) => a - b).join(',');
const DRAG_ROW_HEIGHT = 88;

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
      const when = nextNthWeekdayDate(task.freq_week ?? 1, task.freq_weekday ?? 0, h, m);
      ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { date: when } as any }));
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
  progressBg: { flex: 1, height: 8, backgroundColor: 'rgba(255,255,255,0.45)', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2, overflow: 'hidden' },
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
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  taskBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  taskTextWrap: { flex: 1, gap: 4 },
  taskTitle: { color: C.onDark, fontSize: 14, fontWeight: '500', lineHeight: 20 },
  taskTitleDone: { color: C.muted, textDecorationLine: 'line-through' },
  taskMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
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
  sheetDeleteBtn: { position: 'absolute', top: 10, right: 14, backgroundColor: '#fee2e2', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, zIndex: 10 },
  sheetDeleteText: { color: '#dc2626', fontSize: 12, fontWeight: '800' },
  sheetSection: { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  sheetTitleRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  sheetTitleInput: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 15, color: C.onDark, backgroundColor: C.body },
  noteInput: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, color: C.onDark, backgroundColor: C.body },
  sheetSaveBtn: { backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  sheetSaveBtnDisabled: { backgroundColor: C.border },
  sheetSaveBtnText: { color: C.onPrimary, fontSize: 13, fontWeight: '700' },

  // Schedule (time + notify)
  scheduleCard: { backgroundColor: C.scheduleCardBg, borderRadius: 14, padding: 14, gap: 8 },
  scheduleToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
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
  thumbEmoji: { fontSize: 80 },
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
  const base = isOnce && onceDate ? new Date(`${onceDate}T00:00:00`) : new Date();
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

export default function HomeScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const screen = Dimensions.get('window');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tagRight, setTagRight] = useState(false);
  const tasksRef = useRef<Task[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());
  const [showThumb, setShowThumb] = useState(false);
  const thumbAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const fabPosition = useRef({ x: Math.max(screen.width - 72, 20), y: Math.max(screen.height - insets.bottom - 132, 120) });
  const fabStartPosition = useRef(fabPosition.current);
  const fabAnim = useRef(new Animated.ValueXY(fabPosition.current)).current;
  const [activeDragId, setActiveDragId] = useState<number | null>(null);
  const dragState = useRef({ taskId: null as number | null, startIndex: 0, currentIndex: 0, changed: false });
  const dragY = useRef(new Animated.Value(0)).current;
  const dragScale = useRef(new Animated.Value(1)).current;
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
  const shiftSelected = (days: number) => {
    const d = new Date(`${selectedDate}T00:00:00`);
    d.setDate(d.getDate() + days);
    setSelectedDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  };
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
  const [newWeek, setNewWeek] = useState(1);
  const [newWeekday, setNewWeekday] = useState(1);
  const [newDay, setNewDay] = useState(1);
  const [newOnceDate, setNewOnceDate] = useState<string>(today);
  const [newFreqDates, setNewFreqDates] = useState<string[]>([]);
  const [newNote, setNewNote] = useState('');

  // Task detail sheet
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [detailTitle, setDetailTitle] = useState('');
  const [detailPicker, setDetailPicker] = useState<MetaPicker>(null);

  // Shared time editor (numeric input)
  const [timePickerFor, setTimePickerFor] = useState<'add' | 'edit' | null>(null);
  const [hourInput, setHourInput] = useState('8');
  const [minuteInput, setMinuteInput] = useState('00');

  const load = useCallback(async () => {
    const [ts, ids, layout] = await Promise.all([
      getTasks(db),
      getCompletedTaskIds(db, selectedDate),
      getSetting(db, 'card_layout'),
    ]);
    setTasks(ts);
    setCompletedIds(new Set(ids));
    setTagRight(layout === 'tag_right');
  }, [db, selectedDate]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      UIManager.setLayoutAnimationEnabledExperimental?.(true);
    }
  }, []);

  // Keep monthly-nth reminders (which can't natively repeat) armed for the next occurrence.
  useFocusEffect(useCallback(() => {
    (async () => {
      const ts = await getTasks(db);
      for (const t of ts) {
        if (t.notify && t.scheduled_time && t.freq_type === 'monthly_nth') {
          const notify_id = await rescheduleTask(t);
          await updateTask(db, t.id, { notify_id });
        }
      }
    })();
  }, [db]));

  const triggerCelebration = () => {
    setShowThumb(true);
    thumbAnim.setValue(0);
    Animated.sequence([
      Animated.spring(thumbAnim, { toValue: 1, useNativeDriver: true, tension: 180, friction: 6 }),
      Animated.delay(500),
      Animated.timing(thumbAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => setShowThumb(false));
  };

  const toggle = async (id: number) => {
    if (completedIds.has(id)) {
      await markIncomplete(db, id, selectedDate);
    } else {
      await markComplete(db, id, selectedDate);
      triggerCelebration();
    }
    load();
  };

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
    setNewWeek(1);
    setNewWeekday(1);
    setNewDay(1);
    setNewOnceDate(today);
    setNewFreqDates([]);
    setNewNote('');
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
      freq_days: newFreqType === 'weekly' ? daysToCsv(newDays) : null,
      freq_week: newFreqType === 'monthly_nth' ? newWeek : null,
      freq_weekday: newFreqType === 'monthly_nth' ? newWeekday : null,
      freq_day: newFreqType === 'monthly_day' ? newDay : null,
      once_date: newFreqType === 'once' ? newOnceDate : null,
      freq_dates: newFreqType === 'dates' ? newFreqDates.slice().sort().join(',') : null,
      note: newNote.trim() || null,
    };
    await updateTask(db, taskId, fields);
    if (newNotify && newTime) {
      const notify_id = await rescheduleTask({
        title, icon: newIcon, scheduled_time: newTime, notify: 1, notify_id: null, notify_type: newNotifyType,
        freq_type: fields.freq_type!, freq_days: fields.freq_days ?? null,
        freq_week: fields.freq_week ?? null, freq_weekday: fields.freq_weekday ?? null, freq_day: fields.freq_day ?? null,
        once_date: fields.once_date ?? null, freq_dates: fields.freq_dates ?? null,
      });
      await updateTask(db, taskId, { notify_id });
    }
    resetAddDraft();
    setShowAdd(false);
    load();
  };

  const closeAddSheet = () => {
    setShowAdd(false);
    resetAddDraft();
    setTimePickerFor(null);
  };

  const openDetail = (task: Task) => {
    setDetailTask(task);
    setDetailTitle(task.title);
    setDetailPicker(null);
  };

  const handleSaveTitle = async () => {
    if (!detailTask || !detailTitle.trim()) return;
    await updateTask(db, detailTask.id, { title: detailTitle.trim() });
    setDetailTask(t => t ? { ...t, title: detailTitle.trim() } : null);
    load();
  };

  // Persist a change to the open task; reschedule reminders when relevant.
  const patchDetail = async (patch: TaskFields) => {
    if (!detailTask) return;
    const merged = { ...detailTask, ...patch } as Task;
    await updateTask(db, detailTask.id, patch);
    const scheduleKeys: (keyof TaskFields)[] = ['scheduled_time', 'notify', 'notify_type', 'freq_type', 'freq_days', 'freq_week', 'freq_weekday', 'freq_day', 'once_date'];
    let next = merged;
    if (scheduleKeys.some(k => k in patch)) {
      const notify_id = await rescheduleTask(merged);
      await updateTask(db, detailTask.id, { notify_id });
      next = { ...merged, notify_id };
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

  const openTimeEditor = (target: 'add' | 'edit', current: string | null) => {
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
  };

  const toggleNewNotify = async (value: boolean) => {
    if (value && !(await ensurePermission())) return;
    setNewNotify(value);
  };

  const toggleDetailNotify = async (value: boolean) => {
    if (value && !(await ensurePermission())) return;
    await patchDetail({ notify: value ? 1 : 0 });
  };

  const done = tasks.filter((t) => completedIds.has(t.id)).length;
  const total = tasks.length;
  const progress = total > 0 ? done / total : 0;
  // Gauge gradient color by completion ratio.
  const gaugeColors = (
    progress >= 1 ? ['#34d399', '#059669'] :
    progress >= 0.67 ? ['#4ade80', '#16a34a'] :
    progress >= 0.34 ? ['#facc15', '#f59e0b'] :
    ['#fb7185', '#e11d48']
  ) as readonly [string, string];
  const sortedTasks = [...tasks].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id - b.id;
  });

  // Drag reorder only makes sense in unfiltered manual order.
  const reorderEnabled = sortKey === 'manual' && filterStatus === 'all' && filterFreq === 'all' && filterDue === 'all';
  const displayedTasks = (() => {
    // Hide one-time tasks whose day has already passed.
    let list = sortedTasks.filter((t) => {
      if (t.freq_type === 'once' && t.once_date && t.once_date < selectedDate) return false;
      if (t.freq_type === 'dates') {
        const ds = parseDateList(t.freq_dates);
        if (ds.length > 0 && ds.every((d) => d < selectedDate)) return false;
      }
      return true;
    });
    if (filterStatus === 'incomplete') list = list.filter((t) => !completedIds.has(t.id));
    else if (filterStatus === 'done') list = list.filter((t) => completedIds.has(t.id));
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
  })();

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
      dragState.current.changed = true;
      return ordered.map((task, index) => ({ ...task, sort_order: index }));
    });
  };

  const startDrag = (taskId: number, index: number) => {
    swipeState.current.taskId = null;
    setSwipingId(null);
    swipeAnim.setValue(0);
    setActiveDragId(taskId);
    dragState.current = { taskId, startIndex: index, currentIndex: index, changed: false };
    dragY.setValue(0);
    Animated.spring(dragScale, {
      toValue: 1.04,
      useNativeDriver: true,
      tension: 220,
      friction: 14,
    }).start();
  };

  const updateDrag = (dy: number) => {
    const { taskId, startIndex, currentIndex } = dragState.current;
    if (taskId == null) return;
    const nextIndex = Math.max(0, Math.min(startIndex + Math.round(dy / DRAG_ROW_HEIGHT), tasksRef.current.length - 1));
    const visualDy = dy - (nextIndex - startIndex) * DRAG_ROW_HEIGHT;
    dragY.setValue(Math.max(-DRAG_ROW_HEIGHT * 0.9, Math.min(DRAG_ROW_HEIGHT * 0.9, visualDy)));
    if (nextIndex !== currentIndex) {
      moveTask(taskId, nextIndex);
      dragState.current.currentIndex = nextIndex;
    }
  };

  const endDrag = () => {
    if (dragState.current.changed) persistTaskOrder();
    dragState.current = { taskId: null, startIndex: 0, currentIndex: 0, changed: false };
    setActiveDragId(null);
    Animated.parallel([
      Animated.spring(dragY, { toValue: 0, useNativeDriver: true, tension: 220, friction: 14 }),
      Animated.spring(dragScale, { toValue: 1, useNativeDriver: true, tension: 220, friction: 14 }),
    ]).start();
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
    onClear: () => void,
    onToggleNotify: (v: boolean) => void,
    notifyType: 'push' | 'alarm',
    onSetNotifyType: (t: 'push' | 'alarm') => void,
  ) => (
    <View style={s.scheduleCard}>
      <TouchableOpacity style={s.metaSelectBtn} onPress={onPick} activeOpacity={0.8}>
        <View style={s.metaSelectLeft}>
          <Text style={s.metaSelectText}>通知の時間：{time ?? '未設定'}</Text>
        </View>
        <Text style={s.metaSelectArrow}>›</Text>
      </TouchableOpacity>
      <View style={s.scheduleToggleRow}>
        <Text style={s.scheduleLabel}>通知する</Text>
        <Switch
          value={notify}
          onValueChange={onToggleNotify}
          trackColor={{ true: C.primary, false: C.border }}
          thumbColor="#ffffff"
        />
      </View>
      {time && (
        <TouchableOpacity onPress={onClear} style={s.clearTimeBtn}>
          <Text style={s.clearTimeText}>時間をクリア</Text>
        </TouchableOpacity>
      )}
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

  const renderFrequency = (
    freqType: FreqType,
    days: number[],
    week: number,
    weekday: number,
    day: number,
    on: {
      setType: (t: FreqType) => void;
      toggleDay: (d: number) => void;
      setWeek: (w: number) => void;
      setWeekday: (d: number) => void;
      setDay: (d: number) => void;
      setOnceDate: (d: string) => void;
      toggleDate: (ds: string) => void;
    },
    openPicker: MetaPicker,
    setOpenPicker: (picker: MetaPicker) => void,
    onceDate: string | null,
    freqDates: string | null,
  ) => {
    const freqText = frequencyLabel({ freq_type: freqType, freq_days: daysToCsv(days), freq_week: week, freq_weekday: weekday, freq_day: day, once_date: onceDate, freq_dates: freqDates });
    const onSelectDate = (ref: Date, ds: string) => {
      if (freqType === 'dates') {
        on.toggleDate(ds);
      } else if (freqType === 'once') {
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
                      {NTH_WEEKS.map((w) => (
                        <PulseChip
                          key={w.value}
                          wrapStyle={{ flex: 1 }}
                          style={[s.weekChip, week === w.value && s.weekChipActive]}
                          onPress={() => on.setWeek(w.value)}
                        >
                          <Text style={[s.weekChipText, week === w.value && s.weekChipTextActive]}>{w.label}</Text>
                        </PulseChip>
                      ))}
                    </View>
                    <View style={s.weekdayRow}>
                      {WEEKDAYS.map((w, i) => {
                        const active = weekday === i;
                        return (
                          <PulseChip
                            key={w}
                            wrapStyle={{ flex: 1 }}
                            style={[s.dayChip, active && s.dayChipActive, i === 0 && s.daySun, i === 6 && s.daySat]}
                            onPress={() => on.setWeekday(i)}
                          >
                            <Text style={[s.dayChipText, active && s.dayChipTextActive]}>{w}</Text>
                          </PulseChip>
                        );
                      })}
                    </View>
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

                {(freqType === 'once' || freqType === 'dates') && (
                  <Text style={s.calHint}>{freqType === 'dates' ? 'カレンダーをタップして任意の日を選択（複数可）' : 'カレンダーをタップして日付を選択'}</Text>
                )}
                <FreqCalendar
                  freq={{ freq_type: freqType, freq_days: daysToCsv(days), freq_week: week, freq_weekday: weekday, freq_day: day, once_date: onceDate, freq_dates: freqDates }}
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
          <Text style={[s.metaSelectIcon, !icon && s.metaSelectIconEmpty]}>{icon ?? '🏷'}</Text>
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

      <LinearGradient colors={GRAD.header} start={GRAD_START} end={GRAD_END} style={[s.headerCard, { paddingTop: insets.top + 12 }]}>
        <View style={s.dateNavRow}>
          <TouchableOpacity onPress={() => shiftSelected(-1)} style={s.dateNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.dateNavArrow}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSelectedDate(today)} activeOpacity={0.7} style={s.dateNavCenter}>
            <Text style={s.dateText}>{dateLabel}</Text>
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
          <View style={s.empty}>
            <Text style={s.emptyTitle}>{total > 0 ? '該当なし' : 'タスクなし'}</Text>
            <Text style={s.emptyBody}>{total > 0 ? '絞り込み条件を変えてみてください' : '右下の ＋ から追加できます'}</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const isDone = completedIds.has(item.id);
          const panResponder = getPanResponder(item.id);
          const isDragging = activeDragId === item.id;
          const swipeStyle = swipingId === item.id
            ? {
                transform: [
                  { translateX: swipeAnim },
                  {
                    rotate: swipeAnim.interpolate({
                      inputRange: [-220, 0, 220],
                      outputRange: ['-5deg', '0deg', '5deg'],
                      extrapolate: 'clamp',
                    }),
                  },
                  {
                    scale: swipeAnim.interpolate({
                      inputRange: [-220, 0, 220],
                      outputRange: [0.96, 1, 0.96],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
              }
            : null;
          const swipeBgStyle = swipingId === item.id
            ? {
                opacity: swipeAnim.interpolate({
                  inputRange: [-SWIPE_DELETE_THRESHOLD, 0, SWIPE_DELETE_THRESHOLD],
                  outputRange: [1, 0, 1],
                  extrapolate: 'clamp',
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
          const priority = priorityMeta(item.priority);
          return (
            <View style={s.swipeWrap}>
              <Animated.View style={[s.swipeDeleteBg, swipeBgStyle]}>
                <Text style={s.swipeDeleteText}>削除</Text>
              </Animated.View>
              <Animated.View
                style={[
                  s.taskCard,
                  { backgroundColor: priority.cardColor, borderColor: priority.borderColor },
                  isDone && s.taskCardDone,
                  swipeStyle,
                  dragStyle,
                ]}
                {...panResponder.panHandlers}
              >
              {(() => {
                const tagEl = (
                  <TouchableOpacity style={s.tagBtn} onPress={() => openDetail(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={[s.tagIcon, !item.icon && s.tagIconEmpty]}>{item.icon ?? '🏷'}</Text>
                  </TouchableOpacity>
                );
                const checkEl = (
                  <TouchableOpacity
                    style={[s.checkBox, isDone && s.checkBoxDone]}
                    onPress={() => toggle(item.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  >
                    {isDone && <Text style={s.checkMark}>✓</Text>}
                  </TouchableOpacity>
                );
                return (
                  <>
                    {tagRight ? checkEl : tagEl}
                    <TouchableOpacity
                      style={s.taskBody}
                      onPress={() => openDetail(item)}
                      onLongPress={reorderEnabled ? () => startDrag(item.id, index) : undefined}
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
                      {isDone && <View style={s.doneBadge}><Text style={s.doneBadgeText}>完了</Text></View>}
                    </TouchableOpacity>
                    {tagRight ? tagEl : checkEl}
                  </>
                );
              })()}
              </Animated.View>
            </View>
          );
        }}
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
          <LinearGradient colors={GRAD.brand} start={GRAD_START} end={GRAD_END} style={s.fab}>
            <Text style={s.fabText}>＋</Text>
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>

      {showThumb && (
        <Animated.View style={[s.thumbOverlay, {
          opacity: thumbAnim,
          transform: [{ scale: thumbAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
        }]} pointerEvents="none">
          <Text style={s.thumbEmoji}>👍</Text>
        </Animated.View>
      )}

      {/* Add task bottom sheet */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={closeAddSheet}>
        <TouchableOpacity style={s.sheetBg} activeOpacity={1} onPress={closeAddSheet}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}}>
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
                        colors={!newTitle.trim() ? [C.border, C.border] : GRAD.brand}
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

                  {/* Notification time + notify (second) */}
                  <Text style={[s.sheetSection, { marginTop: 16 }]}>通知</Text>
                  {renderSchedule(
                    newTime,
                    newNotify,
                    () => openTimeEditor('add', newTime),
                    () => setNewTime(null),
                    toggleNewNotify,
                    newNotifyType,
                    setNewNotifyType,
                  )}

                  {renderIconPriority(newIcon, newPriority, setNewIcon, setNewPriority, addPicker, setAddPicker)}

                  {renderFrequency(newFreqType, newDays, newWeek, newWeekday, newDay, {
                    setType: (t) => {
                      setNewFreqType(t);
                      if (t === 'weekly' && newDays.length === 0) setNewDays([new Date().getDay()]);
                    },
                    toggleDay: (d) => setNewDays((ds) => ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]),
                    setWeek: setNewWeek,
                    setWeekday: setNewWeekday,
                    setDay: setNewDay,
                    setOnceDate: setNewOnceDate,
                    toggleDate: (ds) => setNewFreqDates((cur) => cur.includes(ds) ? cur.filter((x) => x !== ds) : [...cur, ds]),
                  }, addPicker, setAddPicker, newOnceDate, newFreqDates.slice().sort().join(','))}

                  <View style={{ height: 12 }} />
                </ScrollView>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

      {/* Task detail bottom sheet */}
      <Modal visible={!!detailTask} transparent animationType="slide" onRequestClose={() => setDetailTask(null)}>
        <TouchableOpacity style={s.sheetBg} activeOpacity={1} onPress={() => setDetailTask(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}}>
              <View style={[s.sheet, { maxHeight: screen.height * 0.85 }]}>
                <View style={s.sheetHandle} />
                {detailTask && (
                  <TouchableOpacity style={s.sheetDeleteBtn} onPress={() => handleDelete(detailTask)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={s.sheetDeleteText}>🗑 削除</Text>
                  </TouchableOpacity>
                )}
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
                  {detailTask && (
                    <>
                      {/* Task name (top) */}
                      <Text style={s.sheetSection}>タスク名</Text>
                      <View style={s.sheetTitleRow}>
                        <TextInput
                          style={s.sheetTitleInput}
                          value={detailTitle}
                          onChangeText={setDetailTitle}
                          returnKeyType="done"
                          onSubmitEditing={handleSaveTitle}
                        />
                        <TouchableOpacity onPress={handleSaveTitle} disabled={detailTitle === detailTask.title} activeOpacity={0.85}>
                          <LinearGradient
                            colors={detailTitle === detailTask.title ? [C.border, C.border] : GRAD.brand}
                            start={GRAD_START} end={GRAD_END} style={s.sheetSaveBtn}
                          >
                            <Text style={s.sheetSaveBtnText}>保存</Text>
                          </LinearGradient>
                        </TouchableOpacity>
                      </View>
                      <TextInput
                        style={s.noteInput}
                        value={detailTask.note ?? ''}
                        onChangeText={(text) => setDetailTask(t => t ? { ...t, note: text } : null)}
                        onEndEditing={(e) => patchDetail({ note: e.nativeEvent.text.trim() || null })}
                        placeholder="メモ（任意）"
                        placeholderTextColor="#9ca3af"
                        returnKeyType="done"
                      />

                      {/* Notification time + notify (second) */}
                      <Text style={[s.sheetSection, { marginTop: 16 }]}>通知</Text>
                      {renderSchedule(
                        detailTask.scheduled_time,
                        !!detailTask.notify,
                        () => openTimeEditor('edit', detailTask.scheduled_time),
                        () => patchDetail({ scheduled_time: null }),
                        toggleDetailNotify,
                        (detailTask.notify_type === 'alarm' ? 'alarm' : 'push'),
                        (t) => patchDetail({ notify_type: t }),
                      )}

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
                        detailTask.freq_week ?? 1,
                        detailTask.freq_weekday ?? 1,
                        detailTask.freq_day ?? 1,
                        {
                          setType: (t) => {
                            const patch: TaskFields = { freq_type: t };
                            if (t === 'weekly') patch.freq_days = daysToCsv(parseDays(detailTask.freq_days).length ? parseDays(detailTask.freq_days) : [new Date().getDay()]);
                            if (t === 'monthly_nth') { patch.freq_week = detailTask.freq_week ?? 1; patch.freq_weekday = detailTask.freq_weekday ?? 1; }
                            if (t === 'monthly_day') patch.freq_day = detailTask.freq_day ?? 1;
                            if (t === 'once') patch.once_date = detailTask.once_date ?? today;
                            if (t === 'dates') patch.freq_dates = detailTask.freq_dates ?? '';
                            patchDetail(patch);
                          },
                          toggleDay: (d) => {
                            const cur = parseDays(detailTask.freq_days);
                            const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
                            patchDetail({ freq_days: daysToCsv(next) });
                          },
                          setWeek: (w) => patchDetail({ freq_week: w }),
                          setWeekday: (d) => patchDetail({ freq_weekday: d }),
                          setDay: (d) => patchDetail({ freq_day: d }),
                          setOnceDate: (d) => patchDetail({ once_date: d }),
                          toggleDate: (ds) => {
                            const cur = parseDateList(detailTask.freq_dates);
                            const next = cur.includes(ds) ? cur.filter((x) => x !== ds) : [...cur, ds];
                            patchDetail({ freq_dates: next.sort().join(',') });
                          },
                        },
                        detailPicker,
                        setDetailPicker,
                        detailTask.once_date,
                        detailTask.freq_dates,
                      )}

                      <View style={{ height: 12 }} />
                    </>
                  )}
                </ScrollView>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
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
                <LinearGradient colors={GRAD.brand} start={GRAD_START} end={GRAD_END} style={s.timeConfirmBtn}>
                  <Text style={s.timeConfirmText}>決定</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
