// Shared metadata for task icon / priority / frequency selectors and badges.

export const TASK_ICONS = [
  '📝', '💪', '📚', '💧', '🏃', '🧘', '🍎', '💊',
  '🧹', '🛏️', '☀️', '🌙', '✏️', '🎯', '💰', '🐶',
];

export type PriorityMeta = { value: number; label: string; color: string };

// Higher value = higher priority. Sorted high → low for display.
export const PRIORITIES: PriorityMeta[] = [
  { value: 2, label: '高', color: '#ef4444' },
  { value: 1, label: '中', color: '#f59e0b' },
  { value: 0, label: '低', color: '#94a3b8' },
];

export function priorityMeta(value: number): PriorityMeta {
  return PRIORITIES.find((p) => p.value === value) ?? PRIORITIES[1];
}

export const FREQUENCIES = ['毎日', 'その他'] as const;
export type Frequency = typeof FREQUENCIES[number];
