<script lang="ts">
  import { tasks, incompleteTasks, completedTasks } from '$lib/stores';
  import TaskItem from './TaskItem.svelte';
  import type { Task } from '$lib/types';

  let newTitle = $state('');
  let newCategory = $state('学习');
  let newPriority = $state<'low' | 'medium' | 'high'>('medium');
  let newDueDate = $state('');
  let filterCategory = $state('all');
  let showAddForm = $state(false);

  const categories = ['学习', '工作', '生活', '运动', '阅读', '其他'];

  function addTask() {
    if (!newTitle.trim()) return;
    const task: Task = {
      id: crypto.randomUUID(),
      title: newTitle.trim(),
      category: newCategory,
      priority: newPriority,
      dueDate: newDueDate || null,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    tasks.add(task);
    newTitle = '';
    newDueDate = '';
    showAddForm = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') addTask();
  }

  let filteredTasks = $derived(
    filterCategory === 'all'
      ? $tasks
      : $tasks.filter(t => t.category === filterCategory)
  );

  let completionRate = $derived(
    $tasks.length > 0 ? Math.round(($completedTasks.length / $tasks.length) * 100) : 0
  );
</script>

<div class="panel">
  <div class="panel-header">
    <h2>📋 桌喵的任务板</h2>
    <div class="stats">
      <span class="stat">待办: {$incompleteTasks.length}</span>
      <span class="stat">完成: {$completedTasks.length}</span>
      <span class="stat rate">完成率: {completionRate}%</span>
    </div>
  </div>

  <div class="toolbar">
    <div class="filters">
      <button class="filter-btn" class:active={filterCategory === 'all'} onclick={() => filterCategory = 'all'}>全部</button>
      {#each categories as cat}
        <button class="filter-btn" class:active={filterCategory === cat} onclick={() => filterCategory = cat}>{cat}</button>
      {/each}
    </div>
    <button class="add-btn" onclick={() => showAddForm = !showAddForm}>
      {showAddForm ? '取消' : '+ 新任务'}
    </button>
  </div>

  {#if showAddForm}
    <div class="add-form">
      <input type="text" placeholder="今天要做什么？" bind:value={newTitle} onkeydown={handleKeydown} />
      <div class="form-row">
        <select bind:value={newCategory}>
          {#each categories as cat}
            <option value={cat}>{cat}</option>
          {/each}
        </select>
        <select bind:value={newPriority}>
          <option value="low">低优先级</option>
          <option value="medium">中优先级</option>
          <option value="high">高优先级</option>
        </select>
        <input type="date" bind:value={newDueDate} />
      </div>
      <button class="submit-btn" onclick={addTask}>添加</button>
    </div>
  {/if}

  <div class="task-list">
    {#each filteredTasks as task (task.id)}
      <TaskItem
        {task}
        onToggle={(id) => tasks.toggle(id)}
        onDelete={(id) => tasks.remove(id)}
      />
    {/each}
    {#if filteredTasks.length === 0}
      <div class="empty">还没有任务哦～告诉桌喵今天要做什么吧！</div>
    {/if}
  </div>

  {#if $completedTasks.length > 0}
    <button class="clear-btn" onclick={() => tasks.clearCompleted()}>
      清除已完成 ({$completedTasks.length})
    </button>
  {/if}
</div>

<style>
  .panel {
    padding: 16px;
    height: 100%;
    overflow-y: auto;
  }
  .panel-header {
    margin-bottom: 12px;
  }
  .panel-header h2 {
    font-size: 18px;
    margin: 0 0 6px 0;
    color: #333;
  }
  .stats {
    display: flex;
    gap: 12px;
    font-size: 12px;
    color: #666;
  }
  .stat.rate {
    color: #ff9f43;
    font-weight: 600;
  }
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    gap: 8px;
  }
  .filters {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    flex: 1;
  }
  .filter-btn {
    padding: 4px 8px;
    border: 1px solid #ddd;
    border-radius: 12px;
    background: white;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.2s;
  }
  .filter-btn.active {
    background: #ff9f43;
    color: white;
    border-color: #ff9f43;
  }
  .add-btn {
    padding: 4px 12px;
    border: none;
    border-radius: 12px;
    background: #ff9f43;
    color: white;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .add-form {
    background: #fff8f0;
    border-radius: 10px;
    padding: 10px;
    margin-bottom: 12px;
    border: 1px solid #ffecd2;
  }
  .add-form input[type="text"] {
    width: 100%;
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 14px;
    margin-bottom: 8px;
    box-sizing: border-box;
  }
  .form-row {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }
  .form-row select, .form-row input {
    padding: 4px 6px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 12px;
    flex: 1;
  }
  .submit-btn {
    width: 100%;
    padding: 6px;
    border: none;
    border-radius: 6px;
    background: #ff9f43;
    color: white;
    cursor: pointer;
    font-size: 13px;
  }
  .task-list {
    flex: 1;
  }
  .empty {
    text-align: center;
    color: #aaa;
    padding: 24px 0;
    font-size: 13px;
  }
  .clear-btn {
    width: 100%;
    padding: 6px;
    border: 1px solid #ddd;
    border-radius: 6px;
    background: white;
    color: #888;
    cursor: pointer;
    font-size: 12px;
    margin-top: 8px;
  }
  .clear-btn:hover {
    background: #f5f5f5;
  }
</style>
