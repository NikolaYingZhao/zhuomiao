import type { AIConfig } from '$lib/types';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
