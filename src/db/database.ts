import * as SQLite from 'expo-sqlite';

export type Task = { id: number; title: string; sort_order: number };

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
      PRIMARY KEY (task_id, date)
    );
  `);
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

export async function addTask(db: SQLite.SQLiteDatabase, title: string): Promise<void> {
  await db.runAsync('INSERT INTO tasks (title) VALUES (?)', [title]);
}

export async function deleteTask(db: SQLite.SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM tasks WHERE id = ?', [id]);
  await db.runAsync('DELETE FROM completions WHERE task_id = ?', [id]);
}

export async function getCompletedTaskIds(db: SQLite.SQLiteDatabase, date: string): Promise<number[]> {
  const rows = await db.getAllAsync<{ task_id: number }>('SELECT task_id FROM completions WHERE date = ?', [date]);
  return rows.map((r) => r.task_id);
}

export async function markComplete(db: SQLite.SQLiteDatabase, taskId: number, date: string): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO completions (task_id, date) VALUES (?, ?)', [taskId, date]);
}

export async function markIncomplete(db: SQLite.SQLiteDatabase, taskId: number, date: string): Promise<void> {
  await db.runAsync('DELETE FROM completions WHERE task_id = ? AND date = ?', [taskId, date]);
}

export async function getCompletionCountInRange(
  db: SQLite.SQLiteDatabase,
  taskId: number,
  startDate: string,
  endDate: string
): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM completions WHERE task_id = ? AND date >= ? AND date <= ?',
    [taskId, startDate, endDate]
  );
  return row?.count ?? 0;
}

export async function getFirstCompletionDate(
  db: SQLite.SQLiteDatabase,
  taskId: number
): Promise<string | null> {
  const row = await db.getFirstAsync<{ date: string }>(
    'SELECT MIN(date) as date FROM completions WHERE task_id = ?',
    [taskId]
  );
  return row?.date ?? null;
}
