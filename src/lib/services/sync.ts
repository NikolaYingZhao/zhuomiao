import { listen, emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { tasks, monitorRules, aiConfig, activityRecords } from '$lib/stores';
import type { Task, MonitorRule, AIConfig, ActivityRecord } from '$lib/types';

// FIX: P0 — 模块顶层零副作用。getCurrentWindow() 延迟到函数调用时获取
function getWindowLabel(): string {
    try {
        return getCurrentWindow().label;
    } catch {
        return 'unknown';
    }
}

type StoreSyncEvent<T> = {
    source: string;
    store: string;
    data: T;
};

// FIX: P3 — initStoreSync 返回 UnlistenFn，调用方负责清理
export async function initStoreSync(): Promise<() => void> {
    const unlisten = await listen<StoreSyncEvent<unknown>>('store-sync', (event) => {
        if (event.payload.source === getWindowLabel()) return;
        const { store, data } = event.payload;
        try {
            switch (store) {
                case 'tasks':
                    tasks.set(data as Task[]);
                    break;
                case 'monitorRules':
                    monitorRules.set(data as MonitorRule[]);
                    break;
                case 'aiConfig':
                    aiConfig.set(data as AIConfig);
                    break;
                case 'activityRecords':
                    activityRecords.set(data as ActivityRecord[]);
                    break;
            }
        } catch (e) {
            console.error('[sync] 处理 store-sync 事件失败:', e);
        }
    });
    return unlisten;
}

export async function broadcastStoreChange(storeName: string, data: unknown) {
    try {
        await emit('store-sync', {
            source: getWindowLabel(),
            store: storeName,
            data,
        });
    } catch (e) {
        // FIX: 不再空 catch，至少记录错误
        console.error('[sync] broadcastStoreChange 失败:', storeName, e);
    }
}

// FIX: P2 — 删除 watchAndSyncStores，只保留 persistence 层显式 broadcastStoreChange
