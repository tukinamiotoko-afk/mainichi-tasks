// Shared metadata + helpers for task icon / priority / frequency (recurrence).

export const TASK_ICONS = [
  // 生活・身支度
  '📝', '✅', '⏰', '🔔', '💡', '🪥', '🚿',
  '🧹', '🧺', '🗑️', '🛏️', '🔑',
  // 美容
  '🧖',
  // 運動・健康
  '🏃', '😴', '💊', '⚖️',
  // 食事・水分
  '💧', '🍚',
  // 学習・仕事（パソコン・ガジェット）
  '📚', '💻', '📱', '💼',
  // ゲーム
  '🎮',
  // 趣味・その他
  '🎵', '🎨', '🎬', '📷', '🌱', '🐶',
  '🛒', '💰', '🏠', '🚗', '✈️', '🙏', '❤️', '⭐',
  '🔥', '🌙', '☀️', '🎉', '🌸',
];

export type PriorityMeta = { value: number; label: string; color: string; cardColor: string; borderColor: string };

// Higher value = higher priority. Sorted high → low for display.
export const PRIORITIES: PriorityMeta[] = [
  { value: 2, label: '高', color: '#dc2626', cardColor: '#fee2e2', borderColor: '#fca5a5' },
  { value: 1, label: '中', color: '#d97706', cardColor: '#fef3c7', borderColor: '#fbbf24' },
  { value: 0, label: '低', color: '#2563eb', cardColor: '#dbeafe', borderColor: '#93c5fd' },
  { value: -1, label: 'なし', color: '#94a3b8', cardColor: '#ffffff', borderColor: '#dbeafe' },
];

export function priorityMeta(value: number): PriorityMeta {
  return PRIORITIES.find((p) => p.value === value) ?? PRIORITIES[3];
}

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// Recurrence -----------------------------------------------------------------

export type FreqType = 'daily' | 'weekly' | 'monthly_nth' | 'monthly_day' | 'once';

export const FREQ_TYPES: { value: FreqType; label: string }[] = [
  { value: 'daily', label: '毎日' },
  { value: 'weekly', label: '毎週' },
  { value: 'monthly_nth', label: '毎月（曜日）' },
  { value: 'monthly_day', label: '毎月（日付）' },
  { value: 'once', label: 'その日限り' },
];

// week=5 means "last week of the month".
export const NTH_WEEKS: { value: number; label: string }[] = [
  { value: 1, label: '第1' },
  { value: 2, label: '第2' },
  { value: 3, label: '第3' },
  { value: 4, label: '第4' },
  { value: 5, label: '最終' },
];

export type TaskFreq = {
  freq_type: FreqType;
  freq_days: string | null;     // weekly: csv of weekday numbers 0(Sun)-6(Sat)
  freq_week: number | null;     // monthly_nth: 1-5 (5 = last)
  freq_weekday: number | null;  // monthly_nth: 0-6
  freq_day: number | null;      // monthly_day: 1-31
  once_date?: string | null;    // once: 'YYYY-MM-DD' the single day it applies
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseDays(csv: string | null): number[] {
  return (csv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
}

export function frequencyLabel(t: TaskFreq): string {
  switch (t.freq_type) {
    case 'weekly': {
      const days = parseDays(t.freq_days);
      if (days.length === 0) return '毎週';
      if (days.length === 7) return '毎日';
      return `毎週 ${days.map((d) => WEEKDAYS[d]).join('・')}`;
    }
    case 'monthly_nth': {
      const week = NTH_WEEKS.find((w) => w.value === t.freq_week)?.label ?? '第1';
      const wd = WEEKDAYS[t.freq_weekday ?? 0];
      return `毎月 ${week}${wd}曜`;
    }
    case 'monthly_day':
      return `毎月 ${t.freq_day ?? 1}日`;
    case 'once': {
      if (!t.once_date) return 'その日限り';
      const [, m, d] = t.once_date.split('-');
      return `${Number(m)}/${Number(d)} 限定`;
    }
    case 'daily':
    default:
      return '毎日';
  }
}

// Returns the date of the nth (week) weekday of a given month, or null if it
// does not exist (e.g. a 5th occurrence in a short month). week=5 = last.
export function nthWeekdayOfMonth(year: number, monthIndex: number, week: number, weekday: number): Date | null {
  if (week >= 1 && week <= 4) {
    const firstDow = new Date(year, monthIndex, 1).getDay();
    const day = 1 + ((weekday - firstDow + 7) % 7) + (week - 1) * 7;
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    if (day > daysInMonth) return null;
    return new Date(year, monthIndex, day);
  }
  // last occurrence
  const last = new Date(year, monthIndex + 1, 0);
  const day = last.getDate() - ((last.getDay() - weekday + 7) % 7);
  return new Date(year, monthIndex, day);
}

// Next future occurrence of an nth-weekday rule at a given time of day.
export function nextNthWeekdayDate(week: number, weekday: number, hour: number, minute: number): Date {
  const now = new Date();
  for (let i = 0; i < 14; i++) {
    const probe = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const occ = nthWeekdayOfMonth(probe.getFullYear(), probe.getMonth(), week, weekday);
    if (occ) {
      occ.setHours(hour, minute, 0, 0);
      if (occ.getTime() > now.getTime()) return occ;
    }
  }
  const fallback = new Date(now.getTime() + 86_400_000);
  fallback.setHours(hour, minute, 0, 0);
  return fallback;
}

// Whether a task's recurrence rule makes it due on the given date.
export function isDueToday(t: TaskFreq, ref: Date = new Date()): boolean {
  switch (t.freq_type) {
    case 'weekly':
      return parseDays(t.freq_days).includes(ref.getDay());
    case 'monthly_day':
      return (t.freq_day ?? 1) === ref.getDate();
    case 'monthly_nth': {
      const occ = nthWeekdayOfMonth(ref.getFullYear(), ref.getMonth(), t.freq_week ?? 1, t.freq_weekday ?? 0);
      return !!occ && occ.getDate() === ref.getDate();
    }
    case 'once':
      return t.once_date ? t.once_date === ymd(ref) : true;
    case 'daily':
    default:
      return true;
  }
}
