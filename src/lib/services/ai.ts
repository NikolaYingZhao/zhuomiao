import type { AIConfig, ActivityClassification, ClassificationSource } from '$lib/types';
import { get } from 'svelte/store';
import { aiConfig } from '$lib/stores';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ValidationResult {
  success: boolean;
  error?: string;
  errorType?: 'auth' | 'timeout' | 'network' | 'format' | 'unknown';
}

export async function validateAiConfig(config: AIConfig): Promise<ValidationResult> {
  if (!config.apiKey) {
    return { success: true };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${config.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 401 || response.status === 403) {
      return { success: false, error: 'API 配置有误，请检查 API-Key 和对应的响应地址', errorType: 'auth' };
    }

    if (!response.ok) {
      return { success: false, error: `API 返回错误 (${response.status})，请检查端点地址`, errorType: 'network' };
    }

    const data = await response.json();
    if (data.choices?.[0]?.message?.content !== undefined) {
      return { success: true };
    }

    return { success: false, error: 'API 响应格式异常，请检查端点地址', errorType: 'format' };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { success: false, error: 'API 连接超时，请检查端点地址是否正确', errorType: 'timeout' };
    }
    return { success: false, error: 'API 连接失败，请检查端点地址是否正确', errorType: 'network' };
  }
}

export async function classifyActivity(
  config: AIConfig,
  windowTitle: string,
  processName: string,
  incompleteTaskTitles: string[]
): Promise<{ classification: ActivityClassification; source: ClassificationSource; activityType?: string }> {
  if (!config.apiKey) {
    return { classification: 'productive', source: 'rule_based', activityType: guessActivityType(windowTitle, processName) };
  }

  try {
    // Use a separate minimal prompt for structured classification only (no system prompt)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`${config.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'system',
            content: '你是一个活动分类助手。只回复一行，格式为：分类|活动类型。分类只能是 productive 或 slacking。活动类型格式：动作-对象（如 编程-VSCode、浏览网页-Chrome、看视频-B站、文档编辑-Word、聊天-微信、学习-网课）。不要回复任何其他内容。'
          },
          {
            role: 'user',
            content: `窗口标题：${windowTitle}\n进程名称：${processName}\n未完成任务：${incompleteTaskTitles.join('、') || '无'}`
          }
        ],
        max_tokens: 30,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const result = (data.choices?.[0]?.message?.content || '').trim();
    const parts = result.split('|');
    const classification: ActivityClassification = parts[0]?.toLowerCase().includes('slacking') ? 'slacking' : 'productive';
    const activityType = parts[1]?.trim() || guessActivityType(windowTitle, processName);

    return { classification, source: 'ai', activityType };
  } catch {
    return { classification: 'productive', source: 'rule_based', activityType: guessActivityType(windowTitle, processName) };
  }
}

export function guessActivityType(windowTitle: string, processName: string): string {
  const title = windowTitle.toLowerCase();
  const proc = processName.toLowerCase();

  // Detect by process name first
  if (proc.includes('code') || proc.includes('idea') || proc.includes('vim') || proc.includes('cursor') || proc.includes('studio')) return `编程-${processName}`;
  if (proc.includes('wechat') || proc.includes('qq') || proc.includes('telegram') || proc.includes('dingtalk') || proc.includes('feishu') || proc.includes('slack')) return `聊天-${processName}`;
  if (proc.includes('word') || proc.includes('excel') || proc.includes('powerpoint') || proc.includes('wps') || proc.includes('notion')) return `文档编辑-${processName}`;
  if (proc.includes('obs') || proc.includes('zoom') || proc.includes('teams') || proc.includes('meeting')) return `会议-${processName}`;
  if (proc.includes('chrome') || proc.includes('firefox') || proc.includes('edge') || proc.includes('browser')) {
    // Try to detect what website from window title
    if (title.includes('bilibili') || title.includes('b站')) return '看视频-B站';
    if (title.includes('youtube')) return '看视频-YouTube';
    if (title.includes('抖音') || title.includes('douyin')) return '看视频-抖音';
    if (title.includes('小红书') || title.includes('xiaohongshu')) return '浏览-小红书';
    if (title.includes('github') || title.includes('gitlab')) return '编程-GitHub';
    if (title.includes('leetcode') || title.includes('力扣')) return '学习-刷题';
    if (title.includes('zhihu') || title.includes('知乎')) return '浏览-知乎';
    if (title.includes('csdn') || title.includes('stackoverflow')) return '学习-技术';
    if (title.includes(' - ') && title.includes('- ')) {
      // Try to extract site name from typical browser title format "Page Title - Site"
      const parts = title.split(' - ');
      if (parts.length >= 2) return `浏览网页-${parts[parts.length - 1].trim()}`;
    }
    return `浏览网页-${processName}`;
  }

  // Detect by window title
  if (title.includes('bilibili') || title.includes('b站')) return '看视频-B站';
  if (title.includes('youtube')) return '看视频-YouTube';
  if (title.includes('抖音') || title.includes('douyin')) return '看视频-抖音';
  if (title.includes('小红书') || title.includes('xiaohongshu')) return '浏览-小红书';
  if (title.includes(' - word') || title.includes('.doc')) return '文档编辑-Word';
  if (title.includes(' - excel') || title.includes('.xls')) return '文档编辑-Excel';
  if (title.includes(' - powerpoint') || title.includes('.ppt')) return '文档编辑-PPT';
  if (title.includes('visual studio code')) return '编程-VSCode';
  if (title.includes('intellij idea')) return '编程-IDEA';
  if (title.includes('pycharm')) return '编程-PyCharm';

  return `使用-${processName}`;
}

export async function chatWithAI(
  config: AIConfig,
  userMessage: string,
  history: ChatMessage[] = []
): Promise<string> {
  if (!config.apiKey) {
    return getFallbackResponse(userMessage);
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: config.systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];

  try {
    const response = await fetch(`${config.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: 150,
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '...';
  } catch (error) {
    console.error('AI chat error:', error);
    return getFallbackResponse(userMessage);
  }
}

function getFallbackResponse(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('小红书') || lower.includes('xiaohongshu')) {
    return pickRandom([
      '怎么在刷小红书啊！说好的学习呢？',
      '小红书很好看对吧？但是你的任务还没完成哦！',
      '又摸鱼！快回去学习！',
    ]);
  }
  if (lower.includes('bilibili') || lower.includes('b站')) {
    return pickRandom([
      'B站又有好视频了？但你的网课还没看完呢！',
      '说好的看网课呢，怎么刷起B站了！',
    ]);
  }
  if (lower.includes('抖音') || lower.includes('douyin')) {
    return pickRandom([
      '抖音一刷就停不下来！快关掉！',
      '不要在抖音浪费时间啦～任务在等你呢！',
    ]);
  }
  if (lower.includes('完成') || lower.includes('做完了')) {
    return pickRandom([
      '太棒了！你完成任务了！喵～',
      '好厉害！桌喵为你骄傲！',
    ]);
  }
  return pickRandom([
    '喵～记得完成今天的任务哦！',
    '桌喵在监督你哦～不要摸鱼！',
    '加油！你可以的！',
  ]);
}

export async function getCompletionHint(taskTitle: string): Promise<string> {
  const config = get(aiConfig);
  if (!config.apiKey) return '';
  try {
    const result = await chatWithAI(
      config,
      `用户创建了任务："${taskTitle}"。请用一句话说明如何判断这个任务是否完成（15字以内）。例如："关闭文档即完成" 或 "运行测试通过即完成"。`
    );
    return result || '';
  } catch {
    return '';
  }
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
