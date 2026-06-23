import * as SQLite from 'expo-sqlite';
import type { FreqType } from '../constants/taskMeta';

export type Task = {
  id: number; title: string; sort_order: number;
  icon: string | null; priority: number; frequency: string;
  scheduled_time: string | null; notify: number; notify_id: string | null;
  freq_type: FreqType; freq_days: string | null;
  freq_week: number | null; freq_weekday: number | null; freq_day: number | null;
};
export type NotificationSetting = { id: number; time: string; notification_type: string; identifier: string | null; task_id: number | null };
export type CompletionDetail = { task_id: number; title: string; icon: string | null; date: string; completed_at: string | null };
export type TimeLog = { id: number; task_id: number; title: string; date: string; duration_seconds: number; started_at: string; ended_at: string };
export type TimerSetting = { task_id: number; target_seconds: number };

export async function migrateDb(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      icon TEXT,
      priority INTEGER DEFAULT 1,
      frequency TEXT NOT NULL DEFAULT '毎日',
      scheduled_time TEXT,
      notify INTEGER NOT NULL DEFAULT 0,
      notify_id TEXT,
      freq_type TEXT NOT NULL DEFAULT 'daily',
      freq_days TEXT,
      freq_week INTEGER,
      freq_weekday INTEGER,
      freq_day INTEGER
    );
    CREATE TABLE IF NOT EXISTS completions (
      task_id INTEGER NOT NULL,
      date TEXT NOT NULL,
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
      ended_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS timer_settings (
      task_id INTEGER PRIMARY KEY,
      target_seconds INTEGER NOT NULL
    );
  `);
  try { await db.execAsync('ALTER TABLE completions ADD COLUMN completed_at TEXT'); } catch {}
  try { await db.execAsync('ALTER TABLE notification_settings ADD COLUMN task_id INTEGER'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN icon TEXT'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 1'); } catch {}
  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN frequency TEXT NOT NULL DEFAULT '毎日'"); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN scheduled_time TEXT'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN notify INTEGER NOT NULL DEFAULT 0'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN notify_id TEXT'); } catch {}
  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN freq_type TEXT NOT NULL DEFAULT 'daily'"); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN freq_days TEXT'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN freq_week INTEGER'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN freq_weekday INTEGER'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN freq_day INTEGER'); } catch {}
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

export type TaskFields = {
  title?: string; icon?: string | null; priority?: number;
  scheduled_time?: string | null; notify?: number; notify_id?: string | null;
  freq_type?: FreqType; freq_days?: string | null;
  freq_week?: number | null; freq_weekday?: number | null; freq_day?: number | null;
};

const TASK_COLUMNS: (keyof TaskFields)[] = [
  'title', 'icon', 'priority', 'scheduled_time', 'notify', 'notify_id',
  'freq_type', 'freq_days', 'freq_week', 'freq_weekday', 'freq_day',
];

export async function addTask(db: SQLite.SQLiteDatabase, title: string): Promise<number> {
  const result = await db.runAsync('INSERT INTO tasks (title) VALUES (?)', [title]);
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

export async function deleteTask(db: SQLite.SQLiteDatabase, id: number): Promise<string[]> {
  const rows = await db.getAllAsync<{ identifier: string | null }>(
    'SELECT identifier FROM notification_settings WHERE task_id = ?', [id]
  );
  const taskRow = await db.getFirstAsync<{ notify_id: string | null }>(
    'SELECT notify_id FROM tasks WHERE id = ?', [id]
  );
  await db.runAsync('DELETE FROM tasks WHERE id = ?', [id]);
  await db.runAsync('DELETE FROM completions WHERE task_id = ?', [id]);
  await db.runAsync('DELETE FROM notification_settings WHERE task_id = ?', [id]);
  await db.runAsync('DELETE FROM time_logs WHERE task_id = ?', [id]);
  await db.runAsync('DELETE FROM timer_settings WHERE task_id = ?', [id]);
  const ids = rows.map(r => r.identifier).filter(Boolean) as string[];
  if (taskRow?.notify_id) ids.push(...taskRow.notify_id.split(',').filter(Boolean));
  return ids;
}

export async function getCompletedTaskIds(db: SQLite.SQLiteDatabase, date: string): Promise<number[]> {
  const rows = await db.getAllAsync<{ task_id: number }>('SELECT task_id FROM completions WHERE date = ?', [date]);
  return rows.map((r) => r.task_id);
}

export async function markComplete(db: SQLite.SQLiteDatabase, taskId: number, date: string): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    'INSERT OR REPLACE INTO completions (task_id, date, completed_at) VALUES (?, ?, ?)',
    [taskId, date, now]
  );
}

export async function markIncomplete(db: SQLite.SQLiteDatabase, taskId: number, date: string): Promise<void> {
  await db.runAsync('DELETE FROM completions WHERE task_id = ? AND date = ?', [taskId, date]);
}

export async function getCompletionCountInRange(
  db: SQLite.SQLiteDatabase, taskId: number, startDate: string, endDate: string
): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM completions WHERE task_id = ? AND date >= ? AND date <= ?',
    [taskId, startDate, endDate]
  );
  return row?.count ?? 0;
}

export async function getFirstCompletionDate(db: SQLite.SQLiteDatabase, taskId: number): Promise<string | null> {
  const row = await db.getFirstAsync<{ date: string }>(
    'SELECT MIN(date) as date FROM completions WHERE task_id = ?', [taskId]
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
     WHERE c.date >= ? AND c.date <= ?
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
  db: SQLite.SQLiteDatabase, taskId: number, durationSeconds: number, startedAt: string, endedAt: string
): Promise<void> {
  await db.runAsync(
    'INSERT INTO time_logs (task_id, date, duration_seconds, started_at, ended_at) VALUES (?, ?, ?, ?, ?)',
    [taskId, endedAt.slice(0, 10), Math.max(1, Math.round(durationSeconds)), startedAt, endedAt]
  );
}

export async function getTimeLogsForDate(db: SQLite.SQLiteDatabase, date: string): Promise<TimeLog[]> {
  return db.getAllAsync<TimeLog>(
    `SELECT l.id, l.task_id, t.title, l.date, l.duration_seconds, l.started_at, l.ended_at
     FROM time_logs l JOIN tasks t ON l.task_id = t.id
     WHERE l.date = ?
     ORDER BY l.ended_at DESC`,
    [date]
  );
}

export async function getTotalTimeForDate(db: SQLite.SQLiteDatabase, date: string): Promise<number> {
  const row = await db.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(duration_seconds) as total FROM time_logs WHERE date = ?',
    [date]
  );
  return row?.total ?? 0;
}

export async function deleteTimeLog(db: SQLite.SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM time_logs WHERE id = ?', [id]);
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
    [taskId, Math.max(60, Math.round(targetSeconds))]
  );
}
