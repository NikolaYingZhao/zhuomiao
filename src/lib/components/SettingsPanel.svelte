<script lang="ts">
  import { aiConfig, monitorRules } from '$lib/stores';
  import type { AIConfig, MonitorRule } from '$lib/types';
  import { getDataDir, setDataDir, saveAiConfig as persistAiConfig, saveMonitorRules as persistMonitorRules } from '$lib/services/persistence';
  import type { AppDataDir } from '$lib/services/persistence';
  import { open } from '@tauri-apps/plugin-dialog';
  import { validateAiConfig } from '$lib/services/ai';

  let tab = $state<'general' | 'monitor' | 'ai'>('general');

  let localAiConfig = $state<AIConfig>({ ...$aiConfig });
  let localRules = $state<MonitorRule[]>([...$monitorRules]);
  let dataDir = $state<AppDataDir>({ path: '', isDefault: true });
  let dataDirInput = $state('');
  let dataDirStatus = $state<string | null>(null);
  let saveStatus = $state<string | null>(null);
  let isSaving = $state(false);
  let testStatus = $state<string | null>(null);
  let isTesting = $state(false);

  function sanitizeError(e: any): string {
    const msg = String(e?.message || e);
    return msg.replace(/sk-[a-zA-Z0-9]{10,}/g, 'sk-***');
  }

  async function loadDataDirInfo() {
    try {
      dataDir = await getDataDir();
      dataDirInput = dataDir.path;
    } catch (e) {
      console.error('获取数据目录失败:', e);
    }
  }

  async function changeDataDir() {
    if (!dataDirInput.trim()) return;
    try {
      await setDataDir(dataDirInput.trim());
      dataDir = { path: dataDirInput.trim(), isDefault: false };
      dataDirStatus = '数据存储位置已更新！';
      setTimeout(() => { dataDirStatus = null; }, 3000);
    } catch (e: any) {
      dataDirStatus = `设置失败: ${e}`;
      setTimeout(() => { dataDirStatus = null; }, 5000);
    }
  }

  async function selectDataDir() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === 'string') {
        dataDirInput = selected;
      }
    } catch (e) {
      console.error('选择目录失败:', e);
    }
  }

  loadDataDirInfo();

  let newPattern = $state('');
  let newMessage = $state('不是应该在学习吗？怎么在摸鱼啊！');
  let newIsBlacklist = $state(true);

  async function saveAiConfig() {
    isSaving = true;
    saveStatus = null;

    try {
      const validation = await validateAiConfig(localAiConfig);
      if (!validation.success) {
        saveStatus = `error:${validation.error || 'API 配置有误，请检查 API-Key 和对应的响应地址'}`;
        setTimeout(() => { saveStatus = null; }, 8000);
        console.error('API验证失败:', validation.errorType, validation.error);
        return;
      }

      const oldConfig = { ...$aiConfig };
      aiConfig.set(localAiConfig);

      try {
        await persistAiConfig();
        saveStatus = 'success:API 配置成功！';
        setTimeout(() => { saveStatus = null; }, 5000);
      } catch (e: any) {
        aiConfig.set(oldConfig);
        localAiConfig = { ...oldConfig };
        saveStatus = `error:API 验证通过，但保存失败: ${sanitizeError(e)}`;
        setTimeout(() => { saveStatus = null; }, 8000);
        console.error('保存AI配置失败:', e);
      }
    } catch (e: any) {
      saveStatus = `error:验证过程出错: ${sanitizeError(e)}`;
      setTimeout(() => { saveStatus = null; }, 8000);
      console.error('验证过程出错:', e);
    } finally {
      isSaving = false;
    }
  }

  async function testConnection() {
    if (!localAiConfig.endpoint || !localAiConfig.apiKey) {
      testStatus = 'error:请先填写 API 端点和 API Key';
      setTimeout(() => { testStatus = null; }, 5000);
      return;
    }
    isTesting = true;
    testStatus = null;
    try {
      const validation = await validateAiConfig(localAiConfig);
      if (validation.success) {
        testStatus = 'success:API 连接成功！配置有效';
      } else {
        testStatus = `error:${validation.error || 'API 连接失败，请检查配置'}`;
      }
    } catch (e: any) {
      testStatus = `error:测试失败: ${sanitizeError(e)}`;
    } finally {
      isTesting = false;
      setTimeout(() => { testStatus = null; }, 8000);
    }
  }

  async function addRule() {
    if (!newPattern.trim()) return;
    const rule: MonitorRule = {
      id: crypto.randomUUID(),
      pattern: newPattern.trim(),
      ruleType: 'url',
      isBlacklist: newIsBlacklist,
      message: newMessage,
    };
    localRules = [...localRules, rule];
    monitorRules.set(localRules);
    newPattern = '';
    await persistMonitorRules();
  }

  async function removeRule(id: string) {
    localRules = localRules.filter(r => r.id !== id);
    monitorRules.set(localRules);
    await persistMonitorRules();
  }
