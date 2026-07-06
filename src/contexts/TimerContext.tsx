import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { useSQLiteContext } from 'expo-sqlite';
import * as Notifications from 'expo-notifications';
import {
  Task, addTimeLog, getToday, markComplete, getTimerSettingForTask, saveTimerSettingForTask, getTaskById,
} from '../db/database';

export type TimerMode = 'stopwatch' | 'timer';
export type TimerItem = {
  task: Task;
  baseSeconds: number;
  startedAtMs: number | null;
  startedAtIso: string | null;
  targetSeconds: number;
};

export function timerSeconds(item: TimerItem, now: number): number {
  if (!item.startedAtMs) return item.baseSeconds;
  return item.baseSeconds + Math.floor((now - item.startedAtMs) / 1000);
}

export function displayTimerSeconds(item: TimerItem, now: number, mode: TimerMode, targetSeconds: number): number {
  const elapsed = timerSeconds(item, now);
  return mode === 'timer' ? Math.max(targetSeconds - elapsed, 0) : elapsed;
}

type AddTimerOptions = { targetSeconds?: number; autoStart?: boolean; mode?: TimerMode };

type TimerActions = {
  addTimer: (task: Task, opts?: AddTimerOptions) => Promise<number>;
  removeTimer: (taskId: number) => void;
  startTimer: (taskId: number) => void;
  pauseTimer: (taskId: number) => void;
  saveTimer: (taskId: number) => Promise<void>;
  updateTargetSeconds: (taskId: number, seconds: number) => Promise<void>;
  setMode: (mode: TimerMode) => void;
  isTiming: (taskId: number) => boolean;
};

type TimerState = { timers: TimerItem[]; mode: TimerMode };

const TimerActionsContext = createContext<TimerActions | null>(null);
const TimerStateContext = createContext<TimerState | null>(null);
const TimerClockContext = createContext<number>(Date.now());

export function TimerProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const today = getToday();
  const [timers, setTimers] = useState<TimerItem[]>([]);
  const [mode, setModeState] = useState<TimerMode>('stopwatch');
  const [now, setNow] = useState(Date.now());
  const timersRef = useRef<TimerItem[]>([]);
  timersRef.current = timers;
  const savingRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const setMode = useCallback((m: TimerMode) => setModeState(m), []);

  const addTimer = useCallback(async (task: Task, opts?: AddTimerOptions): Promise<number> => {
    let target = opts?.targetSeconds;
    if (target === undefined) {
      const saved = await getTimerSettingForTask(db, task.id);
      target = saved?.target_seconds ?? 25 * 60;
    } else {
      await saveTimerSettingForTask(db, task.id, target);
    }
    if (timersRef.current.some((item) => item.task.id === task.id)) return target;
    if (opts?.mode) setModeState(opts.mode);
    const startedAtMs = opts?.autoStart ? Date.now() : null;
    const startedAtIso = startedAtMs ? new Date(startedAtMs).toISOString() : null;
    setTimers((current) => {
      if (current.some((item) => item.task.id === task.id)) return current;
      return [...current, { task, baseSeconds: 0, startedAtMs, startedAtIso, targetSeconds: target! }];
    });
    return target;
  }, [db]);

  const removeTimer = useCallback((taskId: number) => {
    setTimers((current) => current.filter((item) => item.task.id !== taskId));
  }, []);

  const startTimer = useCallback((taskId: number) => {
    const startedAtMs = Date.now();
    const startedAtIso = new Date(startedAtMs).toISOString();
    setTimers((current) => current.map((item) => (
      item.task.id === taskId && !item.startedAtMs ? { ...item, startedAtMs, startedAtIso } : item
    )));
  }, []);

  const pauseTimer = useCallback((taskId: number) => {
    const stamp = Date.now();
    setTimers((current) => current.map((item) => (
      item.task.id === taskId && item.startedAtMs
        ? { ...item, baseSeconds: timerSeconds(item, stamp), startedAtMs: null, startedAtIso: null }
        : item
    )));
  }, []);

  const saveTimer = useCallback(async (taskId: number) => {
    const timer = timersRef.current.find((item) => item.task.id === taskId);
    if (!timer || savingRef.current.has(taskId)) return;
    const endedAtMs = Date.now();
    const elapsed = timerSeconds(timer, endedAtMs);
    const duration = mode === 'timer' ? Math.min(elapsed, timer.targetSeconds) : elapsed;
    if (duration <= 0) return;
    savingRef.current.add(taskId);
    const endedAt = new Date(endedAtMs).toISOString();
    const startedAt = timer.startedAtIso ?? new Date(endedAtMs - duration * 1000).toISOString();
    await addTimeLog(db, taskId, duration, startedAt, endedAt);
    await markComplete(db, taskId, today);
    setTimers((current) => current.map((item) => (
      item.task.id === taskId ? { ...item, baseSeconds: 0, startedAtMs: null, startedAtIso: null } : item
    )));
    savingRef.current.delete(taskId);
  }, [db, mode, today]);

  const updateTargetSeconds = useCallback(async (taskId: number, seconds: number) => {
    setTimers((current) => current.map((t) => (t.task.id === taskId ? { ...t, targetSeconds: seconds } : t)));
    await saveTimerSettingForTask(db, taskId, seconds);
  }, [db]);

  const isTiming = useCallback((taskId: number) => timersRef.current.some((t) => t.task.id === taskId), []);

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
    if (mode !== 'timer') return;
    timers.forEach((item) => {
      if (item.startedAtMs && timerSeconds(item, now) >= item.targetSeconds) {
        saveTimer(item.task.id);
      }
    });
  }, [mode, now, timers, saveTimer]);

  const actions = useMemo<TimerActions>(() => ({
    addTimer, removeTimer, startTimer, pauseTimer, saveTimer, updateTargetSeconds, setMode, isTiming,
  }), [addTimer, removeTimer, startTimer, pauseTimer, saveTimer, updateTargetSeconds, setMode, isTiming]);
  const state = useMemo<TimerState>(() => ({ timers, mode }), [timers, mode]);

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
