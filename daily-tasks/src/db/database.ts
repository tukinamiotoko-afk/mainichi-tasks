import * as SQLite from 'expo-sqlite';

export type Task = { id: number; title: string; sort_order: number; priority: number; icon: string; target_time: string | null; frequency: string };
export type NotificationSetting = { id: number; time: string; notification_type: string; identifier: string | null; task_id: number | null };
export type CompletionDetail = { task_id: number; title: string; date: string; completed_at: string | null };
export type TimeLog = { id: number; task_id: number; date: string; duration: number; type: string; started_at: string };

export async function migrateDb(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
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
      duration INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'stopwatch',
      started_at TEXT NOT NULL
    );
  `);
  try { await db.execAsync('ALTER TABLE completions ADD COLUMN completed_at TEXT'); } catch {}
  try { await db.execAsync('ALTER TABLE notification_settings ADD COLUMN task_id INTEGER'); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 1'); } catch {}
  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN icon TEXT DEFAULT '✅'"); } catch {}
  try { await db.execAsync('ALTER TABLE tasks ADD COLUMN target_time TEXT'); } catch {}
  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN frequency TEXT DEFAULT 'daily'"); } catch {}
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
  return db.getAllAsync<Task>('SELECT * FROM tasks ORDER BY priority DESC, sort_order ASC, id ASC');
}

export async function addTask(db: SQLite.SQLiteDatabase, title: string): Promise<number> {
  const result = await db.runAsync('INSERT INTO tasks (title) VALUES (?)', [title]);
  return result.lastInsertRowId;
}

export async function updateTask(db: SQLite.SQLiteDatabase, id: number, title: string): Promise<void> {
  await db.runAsync('UPDATE tasks SET title = ? WHERE id = ?', [title, id]);
}

export async function updateTaskPriority(db: SQLite.SQLiteDatabase, id: number, priority: number): Promise<void> {
  await db.runAsync('UPDATE tasks SET priority = ? WHERE id = ?', [priority, id]);
}

export async function updateTaskIcon(db: SQLite.SQLiteDatabase, id: number, icon: string): Promise<void> {
  await db.runAsync('UPDATE tasks SET icon = ? WHERE id = ?', [icon, id]);
}

export async function updateTaskTargetTime(db: SQLite.SQLiteDatabase, id: number, target_time: string | null): Promise<void> {
  await db.runAsync('UPDATE tasks SET target_time = ? WHERE id = ?', [target_time, id]);
}

export async function updateTaskFrequency(db: SQLite.SQLiteDatabase, id: number, frequency: string): Promise<void> {
  await db.runAsync('UPDATE tasks SET frequency = ? WHERE id = ?', [frequency, id]);
}

export async function deleteTask(db: SQLite.SQLiteDatabase, id: number): Promise<string[]> {
  const rows = await db.getAllAsync<{ identifier: string | null }>(
    'SELECT identifier FROM notification_settings WHERE task_id = ?', [id]
  );
  await db.runAsync('DELETE FROM tasks WHERE id = ?', [id]);
  await db.runAsync('DELETE FROM completions WHERE task_id = ?', [id]);
  await db.runAsync('DELETE FROM notification_settings WHERE task_id = ?', [id]);
  return rows.map(r => r.identifier).filter(Boolean) as string[];
}

export async function getCompletedTaskIds(db: SQLite.SQLiteDatabase, date: string): Promise<number[]> {
  const rows = await db.getAllAsync<{ task_id: number }>('SELECT task_id FROM completions WHERE date = ?', [date]);
  return rows.map((r) => r.task_id);
}

export async function getCompletionsForDate(
  db: SQLite.SQLiteDatabase, date: string
): Promise<{ task_id: number; completed_at: string | null }[]> {
  return db.getAllAsync<{ task_id: number; completed_at: string | null }>(
    'SELECT task_id, completed_at FROM completions WHERE date = ?', [date]
  );
}

export function expectedCompletions(frequency: string, startDate: string, endDate: string): number {
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  const totalDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  if (!frequency || frequency === 'daily') return totalDays;
  if (frequency.startsWith('weekly:')) {
    const n = parseInt(frequency.split(':')[1], 10);
    return Math.ceil(totalDays / 7) * n;
  }
  if (frequency.startsWith('days:')) {
    const days = frequency.split(':')[1].split(',').map(Number);
    let count = 0;
    const d = new Date(start);
    while (d <= end) { if (days.includes(d.getDay())) count++; d.setDate(d.getDate() + 1); }
    return Math.max(count, 1);
  }
  return totalDays;
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
    `SELECT c.task_id, t.title, c.date, c.completed_at
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

export async function addTimeLog(
  db: SQLite.SQLiteDatabase, taskId: number, duration: number, type: string, startedAt: string
): Promise<void> {
  const date = startedAt.slice(0, 10);
  await db.runAsync(
    'INSERT INTO time_logs (task_id, date, duration, type, started_at) VALUES (?, ?, ?, ?, ?)',
    [taskId, date, duration, type, startedAt]
  );
}

export async function getTimeLogsForTask(db: SQLite.SQLiteDatabase, taskId: number): Promise<TimeLog[]> {
  return db.getAllAsync<TimeLog>(
    'SELECT * FROM time_logs WHERE task_id = ? ORDER BY started_at DESC', [taskId]
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
