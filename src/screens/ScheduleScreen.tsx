import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar, TextInput, Alert, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import {
  Task, FlowProject, FlowStep, getToday, getTasks, getCompletedTaskIds,
  markComplete, markIncomplete, getSetting,
  getFlowProjects, addFlowProject, updateFlowProject, deleteFlowProject,
  getFlowSteps, addFlowStep, updateFlowStep, deleteFlowStep, reorderFlowSteps,
} from '../db/database';
import { isDueToday, WEEKDAYS } from '../constants/taskMeta';
import { GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';
import { useTheme, ColorSet } from '../contexts/ThemeContext';

const pad = (n: number) => String(n).padStart(2, '0');

// Day runs 5:00 → 4:00 next morning, like a printed timetable.
const HOURS: number[] = [...Array.from({ length: 19 }, (_, i) => i + 5), 0, 1, 2, 3, 4];
const hourLabel = (h: number) => `${h}:00`;
const bucketHour = (h: number) => h;

type Mode = 'schedule' | 'flow';
type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Schedule'> };

const downStyles = StyleSheet.create({
  down: { alignItems: 'center', justifyContent: 'center' },
  downLine: { width: 2 },
  arrowHead: { width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 9, borderLeftColor: 'transparent', borderRightColor: 'transparent', marginTop: -1 },
});

function Down({ color = '#64748b', h = 22 }: { color?: string; h?: number }) {
  return (
    <View style={downStyles.down} pointerEvents="none">
      <View style={[downStyles.downLine, { height: h, backgroundColor: color }]} />
      <View style={[downStyles.arrowHead, { borderTopColor: color }]} />
    </View>
  );
}

const makeStyles = (C: ColorSet) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },
  headerCard: { backgroundColor: C.primary, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, gap: 10 },
  dateNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateNavBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  dateNavArrow: { color: '#ffffff', fontSize: 24, fontWeight: '800', marginTop: -2 },
  dateNavCenter: { flex: 1, alignItems: 'center' },
  dateText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  dateTodayHint: { color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '700', marginTop: 1 },
  segRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 10, padding: 3 },
  segChip: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  segChipActive: { backgroundColor: '#ffffff' },
  segText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  segTextActive: { color: '#2563eb' },
  flowMeta: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '700' },

  bodyView: { flex: 1, backgroundColor: C.body },

  // ── schedule table ──
  table: { borderWidth: 1, borderColor: C.grid, borderRadius: 8, overflow: 'hidden', backgroundColor: C.card },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.grid, minHeight: 44 },
  rowLast: { borderBottomWidth: 0 },
  headRow: { backgroundColor: C.headerCell },
  timeCell: { width: 64, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, borderRightWidth: 1, borderRightColor: C.grid },
  timeCellNow: { backgroundColor: C.primarySoft },
  contentCell: { flex: 1, paddingHorizontal: 6, paddingVertical: 5, justifyContent: 'center', gap: 4 },
  headCell: { paddingVertical: 8 },
  headText: { color: C.onDark, fontSize: 13, fontWeight: '800' },
  timeText: { color: C.onDark, fontSize: 13, fontWeight: '700' },
  timeTextNow: { color: C.primary, fontWeight: '800' },
  taskPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primarySoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  taskPillDone: { backgroundColor: C.successBg },
  pillTime: { color: C.primary, fontSize: 11, fontWeight: '800' },
  pillTimeDone: { color: C.success },
  pillTitle: { flex: 1, color: C.onDark, fontSize: 13, fontWeight: '700' },
  pillTitleDone: { color: C.muted, textDecorationLine: 'line-through' },
  pillCheck: { color: C.success, fontSize: 13, fontWeight: '900' },
  untimedBox: { marginTop: 14, gap: 6 },
  untimedLabel: { color: C.muted, fontSize: 12, fontWeight: '800', marginBottom: 2 },

  // ── flow chart ──
  flowContent: { padding: 16, paddingBottom: 40, alignItems: 'center' },
  terminator: { backgroundColor: C.termBg, borderWidth: 1.5, borderColor: C.termBorder, borderRadius: 22, paddingHorizontal: 30, paddingVertical: 10 },
  terminatorText: { color: C.termText, fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  terminatorEndText: { color: '#ffffff' },
  terminatorDone: { backgroundColor: C.doneBg, borderColor: C.doneBorder },
  stepWrap: { alignItems: 'center', width: '100%' },
  process: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '82%', backgroundColor: C.termBg, borderWidth: 1.5, borderColor: C.termBorder, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 12 },
  processDone: { backgroundColor: C.successBg, borderColor: C.doneBorder },
  stepNo: { width: 22, height: 22, borderRadius: 4, backgroundColor: C.termBorder, alignItems: 'center', justifyContent: 'center' },
  stepNoDone: { backgroundColor: C.doneBg },
  stepNoText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  processText: { flex: 1, color: C.procText, fontSize: 13, fontWeight: '700' },
  processTextDone: { color: '#166534', textDecorationLine: 'line-through' },
  processCheck: { color: C.doneBg, fontSize: 14, fontWeight: '900' },
  diamond: { width: 96, height: 96, borderRadius: 8, borderWidth: 1.5, borderColor: C.diaBorder, backgroundColor: C.diaBg, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '45deg' }] },
  diamondDone: { backgroundColor: '#86efac' },
  diamondInner: { width: 140, alignItems: 'center', transform: [{ rotate: '-45deg' }] },
  diamondText: { color: C.diaText, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  diamondTextDone: { color: '#14532d' },
  branchRow: { flexDirection: 'row', width: '100%', marginTop: 2 },
  branchCol: { flex: 1, alignItems: 'center' },
  branchLabel: { fontSize: 12, fontWeight: '800', marginBottom: -2 },
  outBox: { backgroundColor: C.termBg, borderWidth: 1.5, borderColor: C.termBorder, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8, minWidth: 92, alignItems: 'center' },
  outBoxDone: { backgroundColor: C.doneBg, borderColor: C.doneBorder },
  outBoxNo: { backgroundColor: '#fef3c7', borderColor: '#d97706' },
  outText: { color: C.termText, fontSize: 13, fontWeight: '800' },
  outTextDone: { color: '#ffffff' },
  outNoText: { color: '#92400e', fontSize: 13, fontWeight: '800' },
  mergeRailWrap: { width: '50%', alignItems: 'center', marginTop: 14 },
  mergeRail: { width: '100%', height: 2, backgroundColor: C.line },

  empty: { paddingVertical: 60, alignItems: 'center', gap: 8 },
  emptyTitle: { color: C.ink, fontSize: 16, fontWeight: '700' },
  emptyBody: { color: C.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },

  // ── project selector ──
  projRow: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  projChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.grid },
  projChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  projChipText: { color: C.ink, fontSize: 12, fontWeight: '700' },
  projChipTextActive: { color: '#ffffff' },
  projAddChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: 'transparent', borderWidth: 1.5, borderColor: C.muted, borderStyle: 'dashed' },
  projAddText: { color: C.muted, fontSize: 18, fontWeight: '400', lineHeight: 20 },

  // ── edit mode ──
  editHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.grid },
  editTitle: { color: C.ink, fontSize: 15, fontWeight: '800' },
  editBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: C.primary },
  editBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  editBtnDanger: { backgroundColor: '#ef4444' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.grid, backgroundColor: C.card },
  stepHandle: { fontSize: 16, color: C.muted, paddingHorizontal: 4 },
  stepTitleText: { flex: 1, color: C.ink, fontSize: 14, fontWeight: '600' },
  stepDelBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' },
  stepDelText: { color: '#ef4444', fontSize: 14, fontWeight: '900', marginTop: -1 },
  stepUpBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  stepUpText: { color: C.primary, fontSize: 14, fontWeight: '900' },
  addStepRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  addStepInput: { flex: 1, borderWidth: 1.5, borderColor: C.grid, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, color: C.ink, fontSize: 14, backgroundColor: C.card },
  addStepBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  addStepBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },

  // ── modal ──
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '82%', backgroundColor: C.card, borderRadius: 16, padding: 20, gap: 12 },
  modalTitle: { color: C.ink, fontSize: 16, fontWeight: '800' },
  modalInput: { borderWidth: 1.5, borderColor: C.grid, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: C.ink, fontSize: 15, backgroundColor: C.body },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  modalCancel: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: C.grid, alignItems: 'center' },
  modalCancelText: { color: C.muted, fontSize: 14, fontWeight: '700' },
  modalOk: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: C.primary, alignItems: 'center' },
  modalOkText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },

  // ── project flow view ──
  projViewContent: { padding: 16, paddingBottom: 40, alignItems: 'center' },
  projStepWrap: { alignItems: 'center', width: '100%' },
  projProcess: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '82%', backgroundColor: C.termBg, borderWidth: 1.5, borderColor: C.termBorder, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 12 },
  projStepNo: { width: 22, height: 22, borderRadius: 4, backgroundColor: C.termBorder, alignItems: 'center', justifyContent: 'center' },
  projStepNoText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  projProcessText: { flex: 1, color: C.procText, fontSize: 13, fontWeight: '700' },
  projEmptyFlow: { paddingVertical: 40, alignItems: 'center', gap: 8 },
  projEmptyText: { color: C.muted, fontSize: 14 },
});