</script>

<div class="settings">
  <div class="tabs">
    <button class="tab" class:active={tab === 'general'} onclick={() => tab = 'general'}>通用</button>
    <button class="tab" class:active={tab === 'monitor'} onclick={() => tab = 'monitor'}>监控规则</button>
    <button class="tab" class:active={tab === 'ai'} onclick={() => tab = 'ai'}>AI 配置</button>
  </div>

  {#if tab === 'general'}
    <div class="section">
      <h3>通用设置</h3>
      <div class="field inline-field">
        <input type="checkbox" id="autostart" disabled />
        <label for="autostart">开机自启动 <span class="hint">（即将支持）</span></label>
      </div>
      <div class="field">
        <label>监控检查间隔（秒）</label>
        <input type="number" value="45" min="5" max="300" disabled />
        <span class="hint">即将支持自定义</span>
      </div>
      <div class="field">
        <label>提醒气泡显示时长（秒）</label>
        <input type="number" value="5" min="1" max="30" disabled />
        <span class="hint">即将支持自定义</span>
      </div>
    </div>
    <div class="section">
      <h3>数据存储位置</h3>
      <p class="hint">
        {#if dataDir.isDefault}
          当前使用默认位置（通常在 C 盘 AppData 目录下）
        {:else}
          当前使用自定义位置
        {/if}
      </p>
      <div class="data-dir-row">
        <input type="text" bind:value={dataDirInput} placeholder="选择数据存储目录" readonly />
        <button class="browse-btn" onclick={selectDataDir}>浏览</button>
      </div>
      <p class="current-dir">当前路径: {dataDir.path}</p>
      <button class="save-btn" onclick={changeDataDir}>更改存储位置</button>
      {#if dataDirStatus}
        <p class="status-msg">{dataDirStatus}</p>
      {/if}
      <p class="hint">更改后，数据会自动保存到新位置。建议选择非 C 盘路径以节省系统盘空间。</p>
    </div>
  {:else if tab === 'monitor'}
    <div class="section">
      <h3>监控规则</h3>
      <p class="hint">设置黑名单网站/应用，桌喵检测到你访问时会提醒你</p>

      <div class="add-rule">
        <input type="text" placeholder="如: xiaohongshu,bilibili" bind:value={newPattern} />
        <input type="text" placeholder="提醒消息" bind:value={newMessage} />
        <label class="toggle">
          <input type="checkbox" bind:checked={newIsBlacklist} />
          黑名单
        </label>
        <button onclick={addRule}>添加</button>
      </div>

      <div class="rules-list">
        {#each localRules as rule (rule.id)}
          <div class="rule-item">
            <span class="rule-pattern">{rule.pattern}</span>
            <span class="rule-type">{rule.isBlacklist ? '黑名单' : '白名单'}</span>
            <span class="rule-msg">"{rule.message}"</span>
            <button class="remove-btn" onclick={() => removeRule(rule.id)}>x</button>
          </div>
        {/each}
        {#if localRules.length === 0}
          <p class="empty">还没有监控规则，添加一些让桌喵帮你监督吧！</p>
        {/if}
      </div>
    </div>
  {:else if tab === 'ai'}
    <div class="section">
      <h3>AI 对话配置</h3>
      <p class="hint">配置 API 后桌喵可以用 AI 智能判断你在摸鱼还是做正事</p>

      <div class="field">
        <label>API 端点</label>
        <input type="text" bind:value={localAiConfig.endpoint} />
      </div>
      <div class="field">
        <label>API Key</label>
        <input type="password" bind:value={localAiConfig.apiKey} />
      </div>
      <div class="field">
        <label>模型</label>
        <input type="text" bind:value={localAiConfig.model} />
      </div>
      <div class="field">
        <label>系统提示词</label>
        <textarea bind:value={localAiConfig.systemPrompt} rows="4"></textarea>
      </div>
      <div class="btn-row">
        <button class="test-btn" onclick={testConnection} disabled={isTesting}>
          {isTesting ? '测试中...' : '测试连接'}
        </button>
        <button class="save-btn" onclick={saveAiConfig} disabled={isSaving}>
          {isSaving ? '验证中...' : '保存配置'}
        </button>
      </div>
      {#if testStatus}
        {@const isTestSuccess = testStatus.startsWith('success:')}
        {@const testMsg = testStatus.replace(/^(success|error):/, '')}
        <p class="status-msg" class:success={isTestSuccess} class:error={!isTestSuccess}>
          {testMsg}
        </p>
      {/if}
      {#if saveStatus}
        {@const isSuccess = saveStatus.startsWith('success:')}
        {@const msg = saveStatus.replace(/^(success|error):/, '')}
        <p class="status-msg" class:success={isSuccess} class:error={!isSuccess}>
          {msg}
        </p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .settings {
    padding: 16px;
    height: 100%;
    overflow-y: auto;
  }
  .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 16px;
    border-bottom: 2px solid #f0f0f0;
    padding-bottom: 8px;
  }
  .tab {
    padding: 6px 16px;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 14px;
    color: #888;
    border-radius: 8px 8px 0 0;
  }
  .tab.active {
    color: #ff9f43;
    font-weight: 600;
    background: #fff8f0;
  }
  .section h3 {
    margin: 0 0 12px 0;
    color: #333;
    font-size: 16px;
  }
  .hint {
    font-size: 12px;
    color: #999;
    margin-bottom: 12px;
  }
  .field {
    margin-bottom: 12px;
  }
  .field label {
    display: block;
    font-size: 13px;
    color: #555;
    margin-bottom: 4px;
  }
  .inline-field {
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }
  .inline-field input[type="checkbox"] {
    width: auto;
    margin: 2px 0 0 0;
    flex-shrink: 0;
  }
  .inline-field label {
    margin-bottom: 0;
    cursor: pointer;
    line-height: 1.4;
  }
  .field input, .field textarea {
    width: 100%;
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 13px;
    box-sizing: border-box;
  }
  .add-rule {
    display: flex;
    gap: 6px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .add-rule input {
    padding: 6px 8px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 12px;
    flex: 1;
    min-width: 80px;
  }
  .add-rule button {
    padding: 6px 12px;
    border: none;
    border-radius: 6px;
    background: #ff9f43;
    color: white;
    cursor: pointer;
    font-size: 12px;
  }
  .toggle {
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .rule-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: #f8f9fa;
    border-radius: 6px;
    margin-bottom: 4px;
    font-size: 12px;
  }
  .rule-pattern {
    font-weight: 600;
    color: #333;
  }
  .rule-type {
    color: #f44336;
    font-size: 11px;
  }
  .rule-msg {
    color: #888;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .remove-btn {
    background: none;
    border: none;
    color: #ccc;
    cursor: pointer;
    font-size: 14px;
  }
  .remove-btn:hover {
    color: #f44336;
  }
  .empty {
    color: #aaa;
    font-size: 12px;
    text-align: center;
  }
  .btn-row {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .test-btn {
    flex: 1;
    padding: 8px;
    border: 1px solid #ff9f43;
    border-radius: 6px;
    background: white;
    color: #ff9f43;
    cursor: pointer;
    font-size: 14px;
  }
  .test-btn:hover:not(:disabled) {
    background: #fff8f0;
  }
  .test-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .save-btn {
    flex: 1;
    padding: 8px;
    border: none;
    border-radius: 6px;
    background: #ff9f43;
    color: white;
    cursor: pointer;
    font-size: 14px;
  }
  .data-dir-row {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }
  .data-dir-row input {
    flex: 1;
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 12px;
    box-sizing: border-box;
    background: #f8f9fa;
  }
  .browse-btn {
    padding: 8px 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    background: white;
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
  }
  .browse-btn:hover {
    background: #f0f0f0;
  }
  .current-dir {
    font-size: 11px;
    color: #999;
    margin: 4px 0 8px 0;
    word-break: break-all;
  }
  .status-msg {
    font-size: 12px;
    color: #4caf50;
    margin: 4px 0;
  }
  .status-msg.success {
    color: #4caf50;
  }
  .status-msg.error {
    color: #f44336;
    font-weight: 600;
  }
  .save-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
