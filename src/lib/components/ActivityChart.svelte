<script lang="ts">
  import type { ActivityRecord } from '$lib/types';

  let {
    records,
    onCalibrate,
  }: {
    records: ActivityRecord[];
    onCalibrate?: (record: ActivityRecord, newClassification: 'productive' | 'slacking') => void;
  } = $props();

  let selectedDate = $state(new Date().toISOString().slice(0, 10));
  let calibratingId = $state<string | null>(null);

  function dateRecords(date: string): ActivityRecord[] {
    return records.filter(r => r.timestamp.slice(0, 10) === date);
  }

  // Activity type color palette
  const TYPE_COLORS: Record<string, string> = {
    '编程': '#4caf50',
    '文档编辑': '#2196f3',
    '浏览网页': '#00bcd4',
    '聊天': '#ff9800',
    '看视频': '#f44336',
    '浏览': '#e91e63',
    '使用': '#9e9e9e',
    '学习': '#8bc34a',
    '工作': '#3f51b5',
    '阅读': '#795548',
    '会议': '#607d8b',
    '其他': '#9e9e9e',
  };

  function getTypeColor(type: string): string {
    const key = Object.keys(TYPE_COLORS).find(k => type.startsWith(k));
    return key ? TYPE_COLORS[key] : '#9e9e9e';
  }

  interface HourData {
    hour: number;
    productive: number;
    slacking: number;
    total: number;
    // each record in this hour with its type and color
    items: { classification: string; activityType: string; color: string }[];
  }

  function hourData(date: string): HourData[] {
    const dayRecords = dateRecords(date);
    const result: HourData[] = [];
    for (let h = 0; h < 24; h++) {
      const hrRecords = dayRecords.filter(r => new Date(r.timestamp).getHours() === h);
      const items = hrRecords.map(r => {
        const activityType = r.activityType || (r.classification === 'productive' ? '工作' : '摸鱼');
        return {
          classification: r.classification,
          activityType,
          color: r.classification === 'productive' ? getTypeColor(activityType) : '#f44336',
        };
      });
      result.push({
        hour: h,
        productive: hrRecords.filter(r => r.classification === 'productive').length,
        slacking: hrRecords.filter(r => r.classification === 'slacking').length,
        total: hrRecords.length,
        items,
      });
    }
    return result;
  }

  const data = $derived(hourData(selectedDate));
  const maxCount = $derived(Math.max(1, ...data.map(d => d.total)));
  const totalProductive = $derived(data.reduce((s, d) => s + d.productive, 0));
  const totalSlacking = $derived(data.reduce((s, d) => s + d.slacking, 0));

  // Aggregate all activity types for the day
  const allTypes = $derived(() => {
    const types = new Map<string, { count: number; classification: string }>();
    for (const d of data) {
      for (const item of d.items) {
        const existing = types.get(item.activityType);
        if (existing) {
          existing.count++;
        } else {
          types.set(item.activityType, { count: 1, classification: item.classification });
        }
      }
    }
    return types;
  });

  function prevDay() {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    selectedDate = d.toISOString().slice(0, 10);
  }

  function nextDay() {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    selectedDate = d.toISOString().slice(0, 10);
  }

  function today() {
    selectedDate = new Date().toISOString().slice(0, 10);
  }

  function handleCalibrate(record: ActivityRecord, newClassification: 'productive' | 'slacking') {
    onCalibrate?.(record, newClassification);
    calibratingId = null;
  }
</script>