export default function ScheduleScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { C, grad } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const today = getToday();
  const now = new Date();
  const nowHour = now.getHours();

  const [selectedDate, setSelectedDate] = useState(today);
  const [mode, setMode] = useState<Mode>('schedule');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());
  const [scheduleSize, setScheduleSize] = useState<'small' | 'normal' | 'large'>('normal');
  const rowMinHeight = scheduleSize === 'small' ? 36 : scheduleSize === 'large' ? 68 : 44;

  // flowchart project state
  const [flowProjects, setFlowProjects] = useState<FlowProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null); // null = 今日
  const [flowSteps, setFlowSteps] = useState<FlowStep[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [newStepText, setNewStepText] = useState('');
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [editingStepId, setEditingStepId] = useState<number | null>(null);
  const [editingStepText, setEditingStepText] = useState('');

  const isToday = selectedDate === today;
  const selDateObj = useMemo(() => new Date(`${selectedDate}T00:00:00`), [selectedDate]);
  const dateLabel = `${selDateObj.getFullYear()}/${pad(selDateObj.getMonth() + 1)}/${pad(selDateObj.getDate())} (${WEEKDAYS[selDateObj.getDay()]})`;

  const shiftSelected = (days: number) => {
    const d = new Date(`${selectedDate}T00:00:00`);
    d.setDate(d.getDate() + days);
    setSelectedDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  };

  const load = useCallback(async () => {
    const [ts, ids, size, projs] = await Promise.all([
      getTasks(db),
      getCompletedTaskIds(db, selectedDate),
      getSetting(db, 'schedule_size'),
      getFlowProjects(db),
    ]);
    setTasks(ts);
    setCompletedIds(new Set(ids));
    if (size === 'small' || size === 'large' || size === 'normal') setScheduleSize(size);
    setFlowProjects(projs);
  }, [db, selectedDate]);

  const loadSteps = useCallback(async (projectId: number) => {
    const steps = await getFlowSteps(db, projectId);
    setFlowSteps(steps);
  }, [db]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (id: number) => {
    if (completedIds.has(id)) await markIncomplete(db, id, selectedDate);
    else await markComplete(db, id, selectedDate);
    load();
  };

  const selectProject = (id: number | null) => {
    setSelectedProjectId(id);
    setEditMode(false);
    setNewStepText('');
    if (id !== null) loadSteps(id);
  };

  const handleAddProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    const id = await addFlowProject(db, name);
    setNewProjectName('');
    setShowAddProject(false);
    await load();
    selectProject(id);
  };

  const handleDeleteProject = (proj: FlowProject) => {
    Alert.alert('削除', `「${proj.title}」を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: async () => {
        await deleteFlowProject(db, proj.id);
        setSelectedProjectId(null);
        setEditMode(false);
        await load();
      }},
    ]);
  };

  const handleAddStep = async () => {
    if (!newStepText.trim() || selectedProjectId === null) return;
    await addFlowStep(db, selectedProjectId, newStepText.trim());
    setNewStepText('');
    await loadSteps(selectedProjectId);
  };

  const handleDeleteStep = async (stepId: number) => {
    await deleteFlowStep(db, stepId);
    if (selectedProjectId !== null) await loadSteps(selectedProjectId);
  };

  const handleMoveStep = async (stepId: number, dir: -1 | 1) => {
    const idx = flowSteps.findIndex((s) => s.id === stepId);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= flowSteps.length) return;
    const reordered = [...flowSteps];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    setFlowSteps(reordered);
    await reorderFlowSteps(db, reordered.map((s) => s.id));
  };

  const handleRenameStep = async () => {
    if (!editingStepText.trim() || editingStepId === null) return;
    await updateFlowStep(db, editingStepId, editingStepText.trim());
    setEditingStepId(null);
    if (selectedProjectId !== null) await loadSteps(selectedProjectId);
  };

  const handleRenameProject = (proj: FlowProject) => {
    setNewProjectName(proj.title);
    setShowAddProject(true);
  };

  // タイムスケジュール：全タスクを表示（HomeScreen と同様に期限切れのみ除外）
  const allActive = tasks.filter((t) => {
    if (t.freq_type === 'once' && t.once_date && t.once_date < selectedDate) return false;
    if (t.freq_type === 'dates') {
      const ds = (t.freq_dates ?? '').split(',').filter(Boolean);
      if (ds.length > 0 && ds.every((d) => d < selectedDate)) return false;
    }
    return true;
  });
  const timedAll = allActive.filter((t) => t.scheduled_time).sort((a, b) =>
    a.scheduled_time! < b.scheduled_time! ? -1 : a.scheduled_time! > b.scheduled_time! ? 1 : a.sort_order - b.sort_order
  );
  const untimedAll = allActive.filter((t) => !t.scheduled_time);

  // フローチャート：今日対象のタスクのみ
  const due = tasks.filter((t) => isDueToday(t, selDateObj));
  const ordered = [...due].sort((a, b) => {
    const at = a.scheduled_time ?? '99:99';
    const bt = b.scheduled_time ?? '99:99';
    if (at !== bt) return at < bt ? -1 : 1;
    return a.sort_order - b.sort_order;
  });
  const doneCount = due.filter((t) => completedIds.has(t.id)).length;
  const remaining = due.length - doneCount;
  const allDone = due.length > 0 && remaining === 0;

  const byHour: Record<number, Task[]> = {};
  for (const t of timedAll) {
    const h = bucketHour(Number(t.scheduled_time!.slice(0, 2)));
    (byHour[h] ??= []).push(t);
  }
  for (const h of Object.keys(byHour)) {
    byHour[Number(h)].sort((a, b) => (a.scheduled_time! < b.scheduled_time! ? -1 : 1));
  }

  const renderPill = (task: Task) => {
    const done = completedIds.has(task.id);
    return (
      <TouchableOpacity key={task.id} style={[s.taskPill, done && s.taskPillDone]} onPress={() => toggle(task.id)} activeOpacity={0.7}>
        {task.scheduled_time && <Text style={[s.pillTime, done && s.pillTimeDone]}>{task.scheduled_time}</Text>}
        <Text style={[s.pillTitle, done && s.pillTitleDone]} numberOfLines={1}>
          {task.icon ? `${task.icon} ` : ''}{task.title}
        </Text>
        {done && <Text style={s.pillCheck}>✓</Text>}
      </TouchableOpacity>
    );
  };

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient colors={grad.header} start={GRAD_START} end={GRAD_END} style={[s.headerCard, { paddingTop: insets.top + 12 }]}>
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
        <View style={s.segRow}>
          {([['schedule', 'タイムスケジュール'], ['flow', 'フローチャート']] as [Mode, string][]).map(([m, label]) => (
            <TouchableOpacity key={m} style={[s.segChip, mode === m && s.segChipActive]} onPress={() => setMode(m)}>
              <Text style={[s.segText, mode === m && s.segTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {mode === 'flow' && selectedProjectId === null && (
          <Text style={s.flowMeta}>{doneCount}/{due.length} 完了</Text>
        )}
      </LinearGradient>

      {mode === 'schedule' ? (
        <ScrollView style={s.bodyView} contentContainerStyle={{ padding: 12, paddingBottom: 28 }}>
          <View style={s.table}>
            <View style={[s.row, s.headRow]}>
              <View style={[s.timeCell, s.headCell]}><Text style={s.headText}>時間</Text></View>
              <View style={[s.contentCell, s.headCell]}><Text style={s.headText}>内容</Text></View>
            </View>
            {HOURS.map((h, idx) => {
              const items = byHour[h] ?? [];
              const isNow = isToday && h === bucketHour(nowHour);
              return (
                <View
                  key={h}
                  style={[s.row, { minHeight: rowMinHeight }, idx === HOURS.length - 1 && s.rowLast]}
                >
                  <View style={[s.timeCell, isNow && s.timeCellNow]}>
                    <Text style={[s.timeText, isNow && s.timeTextNow]}>{hourLabel(h)}</Text>
                  </View>
                  <View style={s.contentCell}>{items.map(renderPill)}</View>
                </View>
              );
            })}
          </View>

          {untimedAll.length > 0 && (
            <View style={s.untimedBox}>
              <Text style={s.untimedLabel}>時間未設定</Text>
              {untimedAll.map(renderPill)}
            </View>
          )}
        </ScrollView>
      ) : (
        <>
          {/* Project selector row */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.projRow}>
            <TouchableOpacity
              style={[s.projChip, selectedProjectId === null && s.projChipActive]}
              onPress={() => selectProject(null)}
            >
              <Text style={[s.projChipText, selectedProjectId === null && s.projChipTextActive]}>今日</Text>
            </TouchableOpacity>
            {flowProjects.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[s.projChip, selectedProjectId === p.id && s.projChipActive]}
                onPress={() => selectProject(p.id)}
              >
                <Text style={[s.projChipText, selectedProjectId === p.id && s.projChipTextActive]}>{p.title}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={s.projAddChip} onPress={() => { setNewProjectName(''); setShowAddProject(true); }}>
              <Text style={s.projAddText}>＋</Text>
            </TouchableOpacity>
          </ScrollView>

          {selectedProjectId === null ? (
            /* 今日フローチャート */
            <ScrollView style={s.bodyView} contentContainerStyle={s.flowContent}>
              {due.length === 0 ? (
                <View style={s.empty}>
                  <Text style={s.emptyTitle}>この日のフローはありません</Text>
                  <Text style={s.emptyBody}>頻度がこの日に当たるタスクがワークフローになります</Text>
                </View>
              ) : (
                <>
                  <View style={s.terminator}><Text style={s.terminatorText}>開始</Text></View>
                  {ordered.map((task, i) => {
                    const isDone = completedIds.has(task.id);
                    return (
                      <View key={task.id} style={s.stepWrap}>
                        <Down color={isDone ? C.doneBg : C.line} />
                        <TouchableOpacity style={[s.process, isDone && s.processDone]} onPress={() => toggle(task.id)} activeOpacity={0.8}>
                          <View style={[s.stepNo, isDone && s.stepNoDone]}><Text style={s.stepNoText}>{i + 1}</Text></View>
                          <Text style={[s.processText, isDone && s.processTextDone]} numberOfLines={2}>
                            {task.icon ? `${task.icon} ` : ''}{task.title}{task.scheduled_time ? `  (${task.scheduled_time})` : ''}
                          </Text>
                          {isDone && <Text style={s.processCheck}>✓</Text>}
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                  <Down color={allDone ? C.doneBg : C.line} />
                  <View style={[s.diamond, allDone && s.diamondDone]}>
                    <View style={s.diamondInner}>
                      <Text style={[s.diamondText, allDone && s.diamondTextDone]}>全部{'\n'}完了?</Text>
                    </View>
                  </View>
                  <View style={s.branchRow}>
                    <View style={s.branchCol}>
                      <Text style={[s.branchLabel, { color: C.diaBorder }]}>はい</Text>
                      <Down color={allDone ? C.doneBg : C.line} h={16} />
                      <View style={[s.outBox, allDone && s.outBoxDone]}>
                        <Text style={[s.outText, allDone && s.outTextDone]}>完了 🎉</Text>
                      </View>
                    </View>
                    <View style={s.branchCol}>
                      <Text style={[s.branchLabel, { color: C.muted }]}>いいえ</Text>
                      <Down color={C.line} h={16} />
                      <View style={[s.outBox, s.outBoxNo]}>
                        <Text style={s.outNoText}>残り {remaining} 件</Text>
                      </View>
                    </View>
                  </View>
                  <View style={s.mergeRailWrap}><View style={s.mergeRail} /></View>
                  <Down color={allDone ? C.doneBg : C.line} h={16} />
                  <View style={[s.terminator, allDone && s.terminatorDone]}>
                    <Text style={[s.terminatorText, allDone && s.terminatorEndText]}>終了</Text>
                  </View>
                </>
              )}
            </ScrollView>
          ) : (
            /* プロジェクトフローチャート */
            <View style={s.bodyView}>
              {/* Edit/View toolbar */}
              <View style={s.editHeader}>
                <Text style={s.editTitle}>
                  {flowProjects.find((p) => p.id === selectedProjectId)?.title ?? ''}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={s.editBtn}
                    onPress={() => { setEditMode((v) => !v); setNewStepText(''); }}
                  >
                    <Text style={s.editBtnText}>{editMode ? '完了' : '編集'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.editBtn, s.editBtnDanger]}
                    onPress={() => {
                      const proj = flowProjects.find((p) => p.id === selectedProjectId);
                      if (proj) handleDeleteProject(proj);
                    }}
                  >
                    <Text style={s.editBtnText}>削除</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {editMode ? (
                <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
                  {flowSteps.map((step, idx) => (
                    <View key={step.id} style={s.stepRow}>
                      <Text style={s.stepHandle}>☰</Text>
                      <TouchableOpacity
                        style={{ flex: 1 }}
                        onPress={() => { setEditingStepId(step.id); setEditingStepText(step.title); }}
                      >
                        <Text style={s.stepTitleText}>{step.title}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={s.stepUpBtn}
                        onPress={() => handleMoveStep(step.id, -1)}
                        disabled={idx === 0}
                      >
                        <Text style={[s.stepUpText, { opacity: idx === 0 ? 0.3 : 1 }]}>↑</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={s.stepUpBtn}
                        onPress={() => handleMoveStep(step.id, 1)}
                        disabled={idx === flowSteps.length - 1}
                      >
                        <Text style={[s.stepUpText, { opacity: idx === flowSteps.length - 1 ? 0.3 : 1 }]}>↓</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.stepDelBtn} onPress={() => handleDeleteStep(step.id)}>
                        <Text style={s.stepDelText}>×</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  <View style={s.addStepRow}>
                    <TextInput
                      style={s.addStepInput}
                      placeholder="ステップを追加..."
                      placeholderTextColor={C.muted}
                      value={newStepText}
                      onChangeText={setNewStepText}
                      onSubmitEditing={handleAddStep}
                      returnKeyType="done"
                    />
                    <TouchableOpacity style={s.addStepBtn} onPress={handleAddStep}>
                      <Text style={s.addStepBtnText}>追加</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              ) : (
                <ScrollView contentContainerStyle={s.projViewContent}>
                  {flowSteps.length === 0 ? (
                    <View style={s.projEmptyFlow}>
                      <Text style={s.projEmptyText}>ステップがありません</Text>
                      <TouchableOpacity style={[s.editBtn, { marginTop: 8 }]} onPress={() => setEditMode(true)}>
                        <Text style={s.editBtnText}>ステップを追加</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      <View style={s.terminator}><Text style={s.terminatorText}>開始</Text></View>
                      {flowSteps.map((step, i) => (
                        <View key={step.id} style={s.projStepWrap}>
                          <Down color={C.line} />
                          <View style={s.projProcess}>
                            <View style={s.projStepNo}><Text style={s.projStepNoText}>{i + 1}</Text></View>
                            <Text style={s.projProcessText}>{step.title}</Text>
                          </View>
                        </View>
                      ))}
                      <Down color={C.line} />
                      <View style={s.terminator}><Text style={s.terminatorText}>終了</Text></View>
                    </>
                  )}
                </ScrollView>
              )}
            </View>
          )}
        </>
      )}

      {/* Add/rename project modal */}
      <Modal visible={showAddProject} transparent animationType="fade" onRequestClose={() => setShowAddProject(false)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setShowAddProject(false)}>
          <TouchableOpacity activeOpacity={1} style={s.modalCard} onPress={() => {}}>
            <Text style={s.modalTitle}>プロジェクト名</Text>
            <TextInput
              style={s.modalInput}
              placeholder="名前を入力..."
              placeholderTextColor={C.muted}
              value={newProjectName}
              onChangeText={setNewProjectName}
              autoFocus
              onSubmitEditing={handleAddProject}
              returnKeyType="done"
            />
            <View style={s.modalActions}>
              <TouchableOpacity style={s.modalCancel} onPress={() => setShowAddProject(false)}>
                <Text style={s.modalCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.modalOk} onPress={handleAddProject}>
                <Text style={s.modalOkText}>作成</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Rename step modal */}
      <Modal visible={editingStepId !== null} transparent animationType="fade" onRequestClose={() => setEditingStepId(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setEditingStepId(null)}>
          <TouchableOpacity activeOpacity={1} style={s.modalCard} onPress={() => {}}>
            <Text style={s.modalTitle}>ステップを編集</Text>
            <TextInput
              style={s.modalInput}
              value={editingStepText}
              onChangeText={setEditingStepText}
              autoFocus
              onSubmitEditing={handleRenameStep}
              returnKeyType="done"
            />
            <View style={s.modalActions}>
              <TouchableOpacity style={s.modalCancel} onPress={() => setEditingStepId(null)}>
                <Text style={s.modalCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.modalOk} onPress={handleRenameStep}>
                <Text style={s.modalOkText}>保存</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <TabBar current="Schedule" navigation={navigation} />
    </View>
  );
}
