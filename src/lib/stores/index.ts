import { writable, derived } from 'svelte/store';
import type { Task, PetState, MonitorRule, AIConfig, ActiveWindow, ActivityRecord, ChatMessage, DbStatusInfo } from '$lib/types';

function createTaskStore() {
  const { subscribe, set, update } = writable<Task[]>([]);

  return {
    subscribe,
    set,
    add(task: Task) {
      update(tasks => [...tasks, task]);
    },
    remove(id: string) {
      update(tasks => tasks.filter(t => t.id !== id));
    },
    toggle(id: string, completionMethod?: 'manual' | 'ai_detected') {
      update(tasks => tasks.map(t =>
        t.id === id
          ? {
              ...t,
              completed: !t.completed,
              completionMethod: !t.completed
                ? (completionMethod ?? 'manual')
                : null,
            }
          : t
      ));
    },
    updateTask(id: string, patch: Partial<Task>) {
      update(tasks => tasks.map(t => t.id === id ? { ...t, ...patch } : t));
    },
    clearCompleted() {
      update(tasks => tasks.filter(t => !t.completed));
    },
  };
}

export const tasks = createTaskStore();

export const incompleteTasks = derived(tasks, $tasks => $tasks.filter(t => !t.completed));
export const completedTasks = derived(tasks, $tasks => $tasks.filter(t => t.completed));
export const tasksByCategory = derived(tasks, $tasks => {
  const map = new Map<string, Task[]>();
  for (const t of $tasks) {
    const list = map.get(t.category) || [];
    list.push(t);
    map.set(t.category, list);
  }
  return map;
});

export const petState = writable<PetState>('idle');
export const petMessage = writable<string>('');
export const isPanelOpen = writable(false);
export const isSettingsOpen = writable(false);
export const monitorRules = writable<MonitorRule[]>([]);
export const activeWindow = writable<ActiveWindow | null>(null);
export const aiConfig = writable<AIConfig>({
  provider: 'openai',
  endpoint: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  systemPrompt: '你是桌喵，一只住在用户桌面上的小猫咪。你会监督用户完成任务，当用户摸鱼时你会生气地提醒，当用户完成任务时你会开心地夸奖。你的语气可爱但坚定。',
});
export const activityRecords = writable<ActivityRecord[]>([]);
export const dbStatus = writable<DbStatusInfo>({ available: true, mode: 'mysql' });
export const chatMessages = writable<ChatMessage[]>([]);