<div class="chart-container">
  <div class="chart-header">
    <button class="nav-btn" onclick={prevDay}>◀</button>
    <span class="date-label">{selectedDate}</span>
    <button class="nav-btn" onclick={nextDay}>▶</button>
    <button class="today-btn" onclick={today}>今天</button>
  </div>

  <div class="summary">
    <span class="productive-label">工作: {totalProductive}次</span>
    <span class="slacking-label">摸鱼: {totalSlacking}次</span>
    <span class="total-label">总计: {totalProductive + totalSlacking}次</span>
  </div>

  <!-- Activity type breakdown -->
  {#if allTypes().size > 0}
    <div class="type-summary">
      {#each [...allTypes().entries()] as [type, info] (type)}
        <span class="type-tag" style="background: {getTypeColor(type)}18; border-color: {getTypeColor(type)}40; color: {getTypeColor(type)}">
          <span class="type-dot" style="background: {getTypeColor(type)}"></span>
          {type}: {info.count}次
        </span>
      {/each}
    </div>
  {/if}

  <!-- Hourly bar chart -->
  <div class="chart">
    {#each data as d (d.hour)}
      <div class="hour-col" title="{d.hour}:00 - 工作{d.productive}次 / 摸鱼{d.slacking}次">
        <div class="bar-container">
          {#if d.total > 0}
            {#each d.items as item, i}
              <div
                class="bar-segment"
                style="height: {(1 / maxCount) * 100}%; background: {item.color};"
                title="{item.activityType}"
              ></div>
            {/each}
          {/if}
        </div>
        <span class="hour-label">{d.hour % 2 === 0 ? d.hour : ''}</span>
      </div>
    {/each}
  </div>

  <div class="legend">
    <span class="legend-item"><span class="legend-color" style="background: #4caf50"></span> 工作</span>
    <span class="legend-item"><span class="legend-color" style="background: #f44336"></span> 摸鱼</span>
  </div>

  <!-- Record list with activity type -->
  <div class="record-list">
    <h4>活动明细</h4>
    {#each dateRecords(selectedDate) as record (record.id)}
      <div class="record-item">
        <span class="record-time">{new Date(record.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
        <span class="record-classification" class:productive={record.classification === 'productive'} class:slacking={record.classification === 'slacking'}>
          {record.classification === 'productive' ? '工作' : '摸鱼'}
        </span>
        <span class="record-type" style="color: {getTypeColor(record.activityType || '')}">
          {record.activityType || '-'}
        </span>
        {#if record.windowTitle}
          <span class="record-window" title="{record.windowTitle}（{record.processName}）">
            {record.windowTitle.length > 15 ? record.windowTitle.slice(0, 15) + '…' : record.windowTitle}
          </span>
        {/if}
        {#if record.aiComment}
          <span class="record-comment" title={record.aiComment}>{record.aiComment}</span>
        {/if}
        <span class="record-source">
          {record.classificationSource === 'ai' ? 'AI' : record.classificationSource === 'manual' ? '手动' : '规则'}
        </span>
        {#if onCalibrate && record.classificationSource !== 'manual'}
          {#if calibratingId === record.id}
            <span class="calibrate-actions">
              <button class="calibrate-btn" onclick={() => handleCalibrate(record, 'productive')}>工作</button>
              <button class="calibrate-btn calibrate-slacking" onclick={() => handleCalibrate(record, 'slacking')}>摸鱼</button>
              <button class="calibrate-btn calibrate-cancel" onclick={() => calibratingId = null}>取消</button>
            </span>
          {:else}
            <button class="calibrate-trigger" onclick={() => calibratingId = record.id}>校准</button>
          {/if}
        {/if}
      </div>
    {/each}
    {#if dateRecords(selectedDate).length === 0}
      <p class="empty">当天暂无活动记录</p>
    {/if}
  </div>
</div>

<style>
  .chart-container {
    padding: 10px;
    font-size: 12px;
    box-sizing: border-box;
  }
  .chart-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .nav-btn, .today-btn {
    background: none;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 12px;
  }
  .nav-btn:hover, .today-btn:hover {
    background: #f5f5f5;
  }
  .date-label {
    font-weight: 600;
    min-width: 100px;
    text-align: center;
  }
  .summary {
    display: flex;
    gap: 12px;
    margin-bottom: 8px;
    font-size: 11px;
  }
  .productive-label { color: #4caf50; }
  .slacking-label { color: #f44336; }
  .total-label { color: #666; }

  .type-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 8px;
  }
  .type-tag {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    border: 1px solid;
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .type-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .chart {
    display: flex;
    align-items: flex-end;
    gap: 1px;
    height: 100px;
    border-bottom: 1px solid #ddd;
    padding-bottom: 4px;
    overflow: hidden;
  }
  .hour-col {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
  }
  .bar-container {
    flex: 1;
    width: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    min-height: 0;
  }
  .bar-segment {
    width: 100%;
    min-height: 3px;
    border-radius: 1px 1px 0 0;
    flex-shrink: 0;
  }
  .hour-label {
    font-size: 9px;
    color: #999;
    margin-top: 2px;
    flex-shrink: 0;
  }

  .legend {
    display: flex;
    gap: 12px;
    margin-top: 8px;
    font-size: 11px;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .legend-color {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }

  .record-list {
    margin-top: 12px;
    border-top: 1px solid #eee;
    padding-top: 8px;
  }
  .record-list h4 {
    margin: 0 0 6px 0;
    font-size: 12px;
    color: #555;
  }
  .record-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
    font-size: 11px;
    border-bottom: 1px solid #f5f5f5;
    overflow: hidden;
  }
  .record-time {
    color: #999;
    min-width: 40px;
    flex-shrink: 0;
  }
  .record-classification {
    font-weight: 600;
    min-width: 28px;
    flex-shrink: 0;
  }
  .record-classification.productive { color: #4caf50; }
  .record-classification.slacking { color: #f44336; }
  .record-type {
    font-weight: 500;
    min-width: 60px;
    flex-shrink: 0;
  }
  .record-window {
    flex: 1;
    color: #888;
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .record-comment {
    max-width: 80px;
    font-size: 10px;
    color: #ff9800;
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .record-source {
    font-size: 10px;
    color: #aaa;
    min-width: 24px;
    flex-shrink: 0;
  }
  .calibrate-trigger {
    font-size: 10px;
    padding: 1px 4px;
    border: 1px solid #ddd;
    border-radius: 3px;
    background: none;
    color: #999;
    cursor: pointer;
    flex-shrink: 0;
  }
  .calibrate-trigger:hover {
    background: #f5f5f5;
    color: #333;
  }
  .calibrate-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }
  .calibrate-btn {
    font-size: 10px;
    padding: 1px 4px;
    border: none;
    border-radius: 3px;
    background: #4caf50;
    color: white;
    cursor: pointer;
  }
  .calibrate-slacking {
    background: #f44336;
  }
  .calibrate-cancel {
    background: #ddd;
    color: #666;
  }
  .empty {
    color: #aaa;
    font-size: 11px;
    text-align: center;
    margin: 8px 0;
  }
</style>
