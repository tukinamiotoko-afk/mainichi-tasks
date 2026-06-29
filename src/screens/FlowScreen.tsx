import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar, Modal,
  Animated, PanResponder, Platform, TextInput,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import { Task, getToday, getTasks, updateTaskSortOrders, getFlowBranches, addFlowBranch, updateFlowBranch, deleteFlowBranch } from '../db/database';
import { isDueToday, WEEKDAYS } from '../constants/taskMeta';
import { GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';
import { useTheme, ColorSet } from '../contexts/ThemeContext';

const pad = (n: number) => String(n).padStart(2, '0');
type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Flow'> };
type BranchNode = { id: number | null; insertAfterIdx: number; question: string; yesIds: number[]; noIds: number[] };

function ArrowDown({ color, h = 18 }: { color: string; h?: number }) {
  return (
    <View style={{ alignItems: 'center', marginVertical: 2 }} pointerEvents="none">
      <View style={{ width: 2, height: h, backgroundColor: color }} />
      <View style={{ width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: color }} />
    </View>
  );
}

const makeStyles = (C: ColorSet) => StyleSheet.create({
  root: { flex: 1, backgroundColor: C.body },

  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  navArrow: { color: '#ffffff', fontSize: 24, fontWeight: '800', marginTop: -2 },
  navCenter: { flex: 1, alignItems: 'center' },
  navDateText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  navTodayHint: { color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '700', marginTop: 1 },
  navRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)' },
  editBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  saveBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.9)' },
  saveBtnText: { color: '#7c3aed', fontSize: 13, fontWeight: '900' },

  flowScroll: { flex: 1 },

  // ── view mode (compact) ──
  viewContent: { alignItems: 'center', paddingTop: 20, paddingBottom: 24, paddingHorizontal: 40 },
  viewTerminator: { backgroundColor: C.termBg, borderWidth: 1.5, borderColor: C.termBorder, borderRadius: 18, paddingHorizontal: 22, paddingVertical: 7 },
  viewTerminatorText: { color: C.termText, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  viewSlotWrap: { width: '100%' },
  viewSlot: { width: '100%', minHeight: 44, borderWidth: 1.5, borderRadius: 10, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderColor: C.termBorder, backgroundColor: C.termBg },
  viewSlotEmpty: { borderColor: C.border, borderStyle: 'dashed', backgroundColor: C.card },
  viewSlotNum: { width: 20, height: 20, borderRadius: 10, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 8, flexShrink: 0 },
  viewSlotNumText: { color: C.primary, fontSize: 10, fontWeight: '800' },
  viewSlotText: { flex: 1, color: C.ink, fontSize: 13, fontWeight: '700' },
  viewSlotEmptyText: { flex: 1, color: C.muted, fontSize: 12 },

  // ── edit mode (full size) ──
  editContent: { alignItems: 'center', paddingTop: 24, paddingBottom: 24, paddingHorizontal: 24 },
  terminator: { backgroundColor: C.termBg, borderWidth: 1.5, borderColor: C.termBorder, borderRadius: 22, paddingHorizontal: 30, paddingVertical: 10 },
  terminatorText: { color: C.termText, fontSize: 14, fontWeight: '800', letterSpacing: 1 },

  slotWrap: { width: '100%', overflow: 'visible' },
  slotBase: { width: '100%', minHeight: 60, borderWidth: 2, borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  slotEmpty: { borderColor: C.border, borderStyle: 'dashed', backgroundColor: C.card },
  slotTarget: { borderColor: '#7c3aed', borderStyle: 'solid', backgroundColor: '#ede9fe' },
  slotFilled: { borderColor: C.termBorder, borderStyle: 'solid', backgroundColor: C.termBg },
  slotFilledTarget: { borderColor: '#7c3aed', borderStyle: 'solid', backgroundColor: C.termBg },
  slotDragging: { opacity: 0.55, borderColor: '#7c3aed', borderStyle: 'dashed' },
  slotNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 10, flexShrink: 0 },
  slotNumText: { color: C.primary, fontSize: 12, fontWeight: '800' },
  slotEmptyText: { flex: 1, color: C.muted, fontSize: 13 },
  slotCardArea: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  slotCardText: { flex: 1, color: C.ink, fontSize: 14, fontWeight: '700' },
  slotRemoveBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fca5a5', alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  slotRemoveText: { color: '#dc2626', fontSize: 16, fontWeight: '700', lineHeight: 20 },
  dragHandle: { paddingHorizontal: 8, paddingVertical: 10, marginLeft: -4, marginRight: 4 },
  dragHandleText: { color: C.muted, fontSize: 16 },

  emptyFlow: { paddingTop: 60, alignItems: 'center', gap: 10 },
  emptyTitle: { color: C.ink, fontSize: 16, fontWeight: '700' },
  emptyBody: { color: C.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
  addFirstBtn: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, backgroundColor: '#7c3aed' },
  addFirstBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },

  tray: { borderTopWidth: 1, borderTopColor: C.grid, backgroundColor: C.card, paddingVertical: 10 },
  trayHint: { color: '#7c3aed', fontSize: 11, fontWeight: '700', paddingHorizontal: 16, marginBottom: 6 },
  trayLabel: { color: C.muted, fontSize: 11, fontWeight: '700', paddingHorizontal: 16, marginBottom: 6 },
  trayScroll: { paddingHorizontal: 12, paddingVertical: 2 },
  card: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: C.body, borderWidth: 1.5, borderColor: C.border, marginHorizontal: 4, maxWidth: 150 },
  cardSelected: { borderColor: '#7c3aed', backgroundColor: '#ede9fe' },
  cardText: { color: C.ink, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  cardTextSelected: { color: '#4c1d95' },
  addBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: '#7c3aed', marginHorizontal: 4 },
  addBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },

  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  pickerSheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '75%' },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.grid },
  pickerTitle: { flex: 1, color: C.ink, fontSize: 16, fontWeight: '800' },
  pickerDone: { color: '#7c3aed', fontSize: 15, fontWeight: '800' },
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.grid, gap: 14 },
  pickerRowAdded: { backgroundColor: '#ede9fe' },
  pickerRowText: { flex: 1, color: C.ink, fontSize: 15, fontWeight: '600' },
  pickerRowTextAdded: { color: '#4c1d95', fontWeight: '700' },
  pickerCheck: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  pickerCheckOn: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  pickerCheckText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  pickerEmpty: { padding: 40, alignItems: 'center' },
  pickerEmptyText: { color: C.muted, fontSize: 14 },

  editCard: { marginTop: 20, width: '100%', paddingVertical: 16, borderRadius: 14, borderWidth: 1.5, borderColor: C.primary, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  editCardText: { color: C.primary, fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  datePickerSheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 24 },

  // ── branch button in header ──
  branchBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)' },
  branchBtnText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
  branchBtnActive: { backgroundColor: 'rgba(255,237,213,0.9)' },
  branchBtnActiveText: { color: '#c2410c', fontSize: 11, fontWeight: '900' },

  // ── branch insertion slot ──
  insertSlot: { width: '100%', paddingVertical: 9, borderWidth: 1.5, borderColor: '#fb923c', borderStyle: 'dashed', borderRadius: 10, alignItems: 'center', backgroundColor: '#fff7ed' },
  insertSlotText: { color: '#c2410c', fontSize: 12, fontWeight: '700' },
  gapWrap: { width: '100%' },

  // ── branch node (edit) ──
  branchNode: { width: '100%', borderWidth: 2, borderRadius: 12, borderColor: '#d97706', backgroundColor: '#fffbeb', padding: 12 },
  branchNodeHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 6 },
  branchNodeQ: { flex: 1, color: '#78350f', fontSize: 13, fontWeight: '800' },
  branchNodeBtns: { flexDirection: 'row', gap: 6 },
  branchEditBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#d97706' },
  branchEditBtnText: { color: '#92400e', fontSize: 11, fontWeight: '700' },
  branchDelBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fca5a5' },
  branchDelBtnText: { color: '#dc2626', fontSize: 13, fontWeight: '700', lineHeight: 16 },
  branchPath: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 2 },
  branchPathLabel: { color: '#92400e', fontSize: 11, fontWeight: '800', paddingTop: 3, minWidth: 30 },
  branchPathTasks: { flex: 1, gap: 3 },
  branchPathTask: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: '#d97706', backgroundColor: '#fff' },
  branchPathTaskText: { color: '#78350f', fontSize: 12, fontWeight: '600' },
  branchPathEmpty: { color: '#d97706', fontSize: 11, fontStyle: 'italic' },

  // ── branch node (view) ──
  viewBranch: { width: '100%', borderWidth: 1.5, borderRadius: 10, borderColor: '#d97706', backgroundColor: '#fffbeb', paddingHorizontal: 12, paddingVertical: 8 },
  viewBranchQ: { color: '#78350f', fontSize: 12, fontWeight: '800', marginBottom: 5 },
  viewBranchPath: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 2 },
  viewBranchLabel: { color: '#92400e', fontSize: 10, fontWeight: '800', paddingTop: 2, minWidth: 26 },
  viewBranchTask: { color: '#78350f', fontSize: 11, fontWeight: '600' },

  // ── branch editor modal ──
  branchEditorSheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%' },
  branchEditorSection: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
  branchEditorLabel: { color: C.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginBottom: 6 },
  branchEditorInput: { borderWidth: 1.5, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: C.ink, backgroundColor: C.body },
  branchTaskRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.grid, gap: 8 },
  branchTaskText: { flex: 1, color: C.ink, fontSize: 14, fontWeight: '600' },
  branchCheckY: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },
  branchCheckYOn: { backgroundColor: '#16a34a' },
  branchCheckN: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#dc2626', alignItems: 'center', justifyContent: 'center' },
  branchCheckNOn: { backgroundColor: '#dc2626' },
  branchCheckText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  branchCheckLabels: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  branchCheckLabelY: { color: '#15803d', fontSize: 10, fontWeight: '700', width: 28, textAlign: 'center' },
  branchCheckLabelN: { color: '#b91c1c', fontSize: 10, fontWeight: '700', width: 28, textAlign: 'center' },
  branchSaveBtn: { margin: 16, paddingVertical: 14, borderRadius: 12, backgroundColor: '#d97706', alignItems: 'center' },
  branchSaveBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
});

