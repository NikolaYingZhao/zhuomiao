import type { AIConfig, ActivityClassification, ClassificationSource } from '$lib/types';

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
    const result = await chatWithAI(
      config,
      `用户正在使用：${windowTitle}（进程：${processName}）
未完成任务：${incompleteTaskTitles.join('、') || '无'}
请判断用户当前是在工作还是在摸鱼，并说明具体活动类型。
回复格式：分类|活动类型
- 分类：productive 或 slacking
- 活动类型：简短描述具体行为，格式"动作-对象"（如"编程-VSCode"、"浏览网页-知乎"、"文档编辑-Word"、"聊天-微信"、"看视频-B站"）
示例：productive|编程-VSCode
示例：slacking|看视频-B站`
    );

    const trimmed = result.trim();
    const parts = trimmed.split('|');
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
  if (proc.includes('code') || proc.includes('idea') || proc.includes('vim') || proc.includes('cursor')) return `编程-${processName}`;
  if (proc.includes('chrome') || proc.includes('firefox') || proc.includes('edge') || proc.includes('browser')) return `浏览网页-${processName}`;
  if (proc.includes('wechat') || proc.includes('qq') || proc.includes('telegram')) return `聊天-${processName}`;
  if (proc.includes('word') || proc.includes('excel') || proc.includes('powerpoint') || proc.includes('wps')) return `文档编辑-${processName}`;
  if (title.includes('bilibili') || title.includes('b站')) return '看视频-B站';
  if (title.includes('抖音') || title.includes('douyin')) return '看视频-抖音';
  if (title.includes('小红书') || title.includes('xiaohongshu')) return '浏览-小红书';
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

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
