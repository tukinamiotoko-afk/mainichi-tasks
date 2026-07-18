import * as SQLite from 'expo-sqlite';
import type { FreqType } from '../constants/taskMeta';

export type Task = {
  id: number; title: string; sort_order: number;
  icon: string | null; priority: number; frequency: string;
  scheduled_time: string | null; notify: number; notify_id: string | null; notify_type: string;
  freq_type: FreqType; freq_days: string | null;
  freq_week: number | null; freq_weekday: number | null; freq_day: number | null;
  once_date: string | null; freq_dates: string | null;
  freq_weeks: string | null; freq_interval: number | null;
  note: string | null;
  auto_timer_enabled: number; auto_timer_time: string | null;
  auto_timer_mode: string; auto_timer_minutes: number; auto_timer_notify_id: string | null;
  repeat_enabled: number; repeat_target: number;
};
export type NotificationSetting = { id: number; time: string; notification_type: string; identifier: string | null; task_id: number | null };
export type CompletionDetail = { task_id: number; title: string; icon: string | null; date: string; completed_at: string | null };
export type TimeLog = { id: number; task_id: number; title: string; icon: string | null; date: string; duration_seconds: number; started_at: string; ended_at: string; mode: 'stopwatch' | 'timer' };
export type TimerSetting = { task_id: number; target_seconds: number };
export type FlowProject = { id: number; title: string; sort_order: number };
export type FlowStep = { id: number; project_id: number; title: string; sort_order: number };
export type FlowChart = { id: number; title: string; sort_order: number };
export type FlowBranch = {
  id: number;
  flow_chart_id: number;
  after_task_id: number | null;
  question: string;
  yes_label: string;
  yes_text: string | null;
  no_label: string;
  no_text: string | null;
  branch_side: 'left' | 'right';
};