export default function FlowScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { C, grad } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const today = getToday();

  const [selectedDate, setSelectedDate] = useState(today);
  const [dueTasks, setDueTasks] = useState<Task[]>([]);
  const [addedIds, setAddedIds] = useState<number[]>([]);
  const [slots, setSlots] = useState<(number | null)[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [branches, setBranches] = useState<BranchNode[]>([]);
  const [insertBranchMode, setInsertBranchMode] = useState(false);
  const [branchEditorOpen, setBranchEditorOpen] = useState(false);
  const [branchDraft, setBranchDraft] = useState<BranchNode | null>(null);

  // ── drag-to-reorder state ──
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const draggingIdxRef = useRef<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const hoverIdxRef = useRef<number | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const dragScale = useRef(new Animated.Value(1)).current;
  const shiftAnims = useRef<Animated.Value[]>([]);
  const slotHRef = useRef(80);
  const slotsRef = useRef(slots);
  const panRespMap = useRef<Map<number, ReturnType<typeof PanResponder.create>>>(new Map());

  slotsRef.current = slots;

  while (shiftAnims.current.length < slots.length) shiftAnims.current.push(new Animated.Value(0));
  if (shiftAnims.current.length > slots.length) shiftAnims.current = shiftAnims.current.slice(0, slots.length);

  useEffect(() => { panRespMap.current.clear(); }, [slots.length]);

  const isToday = selectedDate === today;
  const selDateObj = useMemo(() => new Date(`${selectedDate}T00:00:00`), [selectedDate]);
  const dateLabel = `${selDateObj.getFullYear()}/${pad(selDateObj.getMonth() + 1)}/${pad(selDateObj.getDate())} (${WEEKDAYS[selDateObj.getDay()]})`;

  const shiftSelected = (days: number) => {
    const d = new Date(`${selectedDate}T00:00:00`);
    d.setDate(d.getDate() + days);
    setSelectedDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  };

  const load = useCallback(async () => {
    const ts = await getTasks(db);
    const due = ts.filter(t => isDueToday(t, new Date(`${selectedDate}T00:00:00`)));
    const sorted = [...due].sort((a, b) =>
      a.sort_order !== b.sort_order ? a.sort_order - b.sort_order : a.id - b.id
    );
    setDueTasks(due);
    const ids = sorted.map(t => t.id);
    setAddedIds(ids);
    setSlots([...ids]);
    setSelectedCardId(null);
    setIsEditing(false);
    setInsertBranchMode(false);
    panRespMap.current.clear();
    const branchRows = await getFlowBranches(db);
    setBranches(branchRows.map(b => ({
      id: b.id,
      insertAfterIdx: b.after_task_id ?? -1,
      question: b.question,
      yesIds: b.yes_text ? (JSON.parse(b.yes_text) as number[]) : [],
      noIds: b.no_text ? (JSON.parse(b.no_text) as number[]) : [],
    })));
  }, [db, selectedDate]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const taskById = useMemo(() => new Map(dueTasks.map(t => [t.id, t])), [dueTasks]);
  const tray = useMemo(() => addedIds.filter(id => !slots.includes(id)), [addedIds, slots]);
  const hasSelection = selectedCardId !== null;

  const getSlotPan = useCallback((slotIdx: number) => {
    if (panRespMap.current.has(slotIdx)) return panRespMap.current.get(slotIdx)!;

    const pan = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => Math.abs(dy) > 5,
      onPanResponderGrant: () => {
        draggingIdxRef.current = slotIdx;
        setDraggingIdx(slotIdx);
        hoverIdxRef.current = slotIdx;
        setHoverIdx(slotIdx);
        dragY.setValue(0);
        dragScale.setValue(1.04);
        shiftAnims.current.forEach(a => a.setValue(0));
      },
      onPanResponderMove: (_, { dy }) => {
        dragY.setValue(dy);
        const n = slotsRef.current.length;
        const slotH = slotHRef.current;
        const newHover = Math.max(0, Math.min(n - 1, slotIdx + Math.round(dy / slotH)));
        if (newHover !== hoverIdxRef.current) {
          hoverIdxRef.current = newHover;
          setHoverIdx(newHover);
          shiftAnims.current.forEach((anim, i) => {
            if (i === slotIdx) return;
            let shift = 0;
            if (newHover > slotIdx && i > slotIdx && i <= newHover) shift = -slotH;
            else if (newHover < slotIdx && i < slotIdx && i >= newHover) shift = slotH;
            Animated.spring(anim, { toValue: shift, useNativeDriver: true, tension: 300, friction: 25 }).start();
          });
        }
      },
      onPanResponderRelease: (_, { dy }) => {
        const from = slotIdx;
        const n = slotsRef.current.length;
        const slotH = slotHRef.current;
        const to = Math.max(0, Math.min(n - 1, from + Math.round(dy / slotH)));
        const snapDy = (to - from) * slotH;

        Animated.parallel([
          Animated.spring(dragY, { toValue: snapDy, useNativeDriver: true, tension: 220, friction: 14 }),
          Animated.spring(dragScale, { toValue: 1, useNativeDriver: true, tension: 220, friction: 14 }),
          ...shiftAnims.current.map(a =>
            Animated.spring(a, { toValue: 0, useNativeDriver: true, tension: 220, friction: 14 })
          ),
        ]).start(() => {
          dragY.setValue(0);
          dragScale.setValue(1);
          shiftAnims.current.forEach(a => a.setValue(0));
          draggingIdxRef.current = null;
          hoverIdxRef.current = null;
          setDraggingIdx(null);
          setHoverIdx(null);
          if (from !== to) {
            panRespMap.current.clear();
            setSlots(prev => {
              const arr = [...prev];
              const [item] = arr.splice(from, 1);
              arr.splice(to, 0, item);
              return arr;
            });
          }
        });
      },
      onPanResponderTerminate: () => {
        dragY.setValue(0);
        dragScale.setValue(1);
        shiftAnims.current.forEach(a => a.setValue(0));
        draggingIdxRef.current = null;
        hoverIdxRef.current = null;
        setDraggingIdx(null);
        setHoverIdx(null);
      },
    });

    panRespMap.current.set(slotIdx, pan);
    return pan;
  }, []);

  const togglePicker = (id: number) => {
    if (addedIds.includes(id)) {
      setAddedIds(prev => prev.filter(x => x !== id));
      setSlots(prev => {
        const idx = prev.indexOf(id);
        if (idx >= 0) return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i] === null) return [...prev.slice(0, i), ...prev.slice(i + 1)];
        }
        return prev.slice(0, -1);
      });
      if (selectedCardId === id) setSelectedCardId(null);
    } else {
      setAddedIds(prev => [...prev, id]);
      setSlots(prev => [...prev, null]);
    }
  };

  const tapCard = (id: number) => {
    setSelectedCardId(prev => prev === id ? null : id);
  };

  const tapSlot = (idx: number) => {
    if (draggingIdxRef.current !== null) return;
    if (selectedCardId === null) return;
    setSlots(prev => prev.map((sv, i) => {
      if (i === idx) return selectedCardId;
      if (sv === selectedCardId) return null;
      return sv;
    }));
    setSelectedCardId(null);
  };

  const removeFromSlot = (idx: number) => {
    if (draggingIdxRef.current !== null) return;
    setSlots(prev => prev.map((sv, i) => i === idx ? null : sv));
  };

  const saveOrder = async () => {
    setSaving(true);
    try {
      const placedIds = slots.filter((id): id is number => id !== null);
      const trayIds = addedIds.filter(id => !slots.includes(id));
      await updateTaskSortOrders(db, [...placedIds, ...trayIds]);
      setIsEditing(false);
      setInsertBranchMode(false);
      setSelectedCardId(null);
    } finally {
      setSaving(false);
    }
  };

  const openBranchEditor = (afterIdx: number) => {
    setBranchDraft({ id: null, insertAfterIdx: afterIdx, question: '', yesIds: [], noIds: [] });
    setBranchEditorOpen(true);
  };
  const editBranch = (b: BranchNode) => { setBranchDraft({ ...b }); setBranchEditorOpen(true); };
  const deleteBranch = async (id: number) => {
    await deleteFlowBranch(db, id);
    setBranches(prev => prev.filter(b => b.id !== id));
  };
  const saveBranchDraft = async () => {
    if (!branchDraft) return;
    const data = {
      after_task_id: branchDraft.insertAfterIdx,
      question: branchDraft.question || '確認',
      yes_label: 'はい', yes_text: JSON.stringify(branchDraft.yesIds),
      no_label: 'いいえ', no_text: JSON.stringify(branchDraft.noIds),
      branch_side: 'left' as const,
    };
    if (branchDraft.id !== null) {
      await updateFlowBranch(db, branchDraft.id, data);
      setBranches(prev => prev.map(b => b.id === branchDraft!.id ? { ...branchDraft! } : b));
    } else {
      const newId = await addFlowBranch(db, data);
      setBranches(prev => [...prev, { ...branchDraft!, id: newId }]);
    }
    setBranchEditorOpen(false);
    setBranchDraft(null);
    setInsertBranchMode(false);
  };
  const toggleBranchY = (id: number) => setBranchDraft(p => p ? ({
    ...p, yesIds: p.yesIds.includes(id) ? p.yesIds.filter(x => x !== id) : [...p.yesIds, id],
  }) : p);
  const toggleBranchN = (id: number) => setBranchDraft(p => p ? ({
    ...p, noIds: p.noIds.includes(id) ? p.noIds.filter(x => x !== id) : [...p.noIds, id],
  }) : p);

  // ── branch rendering helpers ──
  const renderBranchViewNode = (b: BranchNode) => (
    <View key={`bv${b.id}`} style={s.viewBranch}>
      <Text style={s.viewBranchQ}>◇ {b.question || '確認'}</Text>
      {([['はい', b.yesIds], ['いいえ', b.noIds]] as [string, number[]][]).map(([lbl, ids]) => (
        <View key={lbl} style={s.viewBranchPath}>
          <Text style={s.viewBranchLabel}>{lbl}</Text>
          <View style={{ flex: 1 }}>
            {ids.length === 0
              ? <Text style={s.viewBranchTask}>—</Text>
              : ids.map(id => { const t = taskById.get(id); return t ? <Text key={id} style={s.viewBranchTask} numberOfLines={1}>{t.icon ? `${t.icon} ` : ''}{t.title}</Text> : null; })}
          </View>
        </View>
      ))}
    </View>
  );

  const renderBranchEditNode = (b: BranchNode) => (
    <View key={`be${b.id}`} style={s.branchNode}>
      <View style={s.branchNodeHeader}>
        <Text style={s.branchNodeQ}>◇ {b.question || '確認'}</Text>
        <View style={s.branchNodeBtns}>
          <TouchableOpacity style={s.branchEditBtn} onPress={() => editBranch(b)}>
            <Text style={s.branchEditBtnText}>編集</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.branchDelBtn} onPress={() => b.id !== null && deleteBranch(b.id)}>
            <Text style={s.branchDelBtnText}>×</Text>
          </TouchableOpacity>
        </View>
      </View>
      {([['はい', b.yesIds], ['いいえ', b.noIds]] as [string, number[]][]).map(([lbl, ids]) => (
        <View key={lbl} style={s.branchPath}>
          <Text style={s.branchPathLabel}>{lbl}</Text>
          <View style={s.branchPathTasks}>
            {ids.length === 0
              ? <Text style={s.branchPathEmpty}>タスクなし</Text>
              : ids.map(id => { const t = taskById.get(id); return t ? (
                <View key={id} style={s.branchPathTask}>
                  <Text style={s.branchPathTaskText} numberOfLines={1}>{t.icon ? `${t.icon} ` : ''}{t.title}</Text>
                </View>
              ) : null; })}
          </View>
        </View>
      ))}
    </View>
  );

  const renderGap = (afterIdx: number) => {
    const here = branches.filter(b => b.insertAfterIdx === afterIdx);
    if (here.length === 0 && !insertBranchMode) return null;
    return (
      <View style={s.gapWrap}>
        {here.map(b => (
          <React.Fragment key={`g${b.id}`}>
            <ArrowDown color={C.line} h={12} />
            {renderBranchEditNode(b)}
          </React.Fragment>
        ))}
        {insertBranchMode && (
          <>
            <ArrowDown color="#fb923c" h={12} />
            <TouchableOpacity style={s.insertSlot} onPress={() => openBranchEditor(afterIdx)}>
              <Text style={s.insertSlotText}>＋ 分岐をここに追加</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  };

  const renderViewGap = (afterIdx: number) => {
    const here = branches.filter(b => b.insertAfterIdx === afterIdx);
    if (here.length === 0) return null;
    return (
      <View style={s.gapWrap}>
        {here.map(b => (
          <React.Fragment key={`gv${b.id}`}>
            <ArrowDown color={C.line} h={12} />
            {renderBranchViewNode(b)}
          </React.Fragment>
        ))}
      </View>
    );
  };

  // ── view mode flow ──
  const renderViewFlow = () => (
    <>
      <View style={s.viewTerminator}>
        <Text style={s.viewTerminatorText}>開始</Text>
      </View>
      {renderViewGap(-1)}
      {slots.map((taskId, idx) => {
        const task = taskId !== null ? taskById.get(taskId) : undefined;
        return (
          <React.Fragment key={idx}>
            <View style={s.viewSlotWrap}>
              <ArrowDown color={C.line} h={14} />
              {task ? (
                <View style={s.viewSlot}>
                  <View style={s.viewSlotNum}>
                    <Text style={s.viewSlotNumText}>{idx + 1}</Text>
                  </View>
                  <Text style={s.viewSlotText} numberOfLines={1}>
                    {task.icon ? `${task.icon} ` : ''}{task.title}
                  </Text>
                </View>
              ) : (
                <View style={[s.viewSlot, s.viewSlotEmpty]}>
                  <View style={s.viewSlotNum}>
                    <Text style={s.viewSlotNumText}>{idx + 1}</Text>
                  </View>
                  <Text style={s.viewSlotEmptyText}>空き</Text>
                </View>
              )}
            </View>
            {renderViewGap(idx)}
          </React.Fragment>
        );
      })}
      <ArrowDown color={C.line} h={14} />
      <View style={s.viewTerminator}>
        <Text style={s.viewTerminatorText}>終了</Text>
      </View>
      <TouchableOpacity style={s.editCard} onPress={() => setIsEditing(true)} activeOpacity={0.8}>
        <Text style={s.editCardText}>編集</Text>
      </TouchableOpacity>
    </>
  );

  // ── edit mode flow ──
  const renderEditFlow = () => (
    <>
      <View style={s.terminator}>
        <Text style={s.terminatorText}>開始</Text>
      </View>
      {renderGap(-1)}
      {slots.map((taskId, idx) => {
        const task = taskId !== null ? taskById.get(taskId) : undefined;
        const isThisDragging = draggingIdx === idx;
        const shiftAnim = shiftAnims.current[idx] ?? new Animated.Value(0);
        const pan = task ? getSlotPan(idx) : null;

        return (
          <React.Fragment key={idx}>
            <Animated.View
              style={[
                s.slotWrap,
                isThisDragging
                  ? { transform: [{ translateY: dragY }, { scale: dragScale }], zIndex: 10, elevation: 8 }
                  : { transform: [{ translateY: shiftAnim }] },
              ]}
              onLayout={(e) => { slotHRef.current = e.nativeEvent.layout.height; }}
            >
              <ArrowDown color={C.line} />
              {task ? (
                <View style={[
                  s.slotBase,
                  hasSelection ? s.slotFilledTarget : s.slotFilled,
                  isThisDragging && s.slotDragging,
                ]}>
                  <View {...pan!.panHandlers} style={s.dragHandle} hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}>
                    <Text style={s.dragHandleText}>☰</Text>
                  </View>
                  <TouchableOpacity style={s.slotCardArea} onPress={() => tapSlot(idx)} activeOpacity={0.7}>
                    <View style={s.slotNum}>
                      <Text style={s.slotNumText}>{idx + 1}</Text>
                    </View>
                    <Text style={s.slotCardText} numberOfLines={2}>
                      {task.icon ? `${task.icon} ` : ''}{task.title}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.slotRemoveBtn} onPress={() => removeFromSlot(idx)}>
                    <Text style={s.slotRemoveText}>×</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[s.slotBase, hasSelection ? s.slotTarget : s.slotEmpty]}
                  onPress={() => tapSlot(idx)}
                  activeOpacity={0.75}
                >
                  <View style={s.slotNum}>
                    <Text style={s.slotNumText}>{idx + 1}</Text>
                  </View>
                  <Text style={s.slotEmptyText}>
                    {hasSelection ? 'ここに入れる' : 'カードを入れる'}
                  </Text>
                </TouchableOpacity>
              )}
            </Animated.View>
            {renderGap(idx)}
          </React.Fragment>
        );
      })}
      <ArrowDown color={C.line} />
      <View style={s.terminator}>
        <Text style={s.terminatorText}>終了</Text>
      </View>
    </>
  );

  return (
    <View style={[s.root, { paddingBottom: insets.bottom }]}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient colors={grad.header} start={GRAD_START} end={GRAD_END} style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={s.navRow}>
          <TouchableOpacity style={s.navBtn} onPress={() => shiftSelected(-1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.navArrow}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.navCenter} onPress={() => setShowDatePicker(true)} activeOpacity={0.7}>
            <Text style={s.navDateText}>{dateLabel}</Text>
            <Text style={s.navTodayHint}>タップで日付変更</Text>
          </TouchableOpacity>
          <View style={s.navRight}>
            {isEditing && (
              <>
                <TouchableOpacity
                  style={[s.branchBtn, insertBranchMode && s.branchBtnActive]}
                  onPress={() => setInsertBranchMode(p => !p)}
                >
                  <Text style={[s.branchBtnText, insertBranchMode && s.branchBtnActiveText]}>分岐</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.saveBtn} onPress={saveOrder} disabled={saving}>
                  <Text style={s.saveBtnText}>{saving ? '…' : '保存'}</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity style={s.navBtn} onPress={() => shiftSelected(1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.navArrow}>›</Text>
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        style={s.flowScroll}
        contentContainerStyle={isEditing ? s.editContent : s.viewContent}
        scrollEnabled={draggingIdx === null}
      >
        {dueTasks.length === 0 ? (
          <View style={s.emptyFlow}>
            <Text style={s.emptyTitle}>この日のフローはありません</Text>
            <Text style={s.emptyBody}>頻度がこの日に当たるタスクがワークフローになります</Text>
          </View>
        ) : addedIds.length === 0 ? (
          <View style={s.emptyFlow}>
            <Text style={s.emptyTitle}>フローにタスクを追加しましょう</Text>
            <Text style={s.emptyBody}>「編集」からタスクを追加できます</Text>
            {isEditing ? (
              <TouchableOpacity style={s.addFirstBtn} onPress={() => setPickerOpen(true)}>
                <Text style={s.addFirstBtnText}>＋ タスクを追加</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[s.editCard, { marginTop: 16, paddingHorizontal: 40 }]} onPress={() => setIsEditing(true)} activeOpacity={0.8}>
                <Text style={s.editCardText}>編集</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : isEditing ? renderEditFlow() : renderViewFlow()}
      </ScrollView>

      {/* tray — edit mode only */}
      {isEditing && dueTasks.length > 0 && (
        <View style={s.tray}>
          {hasSelection ? (
            <Text style={s.trayHint}>カードを選択中 — 枠をタップして入れる</Text>
          ) : tray.length > 0 ? (
            <Text style={s.trayLabel}>未配置のカード ({tray.length})</Text>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.trayScroll}>
            {tray.map(id => {
              const task = taskById.get(id);
              if (!task) return null;
              const sel = selectedCardId === id;
              return (
                <TouchableOpacity key={id} style={[s.card, sel && s.cardSelected]} onPress={() => tapCard(id)} activeOpacity={0.75}>
                  <Text style={[s.cardText, sel && s.cardTextSelected]} numberOfLines={2}>
                    {task.icon ? `${task.icon} ` : ''}{task.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={s.addBtn} onPress={() => setPickerOpen(true)}>
              <Text style={s.addBtnText}>＋ タスクを追加</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={s.pickerOverlay} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={s.pickerSheet} onPress={() => {}}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>タスクを追加</Text>
              <TouchableOpacity onPress={() => setPickerOpen(false)}>
                <Text style={s.pickerDone}>完了</Text>
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
              {dueTasks.length === 0 ? (
                <View style={s.pickerEmpty}>
                  <Text style={s.pickerEmptyText}>この日のタスクがありません</Text>
                </View>
              ) : (
                dueTasks.map(t => {
                  const added = addedIds.includes(t.id);
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={[s.pickerRow, added && s.pickerRowAdded]}
                      onPress={() => togglePicker(t.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.pickerRowText, added && s.pickerRowTextAdded]} numberOfLines={2}>
                        {t.icon ? `${t.icon} ` : ''}{t.title}
                      </Text>
                      <View style={[s.pickerCheck, added && s.pickerCheckOn]}>
                        {added && <Text style={s.pickerCheckText}>✓</Text>}
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Branch editor modal */}
      <Modal visible={branchEditorOpen} transparent animationType="slide" onRequestClose={() => { setBranchEditorOpen(false); setBranchDraft(null); }}>
        <TouchableOpacity style={s.pickerOverlay} activeOpacity={1} onPress={() => { setBranchEditorOpen(false); setBranchDraft(null); }}>
          <TouchableOpacity activeOpacity={1} style={s.branchEditorSheet} onPress={() => {}}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>分岐を設定</Text>
              <TouchableOpacity onPress={saveBranchDraft}>
                <Text style={s.pickerDone}>完了</Text>
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
              <View style={s.branchEditorSection}>
                <Text style={s.branchEditorLabel}>条件</Text>
                <TextInput
                  style={s.branchEditorInput}
                  value={branchDraft?.question ?? ''}
                  onChangeText={t => setBranchDraft(p => p ? { ...p, question: t } : p)}
                  placeholder="例: 完了した？"
                  placeholderTextColor={C.muted}
                />
              </View>
              <View style={s.branchEditorSection}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[s.branchEditorLabel, { flex: 1 }]}>タスクを各パスに追加</Text>
                  <View style={s.branchCheckLabels}>
                    <Text style={s.branchCheckLabelY}>はい</Text>
                    <Text style={s.branchCheckLabelN}>いいえ</Text>
                  </View>
                </View>
              </View>
              {dueTasks.map(t => {
                const inY = branchDraft?.yesIds.includes(t.id) ?? false;
                const inN = branchDraft?.noIds.includes(t.id) ?? false;
                return (
                  <View key={t.id} style={s.branchTaskRow}>
                    <Text style={s.branchTaskText} numberOfLines={2}>{t.icon ? `${t.icon} ` : ''}{t.title}</Text>
                    <TouchableOpacity style={[s.branchCheckY, inY && s.branchCheckYOn]} onPress={() => toggleBranchY(t.id)}>
                      {inY && <Text style={s.branchCheckText}>✓</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.branchCheckN, inN && s.branchCheckNOn]} onPress={() => toggleBranchN(t.id)}>
                      {inN && <Text style={s.branchCheckText}>✓</Text>}
                    </TouchableOpacity>
                  </View>
                );
              })}
              <TouchableOpacity style={s.branchSaveBtn} onPress={saveBranchDraft}>
                <Text style={s.branchSaveBtnText}>保存</Text>
              </TouchableOpacity>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {Platform.OS === 'android' && showDatePicker && (
        <DateTimePicker
          value={selDateObj}
          mode="date"
          display="default"
          onChange={(_, date) => {
            setShowDatePicker(false);
            if (date) setSelectedDate(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
          }}
        />
      )}

      <Modal visible={Platform.OS === 'ios' && showDatePicker} transparent animationType="slide" onRequestClose={() => setShowDatePicker(false)}>
        <TouchableOpacity style={s.pickerOverlay} activeOpacity={1} onPress={() => setShowDatePicker(false)}>
          <TouchableOpacity activeOpacity={1} style={s.datePickerSheet} onPress={() => {}}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>日付を選択</Text>
              <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                <Text style={s.pickerDone}>完了</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={selDateObj}
              mode="date"
              display="spinner"
              onChange={(_, date) => {
                if (date) setSelectedDate(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
              }}
              style={{ height: 200 }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <TabBar current="Flow" navigation={navigation} />
    </View>
  );
}
