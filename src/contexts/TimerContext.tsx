import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { useSQLiteContext } from 'expo-sqlite';
import * as Notifications from 'expo-notifications';
import {
  Task, addTimeLog, getToday, markComplete, getTimerSettingForTask, saveTimerSettingForTask, getTaskById, getTasks, getSetting, setSetting,
  getTimerDailyUsage, incrementTimerStarts, addTimerBonus,
} from '../db/database';
import { FREE_TIMER_STARTS_PER_DAY } from '../constants/billing';
import { usePurchases } from './PurchasesContext';

export type TimerMode = 'stopwatch' | 'timer';
export type TimerItem = {
  key: string;
  task: Task;
  baseSeconds: number;
  startedAtMs: number | null;
  startedAtIso: string | null;
  targetSeconds: number;
  mode: TimerMode;
};

export function timerSeconds(item: TimerItem, now: number): number {
  if (!item.startedAtMs) return item.baseSeconds;
  return item.baseSeconds + Math.floor((now - item.startedAtMs) / 1000);
}

export function displayTimerSeconds(item: TimerItem, now: number): number {
  const elapsed = timerSeconds(item, now);
  return item.mode === 'timer' ? Math.max(item.targetSeconds - elapsed, 0) : elapsed;
}

type AddTimerOptions = { targetSeconds?: number; autoStart?: boolean; mode?: TimerMode };
const timerItemKey = (taskId: number, mode: TimerMode) => `${taskId}:${mode}`;

type TimerActions = {
  // null return means the free daily limit was hit — no timer was added.
  addTimer: (task: Task, opts?: AddTimerOptions) => Promise<number | null>;
  removeTimer: (itemKey: string) => void;
  startTimer: (itemKey: string) => void;
  pauseTimer: (itemKey: string) => void;
  saveTimer: (itemKey: string) => Promise<void>;
  updateTargetSeconds: (itemKey: string, seconds: number) => Promise<void>;
  setMode: (itemKey: string, mode: TimerMode) => void;
  isTiming: (itemKey: string) => boolean;
  grantTimerBonus: () => Promise<void>;
};

type TimerState = { timers: TimerItem[] };

const TimerActionsContext = createContext<TimerActions | null>(null);
const TimerStateContext = createContext<TimerState | null>(null);
const TimerClockContext = createContext<number>(Date.now());
const TIMER_PINNED_IDS_KEY = 'timerPinnedTaskIds';

