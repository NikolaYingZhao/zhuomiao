import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { tasks, monitorRules, aiConfig } from '$lib/stores';
import type { Task, MonitorRule, AIConfig } from '$lib/types';

export interface AppDataDir {
  path: string;
  isDefault: boolean;
}

export async function getDataDir(): Promise<AppDataDir> {
  return invoke<AppDataDir>('get_data_dir');
}

export async function setDataDir(dir: string): Promise<void> {
  await invoke('set_data_dir', { dir });
  await saveAll();
}

export async function saveAll(): Promise<void> {
  await invoke('save_app_data', { key: 'tasks', data: get(tasks) });
  await invoke('save_app_data', { key: 'monitor-rules', data: get(monitorRules) });
  await invoke('save_app_data', { key: 'ai-config', data: get(aiConfig) });
}

export async function loadAll(): Promise<void> {
  try {
    const tasksData = await invoke<Task[] | null>('load_app_data', { key: 'tasks' });
    if (tasksData) tasks.set(tasksData);
  } catch { }

  try {
    const rulesData = await invoke<MonitorRule[] | null>('load_app_data', { key: 'monitor-rules' });
    if (rulesData) monitorRules.set(rulesData);
  } catch { }

  try {
    const aiData = await invoke<AIConfig | null>('load_app_data', { key: 'ai-config' });
    if (aiData) aiConfig.set(aiData);
  } catch { }
}

export function setupAutoSave(intervalMs: number = 5000): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    try {
      await saveAll();
    } catch (e) {
      console.error('自动保存失败:', e);
    }
  }, intervalMs);
}
