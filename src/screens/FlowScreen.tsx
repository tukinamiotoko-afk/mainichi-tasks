import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import { Task, getToday, getTasks, getCompletedTaskIds, markComplete, markIncomplete } from '../db/database';
import { isDueToday } from '../constants/taskMeta';
import { GRAD, GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';

const C = {
  header:    '#2563eb',
  body:      '#f4f8ff',
  card:      '#ffffff',
  border:    '#cbd5e1',
  line:      '#94a3b8',
  primary:   '#2563eb',
  onPrimary: '#ffffff',
  onDark:    '#2d3748',
  muted:     '#6b7280',
  ink:       '#111827',
  success:   '#16a34a',
  successBg: '#f0fdf4',
};

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Flow'> };

// Connector: a short vertical line with a downward arrowhead.
function Connector({ color = C.line }: { color?: string }) {
  return (
    <View style={s.connector} pointerEvents="none">
      <View style={[s.connLine, { backgroundColor: color }]} />
      <View style={[s.arrowHead, { borderTopColor: color }]} />
    </View>
  );
}

export default function FlowScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const today = getToday();
  const now = new Date();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    const ts = await getTasks(db);
    const ids = await getCompletedTaskIds(db, today);
    setTasks(ts);
    setCompletedIds(new Set(ids));
  }, [db, today]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (id: number) => {
    if (completedIds.has(id)) await markIncomplete(db, id, today);
    else await markComplete(db, id, today);
    load();
  };

  const due = tasks
    .filter((t) => isDueToday(t, now))
    .sort((a, b) => {
      const at = a.scheduled_time ?? '99:99';
      const bt = b.scheduled_time ?? '99:99';
      if (at !== bt) return at < bt ? -1 : 1;
      return a.sort_order - b.sort_order;
    });
  const doneCount = due.filter((t) => completedIds.has(t.id)).length;
  const allDone = due.length > 0 && doneCount === due.length;

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient colors={GRAD.header} start={GRAD_START} end={GRAD_END} style={[s.headerCard, { paddingTop: insets.top + 12 }]}>
        <Text style={s.headerTitle}>フローチャート</Text>
        <Text style={s.headerSub}>今日のワークフロー ・ {doneCount}/{due.length} 完了</Text>
      </LinearGradient>

      <ScrollView style={s.bodyView} contentContainerStyle={s.content}>
        {due.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>今日のフローはありません</Text>
            <Text style={s.emptyBody}>頻度が「今日」に当たるタスクがワークフローになります</Text>
          </View>
        ) : (
          <>
            {/* Start terminator */}
            <View style={s.terminator}><Text style={s.terminatorText}>開始</Text></View>

            {due.map((task, i) => {
              const isDone = completedIds.has(task.id);
              return (
                <View key={task.id} style={s.stepWrap}>
                  <Connector color={isDone ? C.success : C.line} />
                  {/* Process box */}
                  <TouchableOpacity
                    style={[s.process, isDone && s.processDone]}
                    onPress={() => toggle(task.id)}
                    activeOpacity={0.8}
                  >
                    <View style={[s.stepNo, isDone && s.stepNoDone]}>
                      <Text style={[s.stepNoText, isDone && s.stepNoTextDone]}>{i + 1}</Text>
                    </View>
                    <View style={s.processText}>
                      <Text style={[s.processTitle, isDone && s.processTitleDone]} numberOfLines={2}>
                        {task.icon ? `${task.icon} ` : ''}{task.title}
                      </Text>
                      {task.scheduled_time && <Text style={s.processTime}>⏱ {task.scheduled_time}</Text>}
                    </View>
                    <View style={[s.stepCheck, isDone && s.stepCheckDone]}>
                      {isDone && <Text style={s.stepCheckMark}>✓</Text>}
                    </View>
                  </TouchableOpacity>
                </View>
              );
            })}

            {/* Decision diamond */}
            <Connector color={allDone ? C.success : C.line} />
            <View style={s.diamondWrap}>
              <View style={[s.diamond, allDone && s.diamondDone]}>
                <View style={s.diamondInner}>
                  <Text style={[s.diamondText, allDone && s.diamondTextDone]}>全部{'\n'}完了?</Text>
                </View>
              </View>
              <Text style={s.branchLabel}>{allDone ? 'Yes →' : 'まだ'}</Text>
            </View>

            {/* End terminator */}
            <Connector color={allDone ? C.success : C.line} />
            <View style={[s.terminator, s.terminatorEnd, allDone && s.terminatorDone]}>
              <Text style={[s.terminatorText, s.terminatorEndText, allDone && s.terminatorDoneText]}>
                {allDone ? '完了 🎉' : '終了'}
              </Text>
            </View>
          </>
        )}
      </ScrollView>

      <TabBar current="Flow" navigation={navigation} />
    </View>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },
  headerCard: { backgroundColor: C.header, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18, gap: 4 },
  headerTitle: { color: '#ffffff', fontSize: 20, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' },

  bodyView: { flex: 1, backgroundColor: C.body },
  content: { padding: 16, paddingBottom: 40, alignItems: 'center' },

  // connectors
  connector: { alignItems: 'center', justifyContent: 'center' },
  connLine: { width: 2.5, height: 22 },
  arrowHead: {
    width: 0, height: 0,
    borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 10,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    marginTop: -1,
  },

  // terminators (start / end)
  terminator: { backgroundColor: C.ink, borderRadius: 24, paddingHorizontal: 30, paddingVertical: 11 },
  terminatorText: { color: '#ffffff', fontSize: 14, fontWeight: '800', letterSpacing: 2 },
  terminatorEnd: { backgroundColor: '#e2e8f0' },
  terminatorEndText: { color: C.ink },
  terminatorDone: { backgroundColor: C.success },
  terminatorDoneText: { color: '#ffffff' },

  // process boxes
  stepWrap: { alignItems: 'center', width: '100%' },
  process: {
    flexDirection: 'row', alignItems: 'center', gap: 10, width: '90%',
    backgroundColor: C.card, borderRadius: 8, borderWidth: 1.5, borderColor: C.border,
    paddingHorizontal: 12, paddingVertical: 13,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
  processDone: { borderColor: C.success, backgroundColor: C.successBg },
  stepNo: { width: 26, height: 26, borderRadius: 6, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  stepNoDone: { backgroundColor: C.success },
  stepNoText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  stepNoTextDone: { color: '#ffffff' },
  processText: { flex: 1, gap: 2 },
  processTitle: { color: C.onDark, fontSize: 14, fontWeight: '700' },
  processTitleDone: { color: C.muted, textDecorationLine: 'line-through' },
  processTime: { color: C.primary, fontSize: 11, fontWeight: '800' },
  stepCheck: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  stepCheckDone: { backgroundColor: C.success, borderColor: C.success },
  stepCheckMark: { color: '#ffffff', fontSize: 12, fontWeight: '800' },

  // decision diamond
  diamondWrap: { height: 150, alignItems: 'center', justifyContent: 'center' },
  diamond: {
    width: 104, height: 104, borderRadius: 10, borderWidth: 1.5, borderColor: C.border,
    backgroundColor: C.card, alignItems: 'center', justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
  },
  diamondDone: { borderColor: C.success, backgroundColor: C.successBg },
  diamondInner: { width: 150, alignItems: 'center', transform: [{ rotate: '-45deg' }] },
  diamondText: { color: C.onDark, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  diamondTextDone: { color: C.success },
  branchLabel: { position: 'absolute', right: 24, top: '50%', color: C.muted, fontSize: 11, fontWeight: '800' },

  empty: { paddingVertical: 60, alignItems: 'center', gap: 8 },
  emptyTitle: { color: C.ink, fontSize: 16, fontWeight: '700' },
  emptyBody: { color: C.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
});
