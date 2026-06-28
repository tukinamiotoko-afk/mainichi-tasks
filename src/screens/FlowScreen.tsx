import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar,
  Modal, TextInput, Animated, PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import {
  Task, FlowBranch, getToday, getTasks, getCompletedTaskIds,
  markComplete, markIncomplete, updateTaskSortOrders,
  getFlowBranches, addFlowBranch, updateFlowBranch, deleteFlowBranch,
} from '../db/database';
import { isDueToday, WEEKDAYS } from '../constants/taskMeta';
import { GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';
import { useTheme, ColorSet } from '../contexts/ThemeContext';

const pad = (n: number) => String(n).padStart(2, '0');

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Flow'> };

type FlowNode = { type: 'task'; task: Task } | { type: 'branch'; branch: FlowBranch };

type BranchModal = {
  mode: 'add' | 'edit';
  afterTaskId: number | null;
  editId: number | null;
  question: string;
  yesLabel: string;
  yesText: string;
  noLabel: string;
  noText: string;
};

function buildNodes(tasks: Task[], branches: FlowBranch[]): FlowNode[] {
  const nodes: FlowNode[] = [];
  for (const task of tasks) {
    nodes.push({ type: 'task', task });
    branches
      .filter((b) => b.after_task_id === task.id)
      .forEach((b) => nodes.push({ type: 'branch', branch: b }));
  }
  return nodes;
}

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
  headerCard: { backgroundColor: C.primary, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
  dateNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateNavBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  dateNavArrow: { color: '#ffffff', fontSize: 24, fontWeight: '800', marginTop: -2 },
  dateNavCenter: { flex: 1, alignItems: 'center' },
  dateText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  dateTodayHint: { color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '700', marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.22)' },
  editBtnActive: { backgroundColor: '#ffffff' },
  editBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  editBtnTextActive: { color: C.primary },
  branchHeaderBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  branchHeaderBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '900', marginTop: -1 },

  bodyView: { flex: 1, backgroundColor: C.body },

  // ── flowchart ──
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
  diamondCustom: { borderColor: '#7c3aed', backgroundColor: '#ede9fe' },
  diamondInner: { width: 140, alignItems: 'center', transform: [{ rotate: '-45deg' }] },
  diamondText: { color: C.diaText, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  diamondTextDone: { color: '#14532d' },
  diamondTextCustom: { color: '#4c1d95' },
  branchRow: { flexDirection: 'row', width: '100%', marginTop: 2 },
  branchCol: { flex: 1, alignItems: 'center' },
  branchLabel: { fontSize: 12, fontWeight: '800', marginBottom: -2 },
  outBox: { backgroundColor: C.termBg, borderWidth: 1.5, borderColor: C.termBorder, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8, minWidth: 92, alignItems: 'center' },
  outBoxDone: { backgroundColor: C.doneBg, borderColor: C.doneBorder },
  outBoxNo: { backgroundColor: '#fef3c7', borderColor: '#d97706' },
  outBoxYes: { backgroundColor: '#f0fdf4', borderColor: '#86efac' },
  outBoxCustomNo: { backgroundColor: '#faf5ff', borderColor: '#c4b5fd' },
  outText: { color: C.termText, fontSize: 13, fontWeight: '800' },
  outTextDone: { color: '#ffffff' },
  outNoText: { color: '#92400e', fontSize: 13, fontWeight: '800' },
  outYesText: { color: '#166534', fontSize: 13, fontWeight: '800' },
  outCustomNoText: { color: '#5b21b6', fontSize: 13, fontWeight: '800' },
  mergeRailWrap: { width: '50%', alignItems: 'center', marginTop: 14 },
  mergeRail: { width: '100%', height: 2, backgroundColor: C.line },

  // ── edit mode (drag list) ──
  editList: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 40 },
  editHint: { color: C.muted, fontSize: 12, textAlign: 'center', marginBottom: 10 },
  editTaskRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6,
  },
  editTaskRowDragging: {
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18, shadowRadius: 12, elevation: 10,
    borderColor: C.primary, backgroundColor: C.card,
  },
  editHandle: { fontSize: 18, color: C.muted, paddingHorizontal: 4, paddingVertical: 4 },
  editStepNo: { width: 22, height: 22, borderRadius: 4, backgroundColor: C.termBorder, alignItems: 'center', justifyContent: 'center' },
  editStepNoText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  editTaskTitle: { flex: 1, color: C.ink, fontSize: 13, fontWeight: '700' },
  editBranchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#faf5ff', borderRadius: 10, borderWidth: 1, borderColor: '#c4b5fd',
    paddingHorizontal: 12, paddingVertical: 9, marginBottom: 4, marginLeft: 20,
  },
  editBranchIcon: { fontSize: 14, color: '#7c3aed' },
  editBranchBody: { flex: 1 },
  editBranchQuestion: { color: '#4c1d95', fontSize: 13, fontWeight: '800' },
  editBranchLabels: { color: '#7c3aed', fontSize: 11, marginTop: 1 },
  editBranchActionBtn: { width: 28, height: 28, borderRadius: 8, backgroundColor: '#ede9fe', alignItems: 'center', justifyContent: 'center' },
  editBranchActionText: { fontSize: 13, fontWeight: '800' },

  // ── modal ──
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10 },
  modalTitle: { color: C.ink, fontSize: 16, fontWeight: '800', marginBottom: 2 },
  modalSection: { color: C.muted, fontSize: 11, fontWeight: '700', marginTop: 6, marginBottom: 2 },
  modalInput: { borderWidth: 1.5, borderColor: C.grid, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: C.ink, fontSize: 14, backgroundColor: C.body },
  modalRow: { flexDirection: 'row', gap: 8 },
  modalHalf: { flex: 1 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalCancel: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: C.grid, alignItems: 'center' },
  modalCancelText: { color: C.muted, fontSize: 14, fontWeight: '700' },
  modalOk: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#7c3aed', alignItems: 'center' },
  modalOkText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  pickerScroll: { marginVertical: 2 },
  pickerChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: C.body, borderWidth: 1.5, borderColor: C.border, marginRight: 8 },
  pickerChipActive: { backgroundColor: '#ede9fe', borderColor: '#7c3aed' },
  pickerChipText: { color: C.muted, fontSize: 12, fontWeight: '700' },
  pickerChipTextActive: { color: '#4c1d95', fontSize: 12, fontWeight: '700' },

  empty: { paddingVertical: 60, alignItems: 'center', gap: 8 },
  emptyTitle: { color: C.ink, fontSize: 16, fontWeight: '700' },
  emptyBody: { color: C.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
});

