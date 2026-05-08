<script lang="ts">
  import type { Task } from '$lib/types';

  let {
    task,
    onToggle,
    onDelete,
  }: {
    task: Task;
    onToggle: (id: string) => void;
    onDelete: (id: string) => void;
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
    </div>
  </div>
  <button class="delete-btn" onclick={() => onDelete(task.id)}>×</button>
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
    gap: 8px;
    font-size: 11px;
    color: #888;
    margin-top: 2px;
  }
  .priority {
    font-weight: 600;
  }
  .delete-btn {
    background: none;
    border: none;
    color: #ccc;
    cursor: pointer;
    font-size: 18px;
    padding: 0 4px;
    line-height: 1;
  }
  .delete-btn:hover {
    color: #f44336;
  }
</style>
