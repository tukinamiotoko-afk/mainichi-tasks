import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar,
  Modal, TextInput, Animated, PanResponder, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import {
  Task, FlowBranch, getToday, getTasks, getCompletedTaskIds,
  markComplete, markIncomplete, updateTaskSortOrders, deleteTask,
  getFlowBranches, addFlowBranch, updateFlowBranch, deleteFlowBranch,
} from '../db/database';
import { isDueToday, WEEKDAYS } from '../constants/taskMeta';
import { GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';
import { useTheme, ColorSet } from '../contexts/ThemeContext';

const pad = (n: number) => String(n).padStart(2, '0');

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Flow'> };

type FlowNode =
  | { type: 'task'; task: Task; taskIdx: number }
  | { type: 'branch'; branch: FlowBranch };

type BranchModal = {
  mode: 'add' | 'edit';
  afterTaskId: number | null;
  editId: number | null;
  condition: string;
  stepText: string;
};

function buildNodes(tasks: Task[], branches: FlowBranch[]): FlowNode[] {
  const nodes: FlowNode[] = [];
  for (let i = 0; i < tasks.length; i++) {
    // 分岐はタスクの前に置く（条件を確認してからタスクを実行）
    branches
      .filter((b) => b.after_task_id === tasks[i].id)
      .forEach((b) => nodes.push({ type: 'branch', branch: b }));
    nodes.push({ type: 'task', task: tasks[i], taskIdx: i });
  }
  return nodes;
}

function Down({ color = '#64748b', h = 22 }: { color?: string; h?: number }) {
  return (
    <View style={{ alignItems: 'center' }} pointerEvents="none">
      <View style={{ width: 2, height: h, backgroundColor: color }} />
      <View style={{ width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 9, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: color, marginTop: -1 }} />
    </View>
  );
}

const makeStyles = (C: ColorSet) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  navArrow: { color: '#ffffff', fontSize: 24, fontWeight: '800', marginTop: -2 },
  navCenter: { flex: 1, alignItems: 'center' },
  navDateText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  navTodayHint: { color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '700', marginTop: 1 },
  navRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addBranchBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  addBranchBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '900' },

  body: { flex: 1, backgroundColor: C.body },
  content: { padding: 16, paddingBottom: 60, alignItems: 'center' },

  // terminators
  terminator: { backgroundColor: C.termBg, borderWidth: 1.5, borderColor: C.termBorder, borderRadius: 22, paddingHorizontal: 30, paddingVertical: 10 },
  terminatorText: { color: C.termText, fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  terminatorDone: { backgroundColor: C.doneBg, borderColor: C.doneBorder },
  terminatorDoneText: { color: '#ffffff' },

  // task process box
  stepWrap: { alignItems: 'center', width: '100%' },
  process: {
    flexDirection: 'row', alignItems: 'stretch',
    width: '92%', backgroundColor: C.termBg,
    borderWidth: 1.5, borderColor: C.termBorder, borderRadius: 8, overflow: 'hidden',
  },
  processDone: { backgroundColor: C.successBg, borderColor: C.doneBorder },
  processDragging: {
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2, shadowRadius: 12, elevation: 12,
    borderColor: C.primary,
  },
  dragHandleArea: {
    paddingHorizontal: 10, paddingVertical: 14,
    backgroundColor: C.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  dragHandleText: { color: C.primary, fontSize: 14 },
  processContent: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 12, gap: 8,
  },
  processText: { flex: 1, color: C.procText, fontSize: 13, fontWeight: '700' },
  processTextDone: { color: '#166534', textDecorationLine: 'line-through' },
  processCheck: { color: C.doneBg, fontSize: 16, fontWeight: '900' },
  nodeDeleteBtn: {
    paddingHorizontal: 10, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  nodeDeleteText: { color: C.muted, fontSize: 20, fontWeight: '300', lineHeight: 22 },

  // branch diamond
  diamondWrap: { alignItems: 'center', position: 'relative' },
  diamond: {
    width: 96, height: 96, borderRadius: 8,
    borderWidth: 1.5, borderColor: '#7c3aed', backgroundColor: '#ede9fe',
    alignItems: 'center', justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
  },
  diamondInner: { width: 140, alignItems: 'center', transform: [{ rotate: '-45deg' }] },
  diamondText: { color: '#4c1d95', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  diamondBadge: { color: '#7c3aed', fontSize: 10, fontWeight: '700', marginTop: 2 },
  branchDeleteBubble: {
    position: 'absolute', top: 2, right: 2,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#fef2f2', borderWidth: 1.5, borderColor: '#fca5a5',
    alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },
  branchDeleteBubbleText: { color: '#dc2626', fontSize: 13, fontWeight: '900', lineHeight: 16 },

  // branch split row
  branchRow: { flexDirection: 'row', width: '100%', marginTop: 2 },
  branchCol: { flex: 1, alignItems: 'center' },
  branchLabel: { fontSize: 12, fontWeight: '800', marginBottom: -2 },
  outBoxYes: { backgroundColor: '#f0fdf4', borderWidth: 1.5, borderColor: '#86efac', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, minWidth: 88, alignItems: 'center' },
  outYesText: { color: '#166534', fontSize: 13, fontWeight: '800' },
  skipLine: { width: 2, height: 36, backgroundColor: '#cbd5e1', marginVertical: 4 },
  mergeRailWrap: { width: '50%', alignItems: 'center', marginTop: 12 },
  mergeRail: { width: '100%', height: 2, backgroundColor: C.line },
  returnLabel: { color: C.muted, fontSize: 11, fontWeight: '700', marginTop: 3 },

  // all-done diamond
  finDiamond: {
    width: 96, height: 96, borderRadius: 8,
    borderWidth: 1.5, borderColor: C.diaBorder, backgroundColor: C.diaBg,
    alignItems: 'center', justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
  },
  finDiamondDone: { backgroundColor: '#86efac' },
  finDiamondInner: { width: 140, alignItems: 'center', transform: [{ rotate: '-45deg' }] },
  finDiamondText: { color: C.diaText, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  finDiamondTextDone: { color: '#14532d' },
  outBox: { backgroundColor: C.termBg, borderWidth: 1.5, borderColor: C.termBorder, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8, minWidth: 92, alignItems: 'center' },
  outBoxDone: { backgroundColor: C.doneBg, borderColor: C.doneBorder },
  outBoxNo: { backgroundColor: '#fef3c7', borderColor: '#d97706' },
  outText: { color: C.termText, fontSize: 13, fontWeight: '800' },
  outTextDone: { color: '#ffffff' },
  outNoText: { color: '#92400e', fontSize: 13, fontWeight: '800' },

  // modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10 },
  sheetTitle: { color: C.ink, fontSize: 16, fontWeight: '800', marginBottom: 2 },
  sheetLabel: { color: C.muted, fontSize: 11, fontWeight: '700', marginTop: 4, marginBottom: 2 },
  input: { borderWidth: 1.5, borderColor: C.grid, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: C.ink, fontSize: 14, backgroundColor: C.body },
  // task picker button (in branch modal)
  taskPickerBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: C.grid, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: C.body },
  taskPickerBtnText: { flex: 1, color: C.ink, fontSize: 14, fontWeight: '600' },
  taskPickerBtnArrow: { color: C.muted, fontSize: 20, marginLeft: 8 },

  // task select full-screen modal
  taskSelectHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.grid, gap: 12 },
  taskSelectBack: { paddingRight: 8 },
  taskSelectBackText: { color: C.primary, fontSize: 17, fontWeight: '700' },
  taskSelectTitle: { flex: 1, color: C.ink, fontSize: 16, fontWeight: '800' },
  taskSelectRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.grid, gap: 14 },
  taskSelectRowActive: { backgroundColor: '#ede9fe' },
  taskSelectNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  taskSelectNumText: { color: C.primary, fontSize: 12, fontWeight: '800' },
  taskSelectText: { flex: 1, color: C.ink, fontSize: 15, fontWeight: '600' },
  taskSelectTextActive: { color: '#4c1d95', fontWeight: '700' },
  taskSelectCheck: { color: '#7c3aed', fontSize: 16 },

  // side toggle
  sideRow: { flexDirection: 'row', gap: 8 },
  sideBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: C.border, alignItems: 'center' },
  sideBtnActive: { backgroundColor: '#ede9fe', borderColor: '#7c3aed' },
  sideBtnText: { color: C.muted, fontSize: 13, fontWeight: '700' },
  sideBtnTextActive: { color: '#4c1d95', fontSize: 13, fontWeight: '700' },
  // picker
  pickerScroll: { marginVertical: 2 },
  pickerChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: C.body, borderWidth: 1.5, borderColor: C.border, marginRight: 8 },
  pickerChipActive: { backgroundColor: '#ede9fe', borderColor: '#7c3aed' },
  pickerChipText: { color: C.muted, fontSize: 12, fontWeight: '700' },
  pickerChipTextActive: { color: '#4c1d95', fontSize: 12, fontWeight: '700' },
  // actions
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: C.grid, alignItems: 'center' },
  cancelText: { color: C.muted, fontSize: 14, fontWeight: '700' },
  saveBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#7c3aed', alignItems: 'center' },
  saveText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  deleteSheetBtn: { paddingVertical: 12, borderRadius: 10, backgroundColor: '#fef2f2', borderWidth: 1.5, borderColor: '#fca5a5', alignItems: 'center' },
  deleteSheetText: { color: '#dc2626', fontSize: 14, fontWeight: '700' },

  empty: { paddingVertical: 60, alignItems: 'center', gap: 8 },
  emptyTitle: { color: C.ink, fontSize: 16, fontWeight: '700' },
  emptyBody: { color: C.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },

  // canvas reset button
  resetBtn: {
    position: 'absolute', right: 16, bottom: 80,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15, shadowRadius: 6, elevation: 4,
  },
  resetBtnText: { color: C.ink, fontSize: 20 },
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
  const [modal, setModal] = useState<BranchModal | null>(null);
  const [taskSelectVisible, setTaskSelectVisible] = useState(false);

  // ── task drag state ──
  const taskDragY = useRef(new Animated.Value(0)).current;
  const taskDragScale = useRef(new Animated.Value(1)).current;
  const [activeDragId, setActiveDragId] = useState<number | null>(null);
  const activeDragIdRef = useRef<number | null>(null);
  const taskDragState = useRef({ startIdx: 0, currentIdx: 0, changed: false });
  const taskDyRef = useRef(0);
  const taskShiftAnims = useRef<Animated.Value[]>([]);
  const taskSlotRef = useRef(72);
  const taskYsByIdx = useRef<number[]>([]);
  const taskPanMap = useRef<Map<number, ReturnType<typeof PanResponder.create>>>(new Map());
  const orderedRef = useRef<Task[]>([]);

  // ── branch stamp drag state ──
  const branchDragAnims = useRef<Map<number, Animated.Value>>(new Map());
  const [activeBranchDragId, setActiveBranchDragId] = useState<number | null>(null);
  const activeBranchDragIdRef = useRef<number | null>(null);
  const branchPanMap = useRef<Map<number, ReturnType<typeof PanResponder.create>>>(new Map());
  const branchYsById = useRef<Map<number, number>>(new Map());
  const taskYsById = useRef<Map<number, number>>(new Map());
  const branchesRef = useRef<FlowBranch[]>([]);

  branchesRef.current = branches;

  // ── canvas pan / zoom state ──
  const canvasXAnim = useRef(new Animated.Value(0)).current;
  const canvasYAnim = useRef(new Animated.Value(0)).current;
  const canvasScaleAnim = useRef(new Animated.Value(1)).current;
  const canvasXRef = useRef(0);
  const canvasYRef = useRef(0);
  const canvasScaleRef = useRef(1);
  const canvasPanStart = useRef({ x: 0, y: 0 });
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);
  const pinchModeRef = useRef(false);
  const [canvasMoved, setCanvasMoved] = useState(false);

  useEffect(() => {
    const id1 = canvasXAnim.addListener(({ value }) => { canvasXRef.current = value; });
    const id2 = canvasYAnim.addListener(({ value }) => { canvasYRef.current = value; });
    const id3 = canvasScaleAnim.addListener(({ value }) => { canvasScaleRef.current = value; });
    return () => {
      canvasXAnim.removeListener(id1);
      canvasYAnim.removeListener(id2);
      canvasScaleAnim.removeListener(id3);
    };
  }, []);

  const getBranchAnim = (id: number) => {
    if (!branchDragAnims.current.has(id)) branchDragAnims.current.set(id, new Animated.Value(0));
    return branchDragAnims.current.get(id)!;
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
      getTasks(db), getCompletedTaskIds(db, selectedDate), getFlowBranches(db),
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
    const at = a.scheduled_time ?? '99:99', bt = b.scheduled_time ?? '99:99';
    if (at !== bt) return at < bt ? -1 : 1;
    return a.sort_order - b.sort_order;
  });
  orderedRef.current = ordered;

  const allDone = due.length > 0 && due.every((t) => completedIds.has(t.id));
  const remaining = due.filter((t) => !completedIds.has(t.id)).length;

  const dueIds = useMemo(() => new Set(ordered.map((t) => t.id)), [ordered]);
  const flowNodes = useMemo(
    () => buildNodes(ordered, branches.filter((b) => b.after_task_id !== null && dueIds.has(b.after_task_id!))),
    [ordered, branches, dueIds],
  );

  // sync shift anims length
  while (taskShiftAnims.current.length < ordered.length) taskShiftAnims.current.push(new Animated.Value(0));
  if (taskShiftAnims.current.length > ordered.length) taskShiftAnims.current = taskShiftAnims.current.slice(0, ordered.length);

  // ── task pan responder factory ──
  const getTaskPan = (taskId: number) => {
    if (!taskPanMap.current.has(taskId)) {
      taskPanMap.current.set(taskId, PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, { dy }) => Math.abs(dy) > 3,
        onPanResponderGrant: () => {
          const idx = orderedRef.current.findIndex((t) => t.id === taskId);
          taskDragState.current = { startIdx: idx, currentIdx: idx, changed: false };
          taskDyRef.current = 0;
          taskDragY.setValue(0);
          taskDragScale.setValue(1.04);
          taskShiftAnims.current.forEach((a) => a.setValue(0));
          activeDragIdRef.current = taskId;
          setActiveDragId(taskId);
          // compute slot from measured y positions
          const y0 = taskYsByIdx.current[idx];
          const y1 = taskYsByIdx.current[idx + 1] ?? taskYsByIdx.current[idx - 1];
          if (y0 !== undefined && y1 !== undefined && Math.abs(y1 - y0) > 40) {
            taskSlotRef.current = Math.abs(y1 - y0);
          }
        },
        onPanResponderMove: (_, { dy }) => {
          const cdy = dy / canvasScaleRef.current;
          taskDragY.setValue(cdy);
          taskDyRef.current = cdy;
          const { startIdx } = taskDragState.current;
          const n = orderedRef.current.length;
          const slot = taskSlotRef.current;
          const newIdx = Math.max(0, Math.min(n - 1, startIdx + Math.round(cdy / slot)));
          if (newIdx !== taskDragState.current.currentIdx) {
            taskDragState.current.currentIdx = newIdx;
            taskDragState.current.changed = newIdx !== startIdx;
            taskShiftAnims.current.forEach((anim, i) => {
              if (i === startIdx) return;
              let shift = 0;
              if (newIdx > startIdx && i > startIdx && i <= newIdx) shift = -slot;
              else if (newIdx < startIdx && i < startIdx && i >= newIdx) shift = slot;
              anim.setValue(shift);
            });
          }
        },
        onPanResponderRelease: () => {
          const { startIdx, currentIdx, changed } = taskDragState.current;
          const dy = taskDyRef.current;
          let pendingOrdered: Task[] | null = null;
          if (changed) {
            const arr = [...orderedRef.current];
            const [item] = arr.splice(startIdx, 1);
            arr.splice(currentIdx, 0, item);
            pendingOrdered = arr;
            updateTaskSortOrders(db, arr.map((t) => t.id));
          }
          const targetDy = (currentIdx - startIdx) * taskSlotRef.current;
          taskDragY.setValue(dy);
          const po = pendingOrdered;
          Animated.parallel([
            Animated.spring(taskDragY, { toValue: targetDy, useNativeDriver: true, tension: 220, friction: 14 }),
            Animated.spring(taskDragScale, { toValue: 1, useNativeDriver: true, tension: 220, friction: 14 }),
          ]).start(({ finished }) => {
            if (!finished) return;
            taskShiftAnims.current.forEach((a) => a.setValue(0));
            taskDragY.setValue(0);
            activeDragIdRef.current = null;
            setActiveDragId(null);
            if (po) {
              setTasks((prev) => {
                const next = [...prev];
                po.forEach((t, i) => {
                  const idx = next.findIndex((x) => x.id === t.id);
                  if (idx >= 0) next[idx] = { ...next[idx], sort_order: i };
                });
                return next;
              });
            }
          });
        },
        onPanResponderTerminate: () => {
          taskShiftAnims.current.forEach((a) => a.setValue(0));
          taskDragY.setValue(0);
          taskDragScale.setValue(1);
          activeDragIdRef.current = null;
          setActiveDragId(null);
        },
      }));
    }
    return taskPanMap.current.get(taskId)!;
  };

  // ── branch stamp pan responder factory ──
  const getBranchPan = (branchId: number) => {
    if (!branchPanMap.current.has(branchId)) {
      branchPanMap.current.set(branchId, PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, { dy }) => Math.abs(dy) > 6,
        onPanResponderGrant: () => {
          getBranchAnim(branchId).setValue(0);
          activeBranchDragIdRef.current = branchId;
          setActiveBranchDragId(branchId);
        },
        onPanResponderMove: (_, { dy }) => {
          getBranchAnim(branchId).setValue(dy / canvasScaleRef.current);
        },
        onPanResponderRelease: (_, { dy }) => {
          const branchInitialY = branchYsById.current.get(branchId) ?? 0;
          const targetY = branchInitialY + dy / canvasScaleRef.current;
          // find which task node is immediately above targetY
          let anchorId: number | null = null;
          let bestY = -Infinity;
          for (const [tid, ty] of taskYsById.current.entries()) {
            if (ty <= targetY && ty > bestY) { bestY = ty; anchorId = tid; }
          }
          // animate back to 0
          Animated.spring(getBranchAnim(branchId), { toValue: 0, useNativeDriver: true, tension: 220, friction: 14 }).start(() => {
            getBranchAnim(branchId).setValue(0);
          });
          activeBranchDragIdRef.current = null;
          setActiveBranchDragId(null);
          if (anchorId !== null) {
            const br = branchesRef.current.find((b) => b.id === branchId);
            if (br && anchorId !== br.after_task_id) {
              updateFlowBranch(db, branchId, { ...br, after_task_id: anchorId });
              load();
            }
          }
        },
        onPanResponderTerminate: () => {
          getBranchAnim(branchId).setValue(0);
          activeBranchDragIdRef.current = null;
          setActiveBranchDragId(null);
        },
      }));
    }
    return branchPanMap.current.get(branchId)!;
  };

  // ── canvas PanResponder ──
  const canvasPanRef = useRef<ReturnType<typeof PanResponder.create> | null>(null);
  if (!canvasPanRef.current) {
    canvasPanRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, { dx, dy }) => {
        if (activeDragIdRef.current !== null || activeBranchDragIdRef.current !== null) return false;
        return Math.abs(dx) > 4 || Math.abs(dy) > 4;
      },
      onPanResponderGrant: () => {
        canvasPanStart.current = { x: canvasXRef.current, y: canvasYRef.current };
        pinchModeRef.current = false;
      },
      onPanResponderMove: (evt, { dx, dy }) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          pinchModeRef.current = true;
          const t0 = touches[0], t1 = touches[1];
          const dist = Math.hypot(t0.pageX - t1.pageX, t0.pageY - t1.pageY);
          if (!pinchRef.current) {
            pinchRef.current = { dist, scale: canvasScaleRef.current };
          } else {
            const s = Math.max(0.3, Math.min(3, pinchRef.current.scale * dist / pinchRef.current.dist));
            canvasScaleRef.current = s;
            canvasScaleAnim.setValue(s);
          }
        } else if (!pinchModeRef.current) {
          pinchRef.current = null;
          canvasXAnim.setValue(canvasPanStart.current.x + dx);
          canvasYAnim.setValue(canvasPanStart.current.y + dy);
        }
      },
      onPanResponderRelease: (_, { dx, dy, vx, vy }) => {
        pinchRef.current = null;
        if (!pinchModeRef.current) {
          const finalX = canvasPanStart.current.x + dx;
          const finalY = canvasPanStart.current.y + dy;
          canvasXRef.current = finalX;
          canvasYRef.current = finalY;
          Animated.parallel([
            Animated.decay(canvasXAnim, { velocity: vx, deceleration: 0.995, useNativeDriver: false }),
            Animated.decay(canvasYAnim, { velocity: vy, deceleration: 0.995, useNativeDriver: false }),
          ]).start();
        }
        pinchModeRef.current = false;
        setCanvasMoved(true);
      },
      onPanResponderTerminate: () => {
        pinchRef.current = null;
        pinchModeRef.current = false;
      },
    });
  }

  const resetCanvas = useCallback(() => {
    Animated.parallel([
      Animated.spring(canvasXAnim, { toValue: 0, useNativeDriver: false, tension: 120, friction: 12 }),
      Animated.spring(canvasYAnim, { toValue: 0, useNativeDriver: false, tension: 120, friction: 12 }),
      Animated.spring(canvasScaleAnim, { toValue: 1, useNativeDriver: false, tension: 120, friction: 12 }),
    ]).start(() => {
      canvasXRef.current = 0;
      canvasYRef.current = 0;
      canvasScaleRef.current = 1;
      setCanvasMoved(false);
    });
  }, []);

  // ── branch modal helpers ──
  const openAddBranch = (_afterTaskId: number | null = null) => {
    setModal({ mode: 'add', afterTaskId: ordered[0]?.id ?? null, editId: null, condition: '', stepText: '' });
  };

  const openEditBranch = (br: FlowBranch) => {
    setModal({ mode: 'edit', afterTaskId: br.after_task_id, editId: br.id, condition: br.question, stepText: br.yes_text ?? '' });
  };

  const saveBranch = async () => {
    if (!modal || modal.afterTaskId === null) return;
    const data: Omit<FlowBranch, 'id'> = {
      after_task_id: modal.afterTaskId,
      question: modal.condition.trim() || '条件',
      yes_label: 'する',
      yes_text: modal.stepText.trim() || null,
      no_label: 'スキップ',
      no_text: null,
      branch_side: 'left',
    };
    if (modal.mode === 'add') await addFlowBranch(db, data);
    else if (modal.editId !== null) await updateFlowBranch(db, modal.editId, data);
    setModal(null);
    load();
  };

  const removeBranch = async (id: number) => {
    await deleteFlowBranch(db, id);
    setModal(null);
    load();
  };

  const confirmDeleteTask = (task: Task) => {
    Alert.alert('タスクを削除', `「${task.title}」を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: async () => { await deleteTask(db, task.id); load(); } },
    ]);
  };

  // ── render task node ──
  const renderTask = (node: Extract<FlowNode, { type: 'task' }>) => {
    const { task, taskIdx } = node;
    const isDone = completedIds.has(task.id);
    const isActive = activeDragId === task.id;
    const pan = getTaskPan(task.id);
    const animStyle = isActive
      ? { transform: [{ translateY: taskDragY }, { scale: taskDragScale }], zIndex: 99 }
      : { transform: [{ translateY: taskShiftAnims.current[taskIdx] ?? new Animated.Value(0) }] };

    return (
      <View
        key={`task-${task.id}`}
        style={s.stepWrap}
        onLayout={(e) => {
          taskYsByIdx.current[taskIdx] = e.nativeEvent.layout.y;
          taskYsById.current.set(task.id, e.nativeEvent.layout.y);
        }}
      >
        <Down color={isDone ? C.doneBg : C.line} />
        <Animated.View style={[s.process, isDone && s.processDone, animStyle, isActive && s.processDragging]}>
          {/* drag handle */}
          <View {...pan.panHandlers} style={s.dragHandleArea}>
            <Text style={s.dragHandleText}>☰</Text>
          </View>
          {/* content: tap to toggle */}
          <TouchableOpacity style={s.processContent} onPress={() => toggle(task.id)} activeOpacity={0.7}>
            <Text style={[s.processText, isDone && s.processTextDone]} numberOfLines={2}>
              {task.icon ? `${task.icon} ` : ''}{task.title}
              {task.scheduled_time ? `  (${task.scheduled_time})` : ''}
            </Text>
            {isDone && <Text style={s.processCheck}>✓</Text>}
          </TouchableOpacity>
          {/* delete */}
          <TouchableOpacity style={s.nodeDeleteBtn} onPress={() => confirmDeleteTask(task)}>
            <Text style={s.nodeDeleteText}>×</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  };

  // ── render branch stamp ──
  const renderBranch = (node: Extract<FlowNode, { type: 'branch' }>) => {
    const { branch: br } = node;
    const side = br.branch_side ?? 'left';
    const isActiveBr = activeBranchDragId === br.id;
    const branchPan = getBranchPan(br.id);
    const branchAnim = getBranchAnim(br.id);

    const doCol = (
      <View style={s.branchCol}>
        <Text style={[s.branchLabel, { color: '#7c3aed' }]}>する</Text>
        <Down color={C.line} h={16} />
        {br.yes_text
          ? <View style={s.outBoxYes}><Text style={s.outYesText}>{br.yes_text}</Text></View>
          : null}
      </View>
    );
    const skipCol = (
      <View style={[s.branchCol, { justifyContent: 'flex-start' }]}>
        <Text style={[s.branchLabel, { color: C.muted }]}>スキップ</Text>
        <View style={s.skipLine} />
      </View>
    );

    return (
      <View
        key={`branch-${br.id}`}
        style={s.stepWrap}
        onLayout={(e) => { branchYsById.current.set(br.id, e.nativeEvent.layout.y); }}
      >
        <Down color={C.line} />
        <Animated.View
          style={[
            s.diamondWrap,
            isActiveBr && { zIndex: 99 },
            { transform: [{ translateY: branchAnim }] },
          ]}
        >
          {/* drag handle on diamond */}
          <View {...branchPan.panHandlers}>
            <TouchableOpacity style={s.diamond} onPress={() => openEditBranch(br)} activeOpacity={0.75}>
              <View style={s.diamondInner}>
                <Text style={s.diamondText} numberOfLines={3}>{br.question}</Text>
                <Text style={s.diamondBadge}>{side === 'left' ? '← する' : 'する →'}</Text>
              </View>
            </TouchableOpacity>
          </View>
          {/* delete bubble */}
          <TouchableOpacity style={s.branchDeleteBubble} onPress={() => removeBranch(br.id)}>
            <Text style={s.branchDeleteBubbleText}>×</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* branch split: tap row to edit */}
        <TouchableOpacity style={s.branchRow} onPress={() => openEditBranch(br)} activeOpacity={0.7}>
          {side === 'left' ? doCol : skipCol}
          {side === 'left' ? skipCol : doCol}
        </TouchableOpacity>

        {/* merge rail: tap to edit */}
        <TouchableOpacity style={s.mergeRailWrap} onPress={() => openEditBranch(br)} activeOpacity={0.7}>
          <View style={s.mergeRail} />
        </TouchableOpacity>
        <Text style={s.returnLabel}>本流に戻る</Text>
      </View>
    );
  };

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient colors={grad.header} start={GRAD_START} end={GRAD_END} style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={s.navRow}>
          <TouchableOpacity style={s.navBtn} onPress={() => shiftSelected(-1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.navArrow}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.navCenter} onPress={() => setSelectedDate(today)} activeOpacity={0.7}>
            <Text style={s.navDateText}>{dateLabel}</Text>
            {!isToday && <Text style={s.navTodayHint}>タップで今日へ</Text>}
          </TouchableOpacity>
          <View style={s.navRight}>
            <TouchableOpacity style={s.navBtn} onPress={() => shiftSelected(1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.navArrow}>›</Text>
            </TouchableOpacity>
            {due.length > 0 && (
              <TouchableOpacity style={s.addBranchBtn} onPress={() => openAddBranch(null)}>
                <Text style={s.addBranchBtnText}>◇</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </LinearGradient>

      <View style={[s.body, { overflow: 'hidden' }]} {...(canvasPanRef.current!.panHandlers)}>
        <Animated.View style={{ transform: [{ translateX: canvasXAnim }, { translateY: canvasYAnim }, { scale: canvasScaleAnim }] }}>
          <View style={s.content}>
            {due.length === 0 ? (
              <View style={s.empty}>
                <Text style={s.emptyTitle}>この日のフローはありません</Text>
                <Text style={s.emptyBody}>頻度がこの日に当たるタスクがワークフローになります</Text>
              </View>
            ) : (
              <>
                <View style={s.terminator}><Text style={s.terminatorText}>開始</Text></View>
                {flowNodes.map((node) =>
                  node.type === 'task' ? renderTask(node) : renderBranch(node),
                )}
                <Down color={allDone ? C.doneBg : C.line} />
                <View style={[s.finDiamond, allDone && s.finDiamondDone]}>
                  <View style={s.finDiamondInner}>
                    <Text style={[s.finDiamondText, allDone && s.finDiamondTextDone]}>全部{'\n'}完了?</Text>
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
                  <Text style={[s.terminatorText, allDone && s.terminatorDoneText]}>終了</Text>
                </View>
              </>
            )}
          </View>
        </Animated.View>
        {canvasMoved && (
          <TouchableOpacity style={s.resetBtn} onPress={resetCanvas}>
            <Text style={s.resetBtnText}>⌂</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── branch modal ── */}
      <Modal visible={modal !== null} transparent animationType="slide" onRequestClose={() => setModal(null)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setModal(null)}>
          <TouchableOpacity activeOpacity={1} style={s.sheet} onPress={() => {}}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" bounces={false}>
            <Text style={s.sheetTitle}>{modal?.mode === 'add' ? '◇ 分岐を追加' : '◇ 分岐を編集'}</Text>

            {/* どのタスクの前に入れるか — タップで全画面選択へ */}
            {(() => {
              const selected = ordered.find((t) => t.id === modal?.afterTaskId);
              return (
                <>
                  <Text style={s.sheetLabel}>どのタスクの前に入れる？</Text>
                  <TouchableOpacity style={s.taskPickerBtn} onPress={() => setTaskSelectVisible(true)}>
                    <Text style={s.taskPickerBtnText} numberOfLines={1}>
                      {selected ? `${selected.icon ? `${selected.icon} ` : ''}${selected.title}` : 'タスクを選ぶ'}
                    </Text>
                    <Text style={s.taskPickerBtnArrow}>›</Text>
                  </TouchableOpacity>
                </>
              );
            })()}

            <Text style={s.sheetLabel}>分岐する条件</Text>
            <TextInput
              style={s.input}
              placeholder="例：雨が降ってたら"
              placeholderTextColor={C.muted}
              value={modal?.condition ?? ''}
              onChangeText={(v) => setModal((m) => m ? { ...m, condition: v } : m)}
              returnKeyType="next"
            />

            <Text style={s.sheetLabel}>サブタスク（条件が成立したときにやること）</Text>
            <TextInput
              style={s.input}
              placeholder="例：傘を持っていく"
              placeholderTextColor={C.muted}
              value={modal?.stepText ?? ''}
              onChangeText={(v) => setModal((m) => m ? { ...m, stepText: v } : m)}
              returnKeyType="done"
            />

            <View style={s.actionRow}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setModal(null)}>
                <Text style={s.cancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.saveBtn}
                onPress={saveBranch}
              >
                <Text style={s.saveText}>保存</Text>
              </TouchableOpacity>
            </View>

            {modal?.mode === 'edit' && modal.editId !== null && (
              <TouchableOpacity style={s.deleteSheetBtn} onPress={() => removeBranch(modal.editId!)}>
                <Text style={s.deleteSheetText}>この分岐を削除</Text>
              </TouchableOpacity>
            )}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── task select screen ── */}
      <Modal visible={taskSelectVisible} transparent={false} animationType="slide" onRequestClose={() => setTaskSelectVisible(false)}>
        <View style={[s.safeArea, { paddingTop: insets.top }]}>
          <View style={s.taskSelectHeader}>
            <TouchableOpacity style={s.taskSelectBack} onPress={() => setTaskSelectVisible(false)}>
              <Text style={s.taskSelectBackText}>‹ 戻る</Text>
            </TouchableOpacity>
            <Text style={s.taskSelectTitle}>どのタスクの前に入れる？</Text>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>
            {ordered.map((t, i) => {
              const active = modal?.afterTaskId === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[s.taskSelectRow, active && s.taskSelectRowActive]}
                  onPress={() => {
                    setModal((m) => m ? { ...m, afterTaskId: t.id } : m);
                    setTaskSelectVisible(false);
                  }}
                >
                  <View style={s.taskSelectNum}>
                    <Text style={s.taskSelectNumText}>{i + 1}</Text>
                  </View>
                  <Text style={[s.taskSelectText, active && s.taskSelectTextActive]} numberOfLines={2}>
                    {t.icon ? `${t.icon} ` : ''}{t.title}
                  </Text>
                  {active && <Text style={s.taskSelectCheck}>●</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      <TabBar current="Flow" navigation={navigation} />
    </View>
  );
}
