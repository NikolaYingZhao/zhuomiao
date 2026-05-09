import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { tasks, monitorRules, aiConfig, dbStatus } from '$lib/stores';
import type { Task, MonitorRule, AIConfig, DbStatusInfo } from '$lib/types';

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

function isDbUnavailableError(e: unknown): boolean {
  return e instanceof Error && e.message.includes('数据库连接不可用');
}

function fallbackToFileMode() {
  dbStatus.set({ available: false, mode: 'file' });
}

async function checkDbStatus(): Promise<boolean> {
  try {
    const status = await invoke<DbStatusInfo>('db_status');
    dbStatus.set(status);
    return status.available;
  } catch {
    return false;
  }
}

export async function createTask(task: Task): Promise<void> {
  try {
    await invoke('db_task_create', { task });
  } catch (e) {
    if (isDbUnavailableError(e)) {
      fallbackToFileMode();
      tasks.add(task);
      await saveAll();
      return;
    }
    throw e;
  }
}

export async function removeTask(id: string): Promise<void> {
  const oldTasks = get(tasks);
  tasks.remove(id);
  try {
    await invoke('db_task_remove', { id });
  } catch (e) {
    tasks.set(oldTasks);
    if (isDbUnavailableError(e)) {
      fallbackToFileMode();
      await saveAll();
      return;
    }
    throw e;
  }
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  const oldTasks = get(tasks);
  tasks.updateTask(id, patch);
  try {
    const camelPatch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      camelPatch[key] = value;
    }
    await invoke('db_task_update', { id, patch: camelPatch });
  } catch (e) {
    tasks.set(oldTasks);
    if (isDbUnavailableError(e)) {
      fallbackToFileMode();
      await saveAll();
      return;
    }
    throw e;
  }
}

export async function toggleTask(id: string, completionMethod?: 'manual' | 'ai_detected'): Promise<void> {
  const oldTasks = get(tasks);
  const task = oldTasks.find(t => t.id === id);
  if (!task) return;

  const newCompleted = !task.completed;
  const newMethod = newCompleted ? (completionMethod ?? 'manual') : null;
  tasks.toggle(id, completionMethod);

  try {
    await invoke('db_task_toggle', { id, completed: newCompleted, completionMethod: newMethod });
  } catch (e) {
    tasks.set(oldTasks);
    if (isDbUnavailableError(e)) {
      fallbackToFileMode();
      await saveAll();
      return;
    }
    throw e;
  }
}

export async function clearCompleted(): Promise<void> {
  const oldTasks = get(tasks);
  tasks.clearCompleted();
  try {
    await invoke('db_task_clear_completed');
  } catch (e) {
    tasks.set(oldTasks);
    if (isDbUnavailableError(e)) {
      fallbackToFileMode();
      await saveAll();
      return;
    }
    throw e;
  }
}

export async function loadAllFromDB(): Promise<void> {
  const dbAvailable = await checkDbStatus();
  if (!dbAvailable) {
    await loadAll();
    return;
  }

  try {
    const dbTasks = await invoke<Task[]>('db_task_list');
    if (dbTasks) tasks.set(dbTasks);
  } catch { }

  try {
    const dbRules = await invoke<MonitorRule[]>('db_rule_list');
    if (dbRules) monitorRules.set(dbRules);
  } catch { }

  try {
    const dbConfig = await invoke<AIConfig | null>('db_config_get');
    if (dbConfig) aiConfig.set(dbConfig);
  } catch { }
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
    if (aiData) aiConfig.set(aiConfig);
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
