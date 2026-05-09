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

  function hourData(date: string): { hour: number; productive: number; slacking: number; total: number; types: Map<string, number> }[] {
    const dayRecords = dateRecords(date);
    const result: { hour: number; productive: number; slacking: number; total: number; types: Map<string, number> }[] = [];
    for (let h = 0; h < 24; h++) {
      const hrRecords = dayRecords.filter(r => new Date(r.timestamp).getHours() === h);
      const types = new Map<string, number>();
      for (const r of hrRecords) {
        const key = r.activityType || (r.classification === 'productive' ? '工作' : '摸鱼');
        types.set(key, (types.get(key) || 0) + 1);
      }
      result.push({
        hour: h,
        productive: hrRecords.filter(r => r.classification === 'productive').length,
        slacking: hrRecords.filter(r => r.classification === 'slacking').length,
        total: hrRecords.length,
        types,
      });
    }
    return result;
  }

  const data = $derived(hourData(selectedDate));
  const maxCount = $derived(Math.max(1, ...data.map(d => d.total)));
  const totalProductive = $derived(data.reduce((s, d) => s + d.productive, 0));
  const totalSlacking = $derived(data.reduce((s, d) => s + d.slacking, 0));

  const allTypes = $derived(() => {
    const types = new Map<string, number>();
    for (const d of data) {
      for (const [key, count] of d.types) {
        types.set(key, (types.get(key) || 0) + count);
      }
    }
    return types;
  });

  function prevDay() {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    selectedDate = d.toISOString().slice(0, 10);
  }

  function nextDay() {
    const d = new Date(selectedDate);
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

  {#if allTypes().size > 0}
    <div class="type-summary">
      {#each [...allTypes().entries()] as [type, count] (type)}
        <span class="type-tag">{type}: {count}</span>
      {/each}
    </div>
  {/if}

  <div class="chart">
    {#each data as d (d.hour)}
      <div class="hour-col" title="{d.hour}:00 - 工作{d.productive}次 / 摸鱼{d.slacking}次{d.types.size > 0 ? '\n' + [...d.types.entries()].map(([k,v]) => `${k}:${v}`).join(', ') : ''}">
        <div class="bar-container">
          {#if d.total > 0}
            <div
              class="bar productive-bar"
              style="height: {(d.productive / maxCount) * 100}%; width: {(d.productive / d.total) * 100}%;"
            ></div>
            <div
              class="bar slacking-bar"
              style="height: {(d.slacking / maxCount) * 100}%; width: {(d.slacking / d.total) * 100}%;"
            ></div>
          {/if}
        </div>
        <span class="hour-label">{d.hour % 2 === 0 ? d.hour : ''}</span>
      </div>
    {/each}
  </div>

  <div class="legend">
    <span class="legend-item"><span class="legend-color productive-color"></span> 工作</span>
    <span class="legend-item"><span class="legend-color slacking-color"></span> 摸鱼</span>
  </div>

  <div class="record-list">
    <h4>活动明细</h4>
    {#each dateRecords(selectedDate) as record (record.id)}
      <div class="record-item">
        <span class="record-time">{new Date(record.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
        <span class="record-classification" class:productive={record.classification === 'productive'} class:slacking={record.classification === 'slacking'}>
          {record.classification === 'productive' ? '工作' : '摸鱼'}
        </span>
        <span class="record-type">{record.activityType || '-'}</span>
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
    padding: 12px;
    font-size: 12px;
    min-width: 360px;
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
    gap: 6px;
    margin-bottom: 8px;
  }
  .type-tag {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    background: #f0f0f0;
    color: #555;
  }
  .chart {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 120px;
    border-bottom: 1px solid #ddd;
    padding-bottom: 4px;
  }
  .hour-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100%;
  }
  .bar-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    width: 100%;
    min-height: 2px;
  }
  .bar {
    min-height: 2px;
    border-radius: 1px 1px 0 0;
  }
  .productive-bar {
    background: #4caf50;
  }
  .slacking-bar {
    background: #f44336;
  }
  .hour-label {
    font-size: 9px;
    color: #999;
    margin-top: 2px;
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
  .productive-color { background: #4caf50; }
  .slacking-color { background: #f44336; }
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
  }
  .record-time {
    color: #999;
    min-width: 40px;
  }
  .record-classification {
    font-weight: 600;
    min-width: 28px;
  }
  .record-classification.productive { color: #4caf50; }
  .record-classification.slacking { color: #f44336; }
  .record-type {
    flex: 1;
    color: #555;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .record-comment {
    max-width: 100px;
    font-size: 10px;
    color: #ff9800;
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .record-source {
    font-size: 10px;
    color: #aaa;
    min-width: 24px;
  }
  .calibrate-trigger {
    font-size: 10px;
    padding: 1px 4px;
    border: 1px solid #ddd;
    border-radius: 3px;
    background: none;
    color: #999;
    cursor: pointer;
  }
  .calibrate-trigger:hover {
    background: #f5f5f5;
    color: #333;
  }
  .calibrate-actions {
    display: flex;
    gap: 2px;
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