export function TimerProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const today = getToday();
  const { isPremium } = usePurchases();
  const [timers, setTimers] = useState<TimerItem[]>([]);
  const [now, setNow] = useState(Date.now());
  const timersRef = useRef<TimerItem[]>([]);
  timersRef.current = timers;
  const savingRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await getSetting(db, TIMER_PINNED_IDS_KEY);
      const entries = (raw ?? '').split(',').map((v) => v.trim()).filter(Boolean);
      if (entries.length === 0) return;
      const allTasks = await getTasks(db);
      const taskMap = new Map(allTasks.map((task) => [task.id, task]));
      const restored = await Promise.all(entries.map(async (entry) => {
        const [taskIdRaw, modeRaw] = entry.split(':');
        const taskId = Number(taskIdRaw);
        const mode: TimerMode = modeRaw === 'timer' ? 'timer' : 'stopwatch';
        if (!Number.isInteger(taskId) || taskId <= 0) return null;
        const task = taskMap.get(taskId);
        if (!task) return null;
        const saved = await getTimerSettingForTask(db, taskId);
        return {
          key: timerItemKey(taskId, mode),
          task,
          baseSeconds: 0,
          startedAtMs: null,
          startedAtIso: null,
          targetSeconds: saved?.target_seconds ?? 0,
          mode,
        };
      }));
      if (!cancelled) setTimers((current) => current.length > 0 ? current : restored.filter(Boolean) as TimerItem[]);
    })();
    return () => { cancelled = true; };
  }, [db]);

  const persistPinnedTimers = useCallback(async (items: TimerItem[]) => {
    const value = items.map((item) => timerItemKey(item.task.id, item.mode)).join(',');
    await setSetting(db, TIMER_PINNED_IDS_KEY, value);
  }, [db]);

  const setMode = useCallback((itemKey: string, m: TimerMode) => {
    setTimers((current) => {
      const next = current.map((item) => (item.key === itemKey ? { ...item, mode: m, key: timerItemKey(item.task.id, m) } : item));
      persistPinnedTimers(next).catch(() => {});
      return next;
    });
  }, [persistPinnedTimers]);

  const grantTimerBonus = useCallback(async () => {
    await addTimerBonus(db, today);
  }, [db, today]);

  const addTimer = useCallback(async (task: Task, opts?: AddTimerOptions): Promise<number | null> => {
    const itemMode: TimerMode = opts?.mode ?? 'stopwatch';
    const itemKey = timerItemKey(task.id, itemMode);
    const alreadyAdded = timersRef.current.some((item) => item.key === itemKey);
    if (!alreadyAdded && !isPremium) {
      const usage = await getTimerDailyUsage(db, today);
      if (usage.starts >= FREE_TIMER_STARTS_PER_DAY + usage.bonus) return null;
    }
    let target = opts?.targetSeconds;
    if (target === undefined) {
      const saved = await getTimerSettingForTask(db, task.id);
      target = saved?.target_seconds ?? 0;
    } else {
      await saveTimerSettingForTask(db, task.id, target);
    }
    if (alreadyAdded) return target;
    if (!isPremium) await incrementTimerStarts(db, today);
    const startedAtMs = opts?.autoStart ? Date.now() : null;
    const startedAtIso = startedAtMs ? new Date(startedAtMs).toISOString() : null;
    setTimers((current) => {
      if (current.some((item) => item.key === itemKey)) return current;
      const next = [...current, { key: itemKey, task, baseSeconds: 0, startedAtMs, startedAtIso, targetSeconds: target!, mode: itemMode }];
      persistPinnedTimers(next).catch(() => {});
      return next;
    });
    return target;
  }, [db, today, isPremium, persistPinnedTimers]);

  const removeTimer = useCallback((itemKey: string) => {
    setTimers((current) => {
      const next = current.filter((item) => item.key !== itemKey);
      persistPinnedTimers(next).catch(() => {});
      return next;
    });
  }, [persistPinnedTimers]);

  const startTimer = useCallback((itemKey: string) => {
    const startedAtMs = Date.now();
    const startedAtIso = new Date(startedAtMs).toISOString();
    setTimers((current) => current.map((item) => (
      item.key === itemKey && !item.startedAtMs ? { ...item, startedAtMs, startedAtIso } : item
    )));
  }, []);

  const pauseTimer = useCallback((itemKey: string) => {
    const stamp = Date.now();
    setTimers((current) => current.map((item) => (
      item.key === itemKey && item.startedAtMs
        ? { ...item, baseSeconds: timerSeconds(item, stamp), startedAtMs: null, startedAtIso: null }
        : item
    )));
  }, []);

  const saveTimer = useCallback(async (itemKey: string) => {
    const timer = timersRef.current.find((item) => item.key === itemKey);
    if (!timer || savingRef.current.has(timer.task.id)) return;
    const endedAtMs = Date.now();
    const elapsed = timerSeconds(timer, endedAtMs);
    const duration = timer.mode === 'timer' ? Math.min(elapsed, timer.targetSeconds) : elapsed;
    if (duration <= 0) return;
    savingRef.current.add(timer.task.id);
    const endedAt = new Date(endedAtMs).toISOString();
    const startedAt = timer.startedAtIso ?? new Date(endedAtMs - duration * 1000).toISOString();
    await addTimeLog(db, timer.task.id, duration, startedAt, endedAt, timer.mode);
    await markComplete(db, timer.task.id, today);
    setTimers((current) => current.map((item) => (
      item.key === itemKey ? { ...item, baseSeconds: 0, startedAtMs: null, startedAtIso: null } : item
    )));
    savingRef.current.delete(timer.task.id);
  }, [db, today]);

  const updateTargetSeconds = useCallback(async (itemKey: string, seconds: number) => {
    const timer = timersRef.current.find((t) => t.key === itemKey);
    setTimers((current) => current.map((t) => (t.key === itemKey ? { ...t, targetSeconds: seconds } : t)));
    if (timer) await saveTimerSettingForTask(db, timer.task.id, seconds);
  }, [db]);

  const isTiming = useCallback((itemKey: string) => timersRef.current.some((t) => t.key === itemKey), []);

  // tapping an auto-timer notification starts the matching task's timer/stopwatch
  const handleAutoTimerResponse = useCallback(async (data: any) => {
    if (!data || data.kind !== 'auto-timer' || typeof data.taskId !== 'number') return;
    const task = await getTaskById(db, data.taskId);
    if (!task) return;
    const timerMode: TimerMode = data.mode === 'timer' ? 'timer' : 'stopwatch';
    const targetSeconds = timerMode === 'timer' ? Math.max(60, (Number(data.minutes) || 25) * 60) : undefined;
    await addTimer(task, { autoStart: true, mode: timerMode, targetSeconds });
  }, [db, addTimer]);

  useEffect(() => {
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handleAutoTimerResponse(response.notification.request.content.data);
    });
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      handleAutoTimerResponse(response.notification.request.content.data);
    });
    return () => sub.remove();
  }, [handleAutoTimerResponse]);

  // auto-stop-and-save a countdown once it reaches its target
  useEffect(() => {
    timers.forEach((item) => {
      if (item.mode === 'timer' && item.startedAtMs && timerSeconds(item, now) >= item.targetSeconds) {
        saveTimer(item.key);
      }
    });
  }, [now, timers, saveTimer]);

  const actions = useMemo<TimerActions>(() => ({
    addTimer, removeTimer, startTimer, pauseTimer, saveTimer, updateTargetSeconds, setMode, isTiming, grantTimerBonus,
  }), [addTimer, removeTimer, startTimer, pauseTimer, saveTimer, updateTargetSeconds, setMode, isTiming, grantTimerBonus]);
  const state = useMemo<TimerState>(() => ({ timers }), [timers]);

  return (
    <TimerActionsContext.Provider value={actions}>
      <TimerStateContext.Provider value={state}>
        <TimerClockContext.Provider value={now}>
          {children}
        </TimerClockContext.Provider>
      </TimerStateContext.Provider>
    </TimerActionsContext.Provider>
  );
}

// stable action functions only — safe to use anywhere without subscribing to
// the 500ms tick that live timer displays need
export function useTimerActions(): TimerActions {
  const ctx = useContext(TimerActionsContext);
  if (!ctx) throw new Error('useTimerActions must be used within a TimerProvider');
  return ctx;
}

// timers/mode — changes only on add/remove/start/pause/save, not every tick
export function useTimerState(): TimerState {
  const ctx = useContext(TimerStateContext);
  if (!ctx) throw new Error('useTimerState must be used within a TimerProvider');
  return ctx;
}

// only for screens rendering a live countdown/stopwatch display
export function useTimerClock(): number {
  return useContext(TimerClockContext);
}