export async function migrateDb(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      icon TEXT,
      priority INTEGER DEFAULT -1,
      frequency TEXT NOT NULL DEFAULT '毎日',
      scheduled_time TEXT,
      notify INTEGER NOT NULL DEFAULT 0,
      notify_id TEXT,
      freq_type TEXT NOT NULL DEFAULT 'daily',
      freq_days TEXT,
      freq_week INTEGER,
      freq_weekday INTEGER,
      freq_day INTEGER,
      once_date TEXT,
      notify_type TEXT NOT NULL DEFAULT 'push',
      freq_dates TEXT,
      repeat_enabled INTEGER NOT NULL DEFAULT 0,
      repeat_target INTEGER NOT NULL DEFAULT 1,
      freq_weeks TEXT,
      freq_interval INTEGER
    );
    CREATE TABLE IF NOT EXISTS completions (
      task_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      completed_at TEXT,
      PRIMARY KEY (task_id, date)
    );
    CREATE TABLE IF NOT EXISTS notification_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time TEXT NOT NULL,
      notification_type TEXT NOT NULL DEFAULT 'full',
      identifier TEXT,
      task_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS time_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'stopwatch'
    );
    CREATE TABLE IF NOT EXISTS timer_settings (
      task_id INTEGER PRIMARY KEY,
      target_seconds INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS timer_daily_usage (
      date TEXT PRIMARY KEY,
      starts INTEGER NOT NULL DEFAULT 0,
      bonus INTEGER NOT NULL DEFAULT 0
    );
  `);
  try { await db.execAsync('ALTER TABLE completions ADD COLUMN completed_at TEXT'); } catch {}
  try { await db.execAsync('ALTER TABLE notification_settings ADD COLUMN task_id INTEGER'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN icon TEXT'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT -1'); } catch {}
  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN frequency TEXT NOT NULL DEFAULT '毎日'"); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN scheduled_time TEXT'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN notify INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN notify_id TEXT'); } catch {}
  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN freq_type TEXT NOT NULL DEFAULT 'daily'"); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN freq_days TEXT'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN freq_week INTEGER'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN freq_weekday INTEGER'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN freq_day INTEGER'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN once_date TEXT'); } catch {}
  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN notify_type TEXT NOT NULL DEFAULT 'push'"); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN freq_dates TEXT'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN note TEXT'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN auto_timer_enabled INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN auto_timer_time TEXT'); } catch {}
  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN auto_timer_mode TEXT NOT NULL DEFAULT 'stopwatch'"); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN auto_timer_minutes INTEGER NOT NULL DEFAULT 25'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN auto_timer_notify_id TEXT'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN repeat_enabled INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN repeat_target INTEGER NOT NULL DEFAULT 1'); } catch {}
  try { await db.execAsync('ALTER TABLE completions ADD COLUMN count INTEGER NOT NULL DEFAULT 1'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN freq_weeks TEXT'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN freq_interval INTEGER'); } catch {}
  try { await db.execAsync("ALTER TABLE flow_branches ADD COLUMN branch_side TEXT NOT NULL DEFAULT 'left'"); } catch {}
  try { await db.execAsync("ALTER TABLE time_logs ADD COLUMN mode TEXT NOT NULL DEFAULT 'stopwatch'"); } catch {}
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS flow_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS flow_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS flow_branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      after_task_id INTEGER,
      question TEXT NOT NULL DEFAULT '確認',
      yes_label TEXT NOT NULL DEFAULT 'はい',
      yes_text TEXT,
      no_label TEXT NOT NULL DEFAULT 'いいえ',
      no_text TEXT
    );
    CREATE TABLE IF NOT EXISTS flow_charts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS flow_chart_orders (
      flow_chart_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (flow_chart_id, task_id)
    );
  `);
  try { await db.execAsync('ALTER TABLE flow_branches ADD COLUMN flow_chart_id INTEGER'); } catch {}

  // ensure at least one flow chart exists, and backfill any ownerless branches to it
  const chartCount = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM flow_charts');
  let defaultChartId: number;
  if (!chartCount || chartCount.c === 0) {
    const r = await db.runAsync('INSERT INTO flow_charts (title, sort_order) VALUES (?, 0)', ['フロー1']);
    defaultChartId = r.lastInsertRowId;
  } else {
    const first = await db.getFirstAsync<{ id: number }>('SELECT id FROM flow_charts ORDER BY sort_order ASC, id ASC LIMIT 1');
    defaultChartId = first!.id;
  }
  await db.runAsync('UPDATE flow_branches SET flow_chart_id = ? WHERE flow_chart_id IS NULL', [defaultChartId]);
}

export async function getSetting(db: SQLite.SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string | null }>('SELECT value FROM app_settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setSetting(db: SQLite.SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, value]);
}

export type TimerDailyUsage = { starts: number; bonus: number };

export async function getTimerDailyUsage(db: SQLite.SQLiteDatabase, date: string): Promise<TimerDailyUsage> {
  const row = await db.getFirstAsync<TimerDailyUsage>(
    'SELECT starts, bonus FROM timer_daily_usage WHERE date = ?', [date]
  );
  return row ?? { starts: 0, bonus: 0 };
}

export async function incrementTimerStarts(db: SQLite.SQLiteDatabase, date: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO timer_daily_usage (date, starts, bonus) VALUES (?, 1, 0)
     ON CONFLICT(date) DO UPDATE SET starts = starts + 1`,
    [date]
  );
}

export async function addTimerBonus(db: SQLite.SQLiteDatabase, date: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO timer_daily_usage (date, starts, bonus) VALUES (?, 0, 1)
     ON CONFLICT(date) DO UPDATE SET bonus = bonus + 1`,
    [date]
  );
}

// Total completions ever recorded — used only as a rough engagement signal
// to decide when it's a reasonable moment to ask for a store review.
export async function getTotalCompletionsCount(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM completions');
  return row?.count ?? 0;
}

