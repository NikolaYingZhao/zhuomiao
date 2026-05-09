<script lang="ts">
  import type { Task } from '$lib/types';

  let {
    task,
    onToggle,
    onDelete,
  }: {
    task: Task;
    onToggle: (id: string) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
  } = $props();

  const priorityColors = {
    low: '#4caf50',
    medium: '#ff9800',
    high: '#f44336',
  };

  const priorityLabels = {
    low: '低',
    medium: '中',
    high: '高',
  };
</script>

<div class="task-item" class:completed={task.completed}>
  <button class="checkbox" onclick={() => onToggle(task.id)}>
    {task.completed ? '✅' : '⬜'}
  </button>
  <div class="task-content">
    <span class="task-title">{task.title}</span>
    <div class="task-meta">
      <span class="priority" style="color: {priorityColors[task.priority]}">
        {priorityLabels[task.priority]}
      </span>
      <span class="category">{task.category}</span>
      {#if task.dueDate}
        <span class="due">{task.dueDate}</span>
      {/if}
      {#if task.completionHint}
        <span class="hint-badge" title="完成检测提示">💡 {task.completionHint}</span>
      {/if}
    </div>
  </div>
  <button class="delete-btn" onclick={() => onDelete(task.id)} title="删除任务">✕</button>
</div>

<style>
  .task-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    background: #f8f9fa;
    margin-bottom: 6px;
    transition: all 0.2s;
  }
  .task-item:hover {
    background: #f0f1f3;
  }
  .task-item.completed {
    opacity: 0.6;
  }
  .task-item.completed .task-title {
    text-decoration: line-through;
  }
  .checkbox {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 18px;
    padding: 0;
    line-height: 1;
  }
  .task-content {
    flex: 1;
    min-width: 0;
  }
  .task-title {
    font-size: 14px;
    color: #333;
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .task-meta {
    display: flex;
    gap: 6px;
    font-size: 11px;
    color: #888;
    margin-top: 2px;
    flex-wrap: wrap;
    align-items: center;
  }
  .priority {
    font-weight: 600;
  }
  .delete-btn {
    background: none;
    border: none;
    color: #e57373;
    cursor: pointer;
    font-size: 16px;
    padding: 4px;
    min-width: 24px;
    min-height: 24px;
    line-height: 1;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }
  .delete-btn:hover {
    color: #f44336;
    background: rgba(244, 67, 54, 0.08);
  }
  .hint-badge {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: #e8f5e9;
    color: #2e7d32;
    padding: 1px 6px;
    border-radius: 8px;
    font-size: 10px;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
