import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import { Task, getToday, getTasks, getCompletedTaskIds, markComplete, markIncomplete } from '../db/database';
import { isDueToday, WEEKDAYS } from '../constants/taskMeta';
import { GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';
import { useTheme, ColorSet } from '../contexts/ThemeContext';

const pad = (n: number) => String(n).padStart(2, '0');

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Flow'> };

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

  bodyView: { flex: 1, backgroundColor: C.body },

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

  const isToday = selectedDate === today;
  const selDateObj = useMemo(() => new Date(`${selectedDate}T00:00:00`), [selectedDate]);
  const dateLabel = `${selDateObj.getFullYear()}/${pad(selDateObj.getMonth() + 1)}/${pad(selDateObj.getDate())} (${WEEKDAYS[selDateObj.getDay()]})`;

  const shiftSelected = (days: number) => {
    const d = new Date(`${selectedDate}T00:00:00`);
    d.setDate(d.getDate() + days);
    setSelectedDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  };

  const load = useCallback(async () => {
    const [ts, ids] = await Promise.all([getTasks(db), getCompletedTaskIds(db, selectedDate)]);
    setTasks(ts);
    setCompletedIds(new Set(ids));
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
      </LinearGradient>

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

      <TabBar current="Flow" navigation={navigation} />
    </View>
  );
}