export function getToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function subtractDays(from: string, days: number): string {
  const d = new Date(from);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysBetween(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export async function getTasks(db: SQLite.SQLiteDatabase): Promise<Task[]> {
  return db.getAllAsync<Task>('SELECT * FROM tasks ORDER BY sort_order ASC, id ASC');
}

export async function getTaskById(db: SQLite.SQLiteDatabase, id: number): Promise<Task | null> {
  const row = await db.getFirstAsync<Task>('SELECT * FROM tasks WHERE id = ?', [id]);
  return row ?? null;
}

export type TaskFields = {
  title?: string; icon?: string | null; priority?: number;
  scheduled_time?: string | null; notify?: number; notify_id?: string | null; notify_type?: string;
  freq_type?: FreqType; freq_days?: string | null;
  freq_week?: number | null; freq_weekday?: number | null; freq_day?: number | null;
  once_date?: string | null; freq_dates?: string | null;
  note?: string | null;
  auto_timer_enabled?: number; auto_timer_time?: string | null;
  auto_timer_mode?: string; auto_timer_minutes?: number; auto_timer_notify_id?: string | null;
  repeat_enabled?: number; repeat_target?: number;
  freq_weeks?: string | null; freq_interval?: number | null;
};

const TASK_COLUMNS: (keyof TaskFields)[] = [
  'title', 'icon', 'priority', 'scheduled_time', 'notify', 'notify_id', 'notify_type',
  'freq_type', 'freq_days', 'freq_week', 'freq_weekday', 'freq_day', 'once_date', 'freq_dates', 'note',
  'auto_timer_enabled', 'auto_timer_time', 'auto_timer_mode', 'auto_timer_minutes', 'auto_timer_notify_id',
  'repeat_enabled', 'repeat_target', 'freq_weeks', 'freq_interval',
];

export async function addTask(db: SQLite.SQLiteDatabase, title: string): Promise<number> {
  const row = await db.getFirstAsync<{ next_order: number | null }>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM tasks'
  );
  const result = await db.runAsync('INSERT INTO tasks (title, sort_order) VALUES (?, ?)', [title, row?.next_order ?? 0]);
  return result.lastInsertRowId;
}

export async function updateTask(db: SQLite.SQLiteDatabase, id: number, fields: TaskFields): Promise<void> {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const col of TASK_COLUMNS) {
    const value = fields[col];
    if (value !== undefined) { sets.push(`${col} = ?`); values.push(value); }
  }
  if (sets.length === 0) return;
  values.push(id);
  await db.runAsync(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function updateTaskSortOrders(db: SQLite.SQLiteDatabase, orderedIds: number[]): Promise<void> {
  if (orderedIds.length === 0) return;
  // one statement instead of one round-trip per task, so the write lands
  // before the drag-release animation finishes
  const whens = orderedIds.map(() => 'WHEN ? THEN ?').join(' ');
  const placeholders = orderedIds.map(() => '?').join(',');
  const caseParams = orderedIds.flatMap((id, index) => [id, index]);
  await db.runAsync(
    `UPDATE tasks SET sort_order = CASE id ${whens} END WHERE id IN (${placeholders})`,
    [...caseParams, ...orderedIds]
  );
}

export async function deleteTask(db: SQLite.SQLiteDatabase, id: number): Promise<string[]> {
  const rows = await db.getAllAsync<{ identifier: string | null }>(
    'SELECT identifier FROM notification_settings WHERE task_id = ?', [id]
  );
  const taskRow = await db.getFirstAsync<{ notify_id: string | null; auto_timer_notify_id: string | null }>(
    'SELECT notify_id, auto_timer_notify_id FROM tasks WHERE id = ?', [id]
  );
  await db.runAsync('DELETE FROM tasks WHERE id = ?', [id]);
  await db.runAsync('DELETE FROM completions WHERE task_id = ?', [id]);
  await db.runAsync('DELETE FROM notification_settings WHERE task_id = ?', [id]);
  await db.runAsync('DELETE FROM time_logs WHERE task_id = ?', [id]);
  await db.runAsync('DELETE FROM timer_settings WHERE task_id = ?', [id]);
  const ids = rows.map(r => r.identifier).filter(Boolean) as string[];
  if (taskRow?.notify_id) ids.push(...taskRow.notify_id.split(',').filter(Boolean));
  if (taskRow?.auto_timer_notify_id) ids.push(...taskRow.auto_timer_notify_id.split(',').filter(Boolean));
  return ids;
}

// A task/day counts as fully done once its completion count reaches the
// task's target (repeat tasks) or 1 (regular, non-repeat tasks).
const DONE_CONDITION = 'c.count >= (CASE WHEN t.repeat_enabled = 1 THEN t.repeat_target ELSE 1 END)';

export async function getCompletedTaskIds(db: SQLite.SQLiteDatabase, date: string): Promise<number[]> {
  const rows = await db.getAllAsync<{ task_id: number }>(
    `SELECT c.task_id as task_id FROM completions c JOIN tasks t ON t.id = c.task_id
     WHERE c.date = ? AND ${DONE_CONDITION}`,
    [date]
  );
  return rows.map((r) => r.task_id);
}

export async function getCompletionCounts(db: SQLite.SQLiteDatabase, date: string): Promise<Map<number, number>> {
  const rows = await db.getAllAsync<{ task_id: number; count: number }>(
    'SELECT task_id, count FROM completions WHERE date = ?', [date]
  );
  return new Map(rows.map((r) => [r.task_id, r.count]));
}

export async function markComplete(db: SQLite.SQLiteDatabase, taskId: number, date: string): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO completions (task_id, date, count, completed_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(task_id, date) DO UPDATE SET count = count + 1, completed_at = excluded.completed_at`,
    [taskId, date, now]
  );
}

export async function markIncomplete(db: SQLite.SQLiteDatabase, taskId: number, date: string): Promise<void> {
  await db.runAsync('UPDATE completions SET count = count - 1 WHERE task_id = ? AND date = ?', [taskId, date]);
  await db.runAsync('DELETE FROM completions WHERE task_id = ? AND date = ? AND count <= 0', [taskId, date]);
}

export async function resetCompletion(db: SQLite.SQLiteDatabase, taskId: number, date: string): Promise<void> {
  await db.runAsync('DELETE FROM completions WHERE task_id = ? AND date = ?', [taskId, date]);
}

export async function getCompletionCountInRange(
  db: SQLite.SQLiteDatabase, taskId: number, startDate: string, endDate: string
): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM completions c JOIN tasks t ON t.id = c.task_id
     WHERE c.task_id = ? AND c.date >= ? AND c.date <= ? AND ${DONE_CONDITION}`,
    [taskId, startDate, endDate]
  );
  return row?.count ?? 0;
}

// Sum of instances actually done in the range, each day capped at the
// task's target (so extra over-target taps don't inflate the total).
export async function getCompletionInstancesInRange(
  db: SQLite.SQLiteDatabase, taskId: number, startDate: string, endDate: string
): Promise<number> {
  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(MIN(c.count, CASE WHEN t.repeat_enabled = 1 THEN t.repeat_target ELSE 1 END)), 0) as total
     FROM completions c JOIN tasks t ON t.id = c.task_id
     WHERE c.task_id = ? AND c.date >= ? AND c.date <= ?`,
    [taskId, startDate, endDate]
  );
  return row?.total ?? 0;
}

export async function getFirstCompletionDate(db: SQLite.SQLiteDatabase, taskId: number): Promise<string | null> {
  const row = await db.getFirstAsync<{ date: string }>(
    `SELECT MIN(c.date) as date FROM completions c JOIN tasks t ON t.id = c.task_id
     WHERE c.task_id = ? AND ${DONE_CONDITION}`,
    [taskId]
  );
  return row?.date ?? null;
}

export async function getCompletionsForMonth(
  db: SQLite.SQLiteDatabase, year: number, month: number
): Promise<CompletionDetail[]> {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = `${year}-${String(month).padStart(2, '0')}-31`;
  return db.getAllAsync<CompletionDetail>(
    `SELECT c.task_id, t.title, t.icon, c.date, c.completed_at
     FROM completions c JOIN tasks t ON c.task_id = t.id
     WHERE c.date >= ? AND c.date <= ? AND ${DONE_CONDITION}
     ORDER BY c.date, c.completed_at`,
    [start, end]
  );
}

export async function getNotificationSettings(db: SQLite.SQLiteDatabase): Promise<NotificationSetting[]> {
  return db.getAllAsync<NotificationSetting>(
    'SELECT * FROM notification_settings WHERE task_id IS NULL ORDER BY time ASC'
  );
}

export async function getNotificationSettingsForTask(
  db: SQLite.SQLiteDatabase, taskId: number
): Promise<NotificationSetting[]> {
  return db.getAllAsync<NotificationSetting>(
    'SELECT * FROM notification_settings WHERE task_id = ? ORDER BY time ASC', [taskId]
  );
}

export async function addNotificationSetting(
  db: SQLite.SQLiteDatabase, time: string, notification_type: string, identifier: string | null, taskId?: number
): Promise<void> {
  await db.runAsync(
    'INSERT INTO notification_settings (time, notification_type, identifier, task_id) VALUES (?, ?, ?, ?)',
    [time, notification_type, identifier, taskId ?? null]
  );
}

export async function deleteNotificationSetting(
  db: SQLite.SQLiteDatabase, id: number
): Promise<string | null> {
  const row = await db.getFirstAsync<{ identifier: string | null }>(
    'SELECT identifier FROM notification_settings WHERE id = ?', [id]
  );
  await db.runAsync('DELETE FROM notification_settings WHERE id = ?', [id]);
  return row?.identifier ?? null;
}

export async function addTimeLog(
  db: SQLite.SQLiteDatabase, taskId: number, durationSeconds: number, startedAt: string, endedAt: string,
  mode: 'stopwatch' | 'timer' = 'stopwatch'
): Promise<void> {
  const ended = new Date(endedAt);
  const date = `${ended.getFullYear()}-${String(ended.getMonth() + 1).padStart(2, '0')}-${String(ended.getDate()).padStart(2, '0')}`;
  await db.runAsync(
    'INSERT INTO time_logs (task_id, date, duration_seconds, started_at, ended_at, mode) VALUES (?, ?, ?, ?, ?, ?)',
    [taskId, date, Math.max(1, Math.round(durationSeconds)), startedAt, endedAt, mode]
  );
}

export async function getTimeLogsForDate(
  db: SQLite.SQLiteDatabase,
  date: string,
  mode?: 'stopwatch' | 'timer'
): Promise<TimeLog[]> {
  if (mode) {
    return db.getAllAsync<TimeLog>(
      `SELECT l.id, l.task_id, t.title, t.icon, l.date, l.duration_seconds, l.started_at, l.ended_at, l.mode
       FROM time_logs l JOIN tasks t ON l.task_id = t.id
       WHERE l.date = ? AND l.mode = ?
       ORDER BY l.ended_at DESC`,
      [date, mode]
    );
  }
  return db.getAllAsync<TimeLog>(
    `SELECT l.id, l.task_id, t.title, t.icon, l.date, l.duration_seconds, l.started_at, l.ended_at, l.mode
     FROM time_logs l JOIN tasks t ON l.task_id = t.id
     WHERE l.date = ?
     ORDER BY l.ended_at DESC`,
    [date]
  );
}

export async function getTimeLogsForTask(
  db: SQLite.SQLiteDatabase,
  taskId: number,
  mode?: 'stopwatch' | 'timer'
): Promise<TimeLog[]> {
  if (mode) {
    return db.getAllAsync<TimeLog>(
      `SELECT l.id, l.task_id, t.title, t.icon, l.date, l.duration_seconds, l.started_at, l.ended_at, l.mode
       FROM time_logs l JOIN tasks t ON l.task_id = t.id
       WHERE l.task_id = ? AND l.mode = ?
       ORDER BY l.ended_at DESC`,
      [taskId, mode]
    );
  }
  return db.getAllAsync<TimeLog>(
    `SELECT l.id, l.task_id, t.title, t.icon, l.date, l.duration_seconds, l.started_at, l.ended_at, l.mode
     FROM time_logs l JOIN tasks t ON l.task_id = t.id
     WHERE l.task_id = ?
     ORDER BY l.ended_at DESC`,
    [taskId]
  );
}

export async function getTotalTimeForDate(db: SQLite.SQLiteDatabase, date: string): Promise<number> {
  const row = await db.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(duration_seconds) as total FROM time_logs WHERE date = ?',
    [date]
  );
  return row?.total ?? 0;
}

export type TimeLogTotal = { task_id: number; title: string; icon: string | null; total_seconds: number };

export async function getTimeLogTotalsInRange(
  db: SQLite.SQLiteDatabase, startDate: string, endDate: string, mode?: 'stopwatch' | 'timer'
): Promise<TimeLogTotal[]> {
  if (mode) {
    return db.getAllAsync<TimeLogTotal>(
      `SELECT l.task_id, t.title, t.icon, SUM(l.duration_seconds) as total_seconds
       FROM time_logs l JOIN tasks t ON l.task_id = t.id
       WHERE l.date >= ? AND l.date <= ? AND l.mode = ?
       GROUP BY l.task_id
       ORDER BY total_seconds DESC`,
      [startDate, endDate, mode]
    );
  }
  return db.getAllAsync<TimeLogTotal>(
    `SELECT l.task_id, t.title, t.icon, SUM(l.duration_seconds) as total_seconds
     FROM time_logs l JOIN tasks t ON l.task_id = t.id
     WHERE l.date >= ? AND l.date <= ?
     GROUP BY l.task_id
     ORDER BY total_seconds DESC`,
    [startDate, endDate]
  );
}

export async function deleteTimeLog(db: SQLite.SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM time_logs WHERE id = ?', [id]);
}

export async function countTimeLogsForTaskDate(
  db: SQLite.SQLiteDatabase, taskId: number, date: string
): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM time_logs WHERE task_id = ? AND date = ?',
    [taskId, date]
  );
  return row?.count ?? 0;
}

export async function getTimerSettingForTask(db: SQLite.SQLiteDatabase, taskId: number): Promise<TimerSetting | null> {
  const row = await db.getFirstAsync<TimerSetting>(
    'SELECT task_id, target_seconds FROM timer_settings WHERE task_id = ?',
    [taskId]
  );
  return row ?? null;
}

export async function saveTimerSettingForTask(
  db: SQLite.SQLiteDatabase, taskId: number, targetSeconds: number
): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO timer_settings (task_id, target_seconds) VALUES (?, ?)',
    [taskId, Math.max(1, Math.round(targetSeconds))]
  );
}

export async function getFlowProjects(db: SQLite.SQLiteDatabase): Promise<FlowProject[]> {
  return db.getAllAsync<FlowProject>('SELECT * FROM flow_projects ORDER BY sort_order ASC, id ASC');
}

export async function addFlowProject(db: SQLite.SQLiteDatabase, title: string): Promise<number> {
  const row = await db.getFirstAsync<{ next_order: number | null }>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM flow_projects'
  );
  const result = await db.runAsync(
    'INSERT INTO flow_projects (title, sort_order) VALUES (?, ?)',
    [title, row?.next_order ?? 0]
  );
  return result.lastInsertRowId;
}

export async function updateFlowProject(db: SQLite.SQLiteDatabase, id: number, title: string): Promise<void> {
  await db.runAsync('UPDATE flow_projects SET title = ? WHERE id = ?', [title, id]);
}

export async function deleteFlowProject(db: SQLite.SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM flow_projects WHERE id = ?', [id]);
  await db.runAsync('DELETE FROM flow_steps WHERE project_id = ?', [id]);
}

export async function getFlowSteps(db: SQLite.SQLiteDatabase, projectId: number): Promise<FlowStep[]> {
  return db.getAllAsync<FlowStep>(
    'SELECT * FROM flow_steps WHERE project_id = ? ORDER BY sort_order ASC, id ASC',
    [projectId]
  );
}

export async function addFlowStep(db: SQLite.SQLiteDatabase, projectId: number, title: string): Promise<number> {
  const row = await db.getFirstAsync<{ next_order: number | null }>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM flow_steps WHERE project_id = ?',
    [projectId]
  );
  const result = await db.runAsync(
    'INSERT INTO flow_steps (project_id, title, sort_order) VALUES (?, ?, ?)',
    [projectId, title, row?.next_order ?? 0]
  );
  return result.lastInsertRowId;
}

export async function updateFlowStep(db: SQLite.SQLiteDatabase, id: number, title: string): Promise<void> {
  await db.runAsync('UPDATE flow_steps SET title = ? WHERE id = ?', [title, id]);
}

export async function deleteFlowStep(db: SQLite.SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM flow_steps WHERE id = ?', [id]);
}

export async function reorderFlowSteps(db: SQLite.SQLiteDatabase, orderedIds: number[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.runAsync('UPDATE flow_steps SET sort_order = ? WHERE id = ?', [i, orderedIds[i]]);
    }
  });
}

export async function getFlowBranches(db: SQLite.SQLiteDatabase, flowChartId: number): Promise<FlowBranch[]> {
  return db.getAllAsync<FlowBranch>('SELECT * FROM flow_branches WHERE flow_chart_id = ? ORDER BY id', [flowChartId]);
}

export async function addFlowBranch(db: SQLite.SQLiteDatabase, b: Omit<FlowBranch, 'id'>): Promise<number> {
  const r = await db.runAsync(
    'INSERT INTO flow_branches (flow_chart_id, after_task_id, question, yes_label, yes_text, no_label, no_text, branch_side) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [b.flow_chart_id, b.after_task_id, b.question, b.yes_label, b.yes_text, b.no_label, b.no_text, b.branch_side ?? 'left'],
  );
  return r.lastInsertRowId;
}

export async function updateFlowBranch(db: SQLite.SQLiteDatabase, id: number, b: Omit<FlowBranch, 'id' | 'flow_chart_id'>): Promise<void> {
  await db.runAsync(
    'UPDATE flow_branches SET after_task_id=?, question=?, yes_label=?, yes_text=?, no_label=?, no_text=?, branch_side=? WHERE id=?',
    [b.after_task_id, b.question, b.yes_label, b.yes_text, b.no_label, b.no_text, b.branch_side ?? 'left', id],
  );
}

export async function deleteFlowBranch(db: SQLite.SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM flow_branches WHERE id=?', [id]);
}

export async function getFlowCharts(db: SQLite.SQLiteDatabase): Promise<FlowChart[]> {
  return db.getAllAsync<FlowChart>('SELECT * FROM flow_charts ORDER BY sort_order ASC, id ASC');
}

export async function addFlowChart(db: SQLite.SQLiteDatabase, title: string): Promise<number> {
  const row = await db.getFirstAsync<{ next_order: number | null }>(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM flow_charts'
  );
  const r = await db.runAsync('INSERT INTO flow_charts (title, sort_order) VALUES (?, ?)', [title, row?.next_order ?? 0]);
  return r.lastInsertRowId;
}

export async function renameFlowChart(db: SQLite.SQLiteDatabase, id: number, title: string): Promise<void> {
  await db.runAsync('UPDATE flow_charts SET title = ? WHERE id = ?', [title, id]);
}

export async function deleteFlowChart(db: SQLite.SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM flow_charts WHERE id = ?', [id]);
  await db.runAsync('DELETE FROM flow_branches WHERE flow_chart_id = ?', [id]);
  await db.runAsync('DELETE FROM flow_chart_orders WHERE flow_chart_id = ?', [id]);
}

export async function getFlowChartOrder(db: SQLite.SQLiteDatabase, flowChartId: number): Promise<Map<number, number>> {
  const rows = await db.getAllAsync<{ task_id: number; position: number }>(
    'SELECT task_id, position FROM flow_chart_orders WHERE flow_chart_id = ?', [flowChartId]
  );
  return new Map(rows.map(r => [r.task_id, r.position]));
}

export async function updateFlowChartOrder(db: SQLite.SQLiteDatabase, flowChartId: number, orderedIds: number[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM flow_chart_orders WHERE flow_chart_id = ?', [flowChartId]);
    for (let i = 0; i < orderedIds.length; i++) {
      await db.runAsync(
        'INSERT INTO flow_chart_orders (flow_chart_id, task_id, position) VALUES (?, ?, ?)',
        [flowChartId, orderedIds[i], i]
      );
    }
  });
}
