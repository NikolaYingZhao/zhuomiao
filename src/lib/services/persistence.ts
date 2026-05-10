import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { tasks, monitorRules, aiConfig, activityRecords, dbStatus } from '$lib/stores';
import type { Task, MonitorRule, AIConfig, ActivityRecord, DbStatusInfo } from '$lib/types';
import { broadcastStoreChange } from './sync';

let isSaving = false;
let currentDataVersion = 0;

export function getIsSaving(): boolean { return isSaving; }
export function getDataVersion(): number { return currentDataVersion; }

// FIX: P1 — isDbAvailable 改为异步函数，从 Rust 端查询真实状态
// 不再使用模块级变量，避免各窗口状态不一致
export async function isDbAvailable(): Promise<boolean> {
  try {
    const status = await invoke<DbStatusInfo>('db_status');
    return status.available;
  } catch (e) {
    console.error('[persistence] 查询 DB 状态失败:', e);
    return false;
  }
}

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

// FIX: P4 — 精确匹配 Rust 端返回的 DB 不可用错误
// Rust 端 db/mod.rs 中 check_pool() 返回 "数据库连接不可用"
const DB_UNAVAILABLE_MARKER = '数据库连接不可用';

function isDbUnavailableError(e: unknown): boolean {
  if (e instanceof Error) {
    return e.message.includes(DB_UNAVAILABLE_MARKER);
  }
  return false;
}

function fallbackToFileMode() {
  dbStatus.set({ available: false, mode: 'file' });
}

async function tryDbOperation<T>(operation: () => Promise<T>): Promise<{ ok: boolean; result?: T }> {
  // FIX: P1 — 通过 isDbAvailable() 函数查询，而非模块级变量
  const dbAvail = await isDbAvailable();
  if (!dbAvail) {
    return { ok: false };
  }
  try {
    const result = await operation();
    return { ok: true, result };
  } catch (e) {
    if (isDbUnavailableError(e)) {
      fallbackToFileMode();
      return { ok: false };
    }
    throw e;
  }
}

export async function createTask(task: Task): Promise<void> {
  tasks.add(task);
  broadcastStoreChange('tasks', get(tasks));
  const dbResult = await tryDbOperation(() => invoke('db_task_create', { task }));
  if (!dbResult.ok) {
    await saveAll();
  }
}

export async function removeTask(id: string): Promise<void> {
  tasks.remove(id);
  broadcastStoreChange('tasks', get(tasks));
  const dbResult = await tryDbOperation(() => invoke('db_task_remove', { id }));
  if (!dbResult.ok) {
    await saveAll();
  }
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  tasks.updateTask(id, patch);
  broadcastStoreChange('tasks', get(tasks));
  const camelPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    camelPatch[key] = value;
  }
  const dbResult = await tryDbOperation(() => invoke('db_task_update', { id, patch: camelPatch }));
  if (!dbResult.ok) {
    await saveAll();
  }
}

export async function toggleTask(id: string, completionMethod?: 'manual' | 'ai_detected'): Promise<void> {
  const task = get(tasks).find(t => t.id === id);
  if (!task) return;

  const newCompleted = !task.completed;
  const newMethod = newCompleted ? (completionMethod ?? 'manual') : null;
  tasks.toggle(id, completionMethod);
  broadcastStoreChange('tasks', get(tasks));

  const dbResult = await tryDbOperation(() => invoke('db_task_toggle', { id, completed: newCompleted, completionMethod: newMethod }));
  if (!dbResult.ok) {
    await saveAll();
  }
}

export async function clearCompleted(): Promise<void> {
  tasks.clearCompleted();
  broadcastStoreChange('tasks', get(tasks));
  const dbResult = await tryDbOperation(() => invoke('db_task_clear_completed'));
  if (!dbResult.ok) {
    await saveAll();
  }
}

export async function saveActivityRecords(records: ActivityRecord[], newRecord?: ActivityRecord): Promise<void> {
  activityRecords.set(records);
  broadcastStoreChange('activityRecords', records);
  if (newRecord) {
    const dbResult = await tryDbOperation(() => invoke('db_activity_create', { record: newRecord }));
    if (!dbResult.ok) {
      try {
        await invoke('save_app_data', { key: 'activity-records', data: records });
      } catch (e) {
        console.error('[persistence] 活动记录 JSON 持久化失败:', e);
      }
    }
  } else {
    try {
      await invoke('save_app_data', { key: 'activity-records', data: records });
    } catch (e) {
      console.error('[persistence] 活动记录 JSON 持久化失败:', e);
    }
  }
}

