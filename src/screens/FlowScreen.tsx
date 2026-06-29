import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar, Modal,
  Animated, PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import { Task, getToday, getTasks, updateTaskSortOrders } from '../db/database';
import { isDueToday, WEEKDAYS } from '../constants/taskMeta';
import { GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';
import { useTheme, ColorSet } from '../contexts/ThemeContext';

const pad = (n: number) => String(n).padStart(2, '0');
type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Flow'> };

function ArrowDown({ color }: { color: string }) {
  return (
    <View style={{ alignItems: 'center', marginVertical: 4 }} pointerEvents="none">
      <View style={{ width: 2, height: 20, backgroundColor: color }} />
      <View style={{ width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 9, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: color }} />
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
  saveBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.25)' },
  saveBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },

  flowScroll: { flex: 1 },
  flowContent: { alignItems: 'center', paddingTop: 24, paddingBottom: 24, paddingHorizontal: 24 },

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

  // sync shiftAnims length with slots
  while (shiftAnims.current.length < slots.length) shiftAnims.current.push(new Animated.Value(0));
  if (shiftAnims.current.length > slots.length) shiftAnims.current = shiftAnims.current.slice(0, slots.length);

  // clear cached pan responders when slot count changes
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
    panRespMap.current.clear();
  }, [db, selectedDate]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const taskById = useMemo(() => new Map(dueTasks.map(t => [t.id, t])), [dueTasks]);
  const tray = useMemo(() => addedIds.filter(id => !slots.includes(id)), [addedIds, slots]);
  const hasSelection = selectedCardId !== null;

  // ── drag pan responder factory (keyed by slot index) ──
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
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[s.root, { paddingBottom: insets.bottom }]}>
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
            {addedIds.length > 0 && (
              <TouchableOpacity style={s.saveBtn} onPress={saveOrder} disabled={saving}>
                <Text style={s.saveBtnText}>{saving ? '…' : '保存'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.navBtn} onPress={() => shiftSelected(1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.navArrow}>›</Text>
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        style={s.flowScroll}
        contentContainerStyle={s.flowContent}
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
            <Text style={s.emptyBody}>下のボタンからタスクを選んでフローを組み立ててください</Text>
            <TouchableOpacity style={s.addFirstBtn} onPress={() => setPickerOpen(true)}>
              <Text style={s.addFirstBtnText}>＋ タスクを追加</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={s.terminator}>
              <Text style={s.terminatorText}>開始</Text>
            </View>

            {slots.map((taskId, idx) => {
              const task = taskId !== null ? taskById.get(taskId) : undefined;
              const isThisDragging = draggingIdx === idx;
              const shiftAnim = shiftAnims.current[idx] ?? new Animated.Value(0);
              const pan = task ? getSlotPan(idx) : null;

              return (
                <Animated.View
                  key={idx}
                  style={[
                    s.slotWrap,
                    isThisDragging
                      ? { transform: [{ translateY: dragY }, { scale: dragScale }], zIndex: 10, elevation: 8 }
                      : { transform: [{ translateY: shiftAnim }] },
                  ]}
                  onLayout={(e) => {
                    slotHRef.current = e.nativeEvent.layout.height;
                  }}
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
              );
            })}

            <ArrowDown color={C.line} />
            <View style={s.terminator}>
              <Text style={s.terminatorText}>終了</Text>
            </View>
          </>
        )}
      </ScrollView>

      {dueTasks.length > 0 && (
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

      <TabBar current="Flow" navigation={navigation} />
    </View>
  );
}
