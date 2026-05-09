import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { tasks, monitorRules, aiConfig } from '$lib/stores';
import type { Task, MonitorRule, AIConfig } from '$lib/types';

let isSaving = false;
let currentDataVersion = 0;

export function getIsSaving(): boolean { return isSaving; }
export function getDataVersion(): number { return currentDataVersion; }

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
  isSaving = true;
  try {
    await invoke('save_app_data', { key: 'tasks', data: get(tasks) });
    await invoke('save_app_data', { key: 'monitor-rules', data: get(monitorRules) });
    await invoke('save_app_data', { key: 'ai-config', data: get(aiConfig) });
    currentDataVersion++;
    const versionData = { version: currentDataVersion, lastModifiedAt: new Date().toISOString() };
    await invoke('save_app_data', { key: 'data-version', data: versionData });
  } finally {
    isSaving = false;
  }
}

export async function loadAll(): Promise<void> {
  if (isSaving) {
    console.log('[persistence] loadAll 跳过：saveAll 正在执行中');
    return;
  }

  try {
    const versionResult = await invoke<{ version: number } | null>('load_app_data', { key: 'data-version' });
    const diskVersion = versionResult?.version ?? 0;
    if (diskVersion < currentDataVersion && currentDataVersion > 0) {
      console.log(`[persistence] loadAll 跳过：磁盘版本 ${diskVersion} < 内存版本 ${currentDataVersion}`);
      return;
    }
    currentDataVersion = diskVersion;
  } catch { }

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
    if (isSaving) return;
    try {
      await saveAll();
    } catch (e) {
      console.error('自动保存失败:', e);
    }
  }, intervalMs);
}