export async function saveMonitorRules(): Promise<void> {
  const currentRules = get(monitorRules);
  broadcastStoreChange('monitorRules', currentRules);
  const dbResult = await tryDbOperation(() => invoke('db_rule_save', { rules: currentRules }));
  if (!dbResult.ok) {
    await saveAll();
  }
}

export async function saveAiConfig(): Promise<void> {
  const currentConfig = get(aiConfig);
  broadcastStoreChange('aiConfig', currentConfig);
  const dbResult = await tryDbOperation(() => invoke('db_config_save', { config: currentConfig }));
  if (!dbResult.ok) {
    await saveAll();
  }
}

export async function calibrateActivityRecord(id: string, classification: string): Promise<void> {
  const dbResult = await tryDbOperation(() => invoke('db_activity_calibrate', { id, classification }));
  if (!dbResult.ok) {
    try {
      await invoke('save_app_data', { key: 'activity-records', data: get(activityRecords) });
    } catch (e) {
      console.error('[persistence] 校准 JSON 持久化失败:', e);
    }
  }
}

// FIX: P0 — loadAllFromDB 整体 try-catch 包裹，失败时降级为加载空数据
export async function loadAllFromDB(): Promise<void> {
  try {
    const dbAvail = await isDbAvailable();
    if (!dbAvail) {
      await loadAll();
      return;
    }

    const dbResult = await tryDbOperation(() => invoke<Task[]>('db_task_list'));
    if (dbResult.ok && dbResult.result) {
      tasks.set(dbResult.result);
    }

    const rulesResult = await tryDbOperation(() => invoke<MonitorRule[]>('db_rule_list'));
    if (rulesResult.ok && rulesResult.result) {
      monitorRules.set(rulesResult.result);
    }

    const configResult = await tryDbOperation(() => invoke<AIConfig | null>('db_config_get'));
    if (configResult.ok && configResult.result) {
      aiConfig.set(configResult.result);
    }

    const activityResult = await tryDbOperation(() => invoke<ActivityRecord[]>('db_activity_list'));
    if (activityResult.ok && activityResult.result) {
      activityRecords.set(activityResult.result);
    }

    // 再次检查 DB 是否在加载过程中变为不可用
    const dbStillAvail = await isDbAvailable();
    if (!dbStillAvail) {
      await loadAll();
    }
  } catch (e) {
    console.error('[persistence] loadAllFromDB 失败，降级到 loadAll:', e);
    try {
      await loadAll();
    } catch (e2) {
      console.error('[persistence] loadAll 也失败，使用空数据:', e2);
    }
  }
}

export async function saveAll(): Promise<void> {
  isSaving = true;
  try {
    await invoke('save_app_data', { key: 'tasks', data: get(tasks) });
    await invoke('save_app_data', { key: 'monitor-rules', data: get(monitorRules) });
    await invoke('save_app_data', { key: 'ai-config', data: get(aiConfig) });
    await invoke('save_app_data', { key: 'activity-records', data: get(activityRecords) });
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
  } catch (e) {
    console.error('[persistence] 读取数据版本失败:', e);
  }

  try {
    const tasksData = await invoke<Task[] | null>('load_app_data', { key: 'tasks' });
    if (tasksData) tasks.set(tasksData);
  } catch (e) {
    console.error('[persistence] 加载 tasks 失败:', e);
  }

  try {
    const rulesData = await invoke<MonitorRule[] | null>('load_app_data', { key: 'monitor-rules' });
    if (rulesData) monitorRules.set(rulesData);
  } catch (e) {
    console.error('[persistence] 加载 monitor-rules 失败:', e);
  }

  try {
    const aiData = await invoke<AIConfig | null>('load_app_data', { key: 'ai-config' });
    if (aiData) aiConfig.set(aiData);
  } catch (e) {
    console.error('[persistence] 加载 ai-config 失败:', e);
  }

  try {
    const activityData = await invoke<ActivityRecord[] | null>('load_app_data', { key: 'activity-records' });
    if (activityData) activityRecords.set(activityData);
  } catch (e) {
    console.error('[persistence] 加载 activity-records 失败:', e);
  }
}

export function setupAutoSave(intervalMs: number = 5000): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    if (isSaving) return;
    try {
      await saveAll();
    } catch (e) {
      console.error('[persistence] 自动保存失败:', e);
    }
  }, intervalMs);
}