export default function FlowScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { C, grad } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const today = getToday();

  const [selectedDate, setSelectedDate] = useState(today);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());
  const [branches, setBranches] = useState<FlowBranch[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [editOrdered, setEditOrdered] = useState<Task[]>([]);
  const [modal, setModal] = useState<BranchModal | null>(null);

  // ── drag state ──
  const dragY = useRef(new Animated.Value(0)).current;
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const draggingIdxRef = useRef<number | null>(null);
  const dropRef = useRef(0);
  const slotH = useRef(56);
  const shiftAnims = useRef<Animated.Value[]>([]);
  const editOrderedRef = useRef<Task[]>([]);
  const panMap = useRef<Map<number, ReturnType<typeof PanResponder.create>>>(new Map());

  editOrderedRef.current = editOrdered;

  // sync shiftAnims length with editOrdered
  while (shiftAnims.current.length < editOrdered.length) {
    shiftAnims.current.push(new Animated.Value(0));
  }
  if (shiftAnims.current.length > editOrdered.length) {
    shiftAnims.current = shiftAnims.current.slice(0, editOrdered.length);
  }

  const getPan = (taskId: number) => {
    if (!panMap.current.has(taskId)) {
      panMap.current.set(taskId, PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, { dy }) => Math.abs(dy) > 3,
        onPanResponderGrant: () => {
          const idx = editOrderedRef.current.findIndex((t) => t.id === taskId);
          draggingIdxRef.current = idx;
          dropRef.current = idx;
          dragY.setValue(0);
          shiftAnims.current.forEach((a) => a.setValue(0));
          setDraggingIdx(idx);
        },
        onPanResponderMove: (_, { dy }) => {
          const startIdx = draggingIdxRef.current ?? 0;
          dragY.setValue(dy);
          const slot = slotH.current;
          const n = editOrderedRef.current.length;
          const drop = Math.max(0, Math.min(n - 1, startIdx + Math.round(dy / slot)));
          dropRef.current = drop;
          shiftAnims.current.forEach((anim, i) => {
            if (i === startIdx) return;
            let shift = 0;
            if (drop > startIdx && i > startIdx && i <= drop) shift = -slot;
            else if (drop < startIdx && i < startIdx && i >= drop) shift = slot;
            anim.setValue(shift);
          });
        },
        onPanResponderRelease: () => {
          const from = draggingIdxRef.current ?? 0;
          const to = dropRef.current;
          shiftAnims.current.forEach((a) => a.setValue(0));
          dragY.setValue(0);
          draggingIdxRef.current = null;
          setDraggingIdx(null);
          if (from !== to) {
            setEditOrdered((prev) => {
              const arr = [...prev];
              const [item] = arr.splice(from, 1);
              arr.splice(to, 0, item);
              return arr;
            });
          }
        },
        onPanResponderTerminate: () => {
          shiftAnims.current.forEach((a) => a.setValue(0));
          dragY.setValue(0);
          draggingIdxRef.current = null;
          setDraggingIdx(null);
        },
      }));
    }
    return panMap.current.get(taskId)!;
  };

  const isToday = selectedDate === today;
  const selDateObj = useMemo(() => new Date(`${selectedDate}T00:00:00`), [selectedDate]);
  const dateLabel = `${selDateObj.getFullYear()}/${pad(selDateObj.getMonth() + 1)}/${pad(selDateObj.getDate())} (${WEEKDAYS[selDateObj.getDay()]})`;

  const shiftSelected = (days: number) => {
    const d = new Date(`${selectedDate}T00:00:00`);
    d.setDate(d.getDate() + days);
    setSelectedDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  };

  const load = useCallback(async () => {
    const [ts, ids, brs] = await Promise.all([
      getTasks(db),
      getCompletedTaskIds(db, selectedDate),
      getFlowBranches(db),
    ]);
    setTasks(ts);
    setCompletedIds(new Set(ids));
    setBranches(brs);
  }, [db, selectedDate]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (id: number) => {
    if (completedIds.has(id)) await markIncomplete(db, id, selectedDate);
    else await markComplete(db, id, selectedDate);
    load();
  };

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

  const dueIds = useMemo(() => new Set(ordered.map((t) => t.id)), [ordered]);
  const flowNodes = useMemo(
    () => buildNodes(ordered, branches.filter((b) => b.after_task_id !== null && dueIds.has(b.after_task_id!))),
    [ordered, branches, dueIds],
  );

  const enterEdit = () => {
    setEditOrdered([...ordered]);
    setEditMode(true);
  };

  const exitEdit = async () => {
    await updateTaskSortOrders(db, editOrdered.map((t) => t.id));
    setEditMode(false);
    load();
  };

  const openAddBranch = (afterTaskId: number | null = null) => {
    setModal({ mode: 'add', afterTaskId, editId: null, question: '', yesLabel: 'はい', yesText: '', noLabel: 'いいえ', noText: '' });
  };

  const openEditBranch = (branch: FlowBranch) => {
    setModal({
      mode: 'edit', afterTaskId: branch.after_task_id, editId: branch.id,
      question: branch.question, yesLabel: branch.yes_label, yesText: branch.yes_text ?? '',
      noLabel: branch.no_label, noText: branch.no_text ?? '',
    });
  };

  const saveBranch = async () => {
    if (!modal || modal.afterTaskId === null) return;
    const data: Omit<FlowBranch, 'id'> = {
      after_task_id: modal.afterTaskId,
      question: modal.question.trim() || '確認',
      yes_label: modal.yesLabel.trim() || 'はい',
      yes_text: modal.yesText.trim() || null,
      no_label: modal.noLabel.trim() || 'いいえ',
      no_text: modal.noText.trim() || null,
    };
    if (modal.mode === 'add') await addFlowBranch(db, data);
    else if (modal.editId !== null) await updateFlowBranch(db, modal.editId, data);
    setModal(null);
    load();
  };

  const removeBranch = async (id: number) => {
    await deleteFlowBranch(db, id);
    load();
  };

  const setTextField = (field: 'question' | 'yesLabel' | 'yesText' | 'noLabel' | 'noText', value: string) =>
    setModal((m) => (m ? { ...m, [field]: value } : m));

  const selectPickerTask = (id: number) =>
    setModal((m) => (m ? { ...m, afterTaskId: id } : m));

  const editIds = useMemo(() => new Set(editOrdered.map((t) => t.id)), [editOrdered]);
  const editBranches = useMemo(
    () => branches.filter((b) => b.after_task_id !== null && editIds.has(b.after_task_id!)),
    [branches, editIds],
  );

  const pickerTasks = editMode ? editOrdered : ordered;

  let taskCounter = 0;

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient colors={grad.header} start={GRAD_START} end={GRAD_END} style={[s.headerCard, { paddingTop: insets.top + 12 }]}>
        <View style={s.dateNavRow}>
          <TouchableOpacity onPress={() => shiftSelected(-1)} style={s.dateNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} disabled={editMode}>
            <Text style={[s.dateNavArrow, editMode && { opacity: 0.3 }]}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSelectedDate(today)} activeOpacity={0.7} style={s.dateNavCenter} disabled={editMode}>
            <Text style={s.dateText}>{dateLabel}</Text>
            {!isToday && <Text style={s.dateTodayHint}>タップで今日へ</Text>}
          </TouchableOpacity>
          <View style={s.headerRight}>
            <TouchableOpacity onPress={() => shiftSelected(1)} style={s.dateNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} disabled={editMode}>
              <Text style={[s.dateNavArrow, editMode && { opacity: 0.3 }]}>›</Text>
            </TouchableOpacity>
            {due.length > 0 && (
              <>
                <TouchableOpacity style={s.branchHeaderBtn} onPress={() => openAddBranch(null)}>
                  <Text style={s.branchHeaderBtnText}>◇</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.editBtn, editMode && s.editBtnActive]} onPress={editMode ? exitEdit : enterEdit}>
                  <Text style={[s.editBtnText, editMode && s.editBtnTextActive]}>{editMode ? '完了' : '編集'}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </LinearGradient>

      {editMode ? (
        /* ── edit mode: drag to reorder ── */
        <ScrollView style={s.bodyView} contentContainerStyle={s.editList} scrollEnabled={draggingIdx === null}>
          <Text style={s.editHint}>☰ を押しながらなぞって並び替え</Text>
          {editOrdered.map((task, i) => {
            taskCounter += 1;
            const isDragging = draggingIdx === i;
            const taskBranches = editBranches.filter((b) => b.after_task_id === task.id);
            const pan = getPan(task.id);
            const animStyle = isDragging
              ? { transform: [{ translateY: dragY }], zIndex: 99 }
              : { transform: [{ translateY: shiftAnims.current[i] ?? new Animated.Value(0) }] };

            return (
              <View key={task.id}>
                <Animated.View
                  style={[s.editTaskRow, isDragging && s.editTaskRowDragging, animStyle]}
                  onLayout={i === 0 ? (e) => { slotH.current = e.nativeEvent.layout.height + 6; } : undefined}
                >
                  <View {...pan.panHandlers}>
                    <Text style={s.editHandle}>☰</Text>
                  </View>
                  <View style={s.editStepNo}><Text style={s.editStepNoText}>{taskCounter}</Text></View>
                  <Text style={s.editTaskTitle} numberOfLines={2}>
                    {task.icon ? `${task.icon} ` : ''}{task.title}{task.scheduled_time ? `  (${task.scheduled_time})` : ''}
                  </Text>
                </Animated.View>
                {taskBranches.map((br) => (
                  <View key={br.id} style={s.editBranchRow}>
                    <Text style={s.editBranchIcon}>◇</Text>
                    <View style={s.editBranchBody}>
                      <Text style={s.editBranchQuestion}>{br.question}</Text>
                      <Text style={s.editBranchLabels}>
                        {br.yes_label}{br.yes_text ? `→${br.yes_text}` : ''} / {br.no_label}{br.no_text ? `→${br.no_text}` : ''}
                      </Text>
                    </View>
                    <TouchableOpacity style={s.editBranchActionBtn} onPress={() => openEditBranch(br)}>
                      <Text style={s.editBranchActionText}>✎</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.editBranchActionBtn} onPress={() => removeBranch(br.id)}>
                      <Text style={[s.editBranchActionText, { color: '#ef4444' }]}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            );
          })}
        </ScrollView>
      ) : (
        /* ── flowchart view ── */
        <ScrollView style={s.bodyView} contentContainerStyle={s.flowContent}>
          {due.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyTitle}>この日のフローはありません</Text>
              <Text style={s.emptyBody}>頻度がこの日に当たるタスクがワークフローになります</Text>
            </View>
          ) : (
            <>
              <View style={s.terminator}><Text style={s.terminatorText}>開始</Text></View>
              {(() => {
                let tIdx = 0;
                return flowNodes.map((node) => {
                  if (node.type === 'task') {
                    tIdx += 1;
                    const isDone = completedIds.has(node.task.id);
                    return (
                      <View key={`task-${node.task.id}`} style={s.stepWrap}>
                        <Down color={isDone ? C.doneBg : C.line} />
                        <TouchableOpacity style={[s.process, isDone && s.processDone]} onPress={() => toggle(node.task.id)} activeOpacity={0.8}>
                          <View style={[s.stepNo, isDone && s.stepNoDone]}><Text style={s.stepNoText}>{tIdx}</Text></View>
                          <Text style={[s.processText, isDone && s.processTextDone]} numberOfLines={2}>
                            {node.task.icon ? `${node.task.icon} ` : ''}{node.task.title}{node.task.scheduled_time ? `  (${node.task.scheduled_time})` : ''}
                          </Text>
                          {isDone && <Text style={s.processCheck}>✓</Text>}
                        </TouchableOpacity>
                      </View>
                    );
                  }
                  const br = node.branch;
                  return (
                    <View key={`branch-${br.id}`} style={s.stepWrap}>
                      <Down color={C.line} />
                      <View style={[s.diamond, s.diamondCustom]}>
                        <View style={s.diamondInner}>
                          <Text style={[s.diamondText, s.diamondTextCustom]} numberOfLines={3}>{br.question}</Text>
                        </View>
                      </View>
                      <View style={s.branchRow}>
                        <View style={s.branchCol}>
                          <Text style={[s.branchLabel, { color: '#7c3aed' }]}>{br.yes_label}</Text>
                          <Down color={C.line} h={16} />
                          {br.yes_text ? <View style={s.outBoxYes}><Text style={s.outYesText}>{br.yes_text}</Text></View> : null}
                        </View>
                        <View style={s.branchCol}>
                          <Text style={[s.branchLabel, { color: '#a78bfa' }]}>{br.no_label}</Text>
                          <Down color={C.line} h={16} />
                          {br.no_text ? <View style={s.outBoxCustomNo}><Text style={s.outCustomNoText}>{br.no_text}</Text></View> : null}
                        </View>
                      </View>
                      <View style={s.mergeRailWrap}><View style={s.mergeRail} /></View>
                    </View>
                  );
                });
              })()}
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
      )}

      {/* ── branch modal ── */}
      <Modal visible={modal !== null} transparent animationType="slide" onRequestClose={() => setModal(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setModal(null)}>
          <TouchableOpacity activeOpacity={1} style={s.modalCard} onPress={() => {}}>
            <Text style={s.modalTitle}>{modal?.mode === 'add' ? '分岐を追加' : '分岐を編集'}</Text>

            {modal?.mode === 'add' && (
              <>
                <Text style={s.modalSection}>どのステップの後に入れる？</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pickerScroll}>
                  {pickerTasks.map((t) => {
                    const active = modal.afterTaskId === t.id;
                    return (
                      <TouchableOpacity key={t.id} style={[s.pickerChip, active && s.pickerChipActive]} onPress={() => selectPickerTask(t.id)}>
                        <Text style={active ? s.pickerChipTextActive : s.pickerChipText}>
                          {t.icon ? `${t.icon} ` : ''}{t.title}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </>
            )}

            <Text style={s.modalSection}>◇ 条件（ひし形のテキスト）</Text>
            <TextInput
              style={s.modalInput}
              placeholder="例：全部完了？"
              placeholderTextColor={C.muted}
              value={modal?.question ?? ''}
              onChangeText={(v) => setTextField('question', v)}
              returnKeyType="next"
            />

            <Text style={s.modalSection}>はい側</Text>
            <View style={s.modalRow}>
              <View style={s.modalHalf}>
                <TextInput style={s.modalInput} placeholder="ラベル" placeholderTextColor={C.muted} value={modal?.yesLabel ?? ''} onChangeText={(v) => setTextField('yesLabel', v)} />
              </View>
              <View style={s.modalHalf}>
                <TextInput style={s.modalInput} placeholder="テキスト（任意）" placeholderTextColor={C.muted} value={modal?.yesText ?? ''} onChangeText={(v) => setTextField('yesText', v)} />
              </View>
            </View>

            <Text style={s.modalSection}>いいえ側</Text>
            <View style={s.modalRow}>
              <View style={s.modalHalf}>
                <TextInput style={s.modalInput} placeholder="ラベル" placeholderTextColor={C.muted} value={modal?.noLabel ?? ''} onChangeText={(v) => setTextField('noLabel', v)} />
              </View>
              <View style={s.modalHalf}>
                <TextInput style={s.modalInput} placeholder="テキスト（任意）" placeholderTextColor={C.muted} value={modal?.noText ?? ''} onChangeText={(v) => setTextField('noText', v)} />
              </View>
            </View>

            <View style={s.modalActions}>
              <TouchableOpacity style={s.modalCancel} onPress={() => setModal(null)}>
                <Text style={s.modalCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalOk, modal?.afterTaskId === null && { opacity: 0.45 }]}
                onPress={saveBranch}
                disabled={modal?.afterTaskId === null}
              >
                <Text style={s.modalOkText}>保存</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <TabBar current="Flow" navigation={navigation} />
    </View>
  );
}
