// Shared metadata + helpers for task icon / priority / frequency (recurrence).

// A task's target completion count for one day — 1 for regular tasks, or
// its configured repeat target when the repeat feature is turned on.
export type RepeatFields = { repeat_enabled: number; repeat_target: number };
export function targetFor(t: RepeatFields): number {
  return t.repeat_enabled ? Math.max(1, t.repeat_target) : 1;
}
export function isTaskDone(t: RepeatFields, count: number): boolean {
  return count >= targetFor(t);
}

export const TASK_ICONS = [
  // 身支度・掃除
  '🪥', '🚿', '🧖', '🧹', '🗑️', '🛏️', '🔑',
  // 運動・健康
  '🏃', '💪', '🧘', '💊',
  // 食事・水分
  '🥤', '🍚',
  // 勉強・仕事・ガジェット
  '📝', '📚', '💻', '📱', '💼', '🎮',
  // 趣味・メディア
  '🎵', '🎨', '🎬', '📷', '🎉',
  // 自然・動物
  '🌱', '🌸', '🐶',
  // お金・買い物
  '🛒', '💰',
  // 場所・移動
  '🏠', '🚗', '✈️',
  // 時間・天気
  '⏰', '☀️', '🌙', '⭐', '🔥',
  // その他
  '❤️', '🙏',
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

export type FreqType = 'daily' | 'weekly' | 'monthly_nth' | 'monthly_day' | 'every_n_days' | 'once' | 'dates';

export const FREQ_TYPES: { value: FreqType; label: string }[] = [
  { value: 'daily', label: '毎日' },
  { value: 'weekly', label: '毎週' },
  { value: 'monthly_nth', label: '毎月（曜日）' },
  { value: 'monthly_day', label: '毎月（日付）' },
  { value: 'every_n_days', label: '◯日おき' },
  { value: 'once', label: '今日だけ' },
  { value: 'dates', label: '任意' },
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
  freq_days: string | null;     // weekly: csv of weekday numbers 0(Sun)-6(Sat); monthly_nth: csv of weekday numbers
  freq_week: number | null;     // monthly_nth (legacy single value): 1-5 (5 = last)
  freq_weekday: number | null;  // monthly_nth (legacy single value): 0-6
  freq_day: number | null;      // monthly_day: 1-31
  once_date?: string | null;    // once: 'YYYY-MM-DD' the single day it applies; every_n_days: the start date
  freq_dates?: string | null;   // dates: csv of 'YYYY-MM-DD' specific days
  freq_weeks?: string | null;   // monthly_nth: csv of week numbers 1-5 (5 = last)
  freq_interval?: number | null; // every_n_days: repeat every N days from once_date
};

// monthly_nth stores its week/weekday selections as csv sets (freq_weeks /
// freq_days), falling back to the older single freq_week/freq_weekday
// columns for tasks created before multi-select existed.
export function monthlyNthWeeks(t: TaskFreq): number[] {
  const ws = parseDays(t.freq_weeks ?? null);
  return ws.length ? ws : [t.freq_week ?? 1];
}
export function monthlyNthWeekdays(t: TaskFreq): number[] {
  const ds = parseDays(t.freq_days);
  return ds.length ? ds : [t.freq_weekday ?? 0];
}

export function parseDateList(csv: string | null | undefined): string[] {
  return (csv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
    .sort();
}

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
      const weekLabels = monthlyNthWeeks(t).map((w) => NTH_WEEKS.find((x) => x.value === w)?.label ?? '第1').join('・');
      const wdLabels = monthlyNthWeekdays(t).map((d) => WEEKDAYS[d]).join('・');
      return `毎月 ${weekLabels}${wdLabels}曜`;
    }
    case 'monthly_day':
      return `毎月 ${t.freq_day ?? 1}日`;
    case 'every_n_days':
      return `${t.freq_interval ?? 2}日おき`;
    case 'once': {
      if (!t.once_date) return '今日だけ';
      const [, m, d] = t.once_date.split('-');
      return `${Number(m)}/${Number(d)} 限定`;
    }
    case 'dates': {
      const list = parseDateList(t.freq_dates);
      if (list.length === 0) return '任意';
      if (list.length <= 3) {
        return list.map((s) => { const [, m, d] = s.split('-'); return `${Number(m)}/${Number(d)}`; }).join('・');
      }
      return `任意 (${list.length}日)`;
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

// Earliest future occurrence across any of the given week/weekday
// combinations, at a given time of day.
export function nextNthWeekdayDate(weeks: number[], weekdays: number[], hour: number, minute: number): Date {
  const now = new Date();
  for (let i = 0; i < 14; i++) {
    const probe = new Date(now.getFullYear(), now.getMonth() + i, 1);
    let best: Date | null = null;
    for (const week of weeks) {
      for (const weekday of weekdays) {
        const occ = nthWeekdayOfMonth(probe.getFullYear(), probe.getMonth(), week, weekday);
        if (!occ) continue;
        occ.setHours(hour, minute, 0, 0);
        if (occ.getTime() > now.getTime() && (!best || occ.getTime() < best.getTime())) best = occ;
      }
    }
    if (best) return best;
  }
  const fallback = new Date(now.getTime() + 86_400_000);
  fallback.setHours(hour, minute, 0, 0);
  return fallback;
}

// Next future occurrence of an every-N-days rule anchored at startDate.
export function nextEveryNDaysDate(startDate: string, interval: number, hour: number, minute: number): Date {
  const n = Math.max(1, interval);
  const start = new Date(`${startDate}T00:00:00`);
  start.setHours(hour, minute, 0, 0);
  const now = new Date();
  if (start.getTime() > now.getTime()) return start;
  const elapsedDays = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  const cyclesPassed = Math.floor(elapsedDays / n);
  let candidate = new Date(start);
  candidate.setDate(candidate.getDate() + cyclesPassed * n);
  if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + n);
  return candidate;
}

// Whether a task's recurrence rule makes it due on the given date.
export function isDueToday(t: TaskFreq, ref: Date = new Date()): boolean {
  switch (t.freq_type) {
    case 'weekly':
      return parseDays(t.freq_days).includes(ref.getDay());
    case 'monthly_day':
      return (t.freq_day ?? 1) === ref.getDate();
    case 'monthly_nth': {
      const weeks = monthlyNthWeeks(t);
      const weekdays = monthlyNthWeekdays(t);
      return weeks.some((week) => weekdays.some((weekday) => {
        const occ = nthWeekdayOfMonth(ref.getFullYear(), ref.getMonth(), week, weekday);
        return !!occ && occ.getDate() === ref.getDate();
      }));
    }
    case 'every_n_days': {
      if (!t.once_date) return false;
      const start = new Date(`${t.once_date}T00:00:00`);
      const cur = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
      const diffDays = Math.round((cur.getTime() - start.getTime()) / 86_400_000);
      const n = Math.max(1, t.freq_interval ?? 2);
      return diffDays >= 0 && diffDays % n === 0;
    }
    case 'once':
      return t.once_date ? t.once_date === ymd(ref) : true;
    case 'dates':
      return parseDateList(t.freq_dates).includes(ymd(ref));
    case 'daily':
    default:
      return true;
  }
}
