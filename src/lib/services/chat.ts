import type { AIConfig, Task, TaskAction, ChatResponse } from '$lib/types';
import { chatWithAI } from './ai';

export interface TaskChatContext {
  tasks: Task[];
  currentTaskId?: string;
}

export function buildTaskContextPrompt(context: TaskChatContext): string {
  const taskList = context.tasks
    .map(t => {
      const status = t.completed ? '[已完成]' : '[未完成]';
      const hint = t.completionHint ? `（检测标准：${t.completionHint}）` : '';
      return `- ${status} "${t.title}" (id: ${t.id})${hint}`;
    })
    .join('\n');

  return `你是桌喵，一只住在用户桌面上的小猫咪。用户正在和你聊天来管理任务。

当前任务列表：
${taskList}

你可以通过以下指令操作任务：
- 标记任务完成：在回复中包含 [COMPLETE:任务id]
- 修改任务检测规则：在回复中包含 [HINT:任务id:新的检测标准]

请在回复中自然地融入这些指令。例如：
用户："修改PPT做完了" → "太棒了！[COMPLETE:xxx] 你真厉害！喵～"
用户："检测规则改为保存PPT" → "好的！[HINT:xxx:保存PPT即完成] 已更新检测规则～"`;
}

export function parseChatResponse(raw: string): ChatResponse {
  const actions: TaskAction[] = [];
  let message = raw;

  const completeRegex = /\[COMPLETE:([^\]]+)\]/g;
  let match;
  while ((match = completeRegex.exec(raw)) !== null) {
    actions.push({ type: 'complete', taskId: match[1] });
    message = message.replace(match[0], '');
  }

  const hintRegex = /\[HINT:([^\]]+):([^\]]+)\]/g;
  while ((match = hintRegex.exec(raw)) !== null) {
    actions.push({ type: 'updateHint', taskId: match[1], newHint: match[2] });
    message = message.replace(match[0], '');
  }

  return { message: message.trim(), actions };
}

export async function chatWithTaskContext(
  config: AIConfig,
  userMessage: string,
  context: TaskChatContext,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): Promise<ChatResponse> {
  const contextPrompt = buildTaskContextPrompt(context);
  const fullHistory = [
    { role: 'user' as const, content: contextPrompt },
    { role: 'assistant' as const, content: '明白了！我已了解当前任务列表，随时可以帮你管理任务～喵！' },
    ...history,
  ];

  const raw = await chatWithAI(config, userMessage, fullHistory);
  return parseChatResponse(raw);
}
