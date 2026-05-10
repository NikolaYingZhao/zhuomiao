export interface Task {
  id: string;
  title: string;
  category: string;
  priority: 'low' | 'medium' | 'high';
  dueDate: string | null;
  completed: boolean;
  createdAt: string;
  completionHint?: string;
  completionMethod?: 'manual' | 'ai_detected' | null;
}

export interface MonitorRule {
  id: string;
  pattern: string;
  ruleType: 'url' | 'process';
  isBlacklist: boolean;
  message: string;
}

export interface ActiveWindow {
  title: string;
  processName: string;
  processId: number;
}

export type PetState = 'idle' | 'happy' | 'angry' | 'worried' | 'sleeping' | 'eating' | 'playing';

export interface AIConfig {
  provider: string;
  endpoint: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
}

export type ActivityClassification = 'productive' | 'slacking';
export type ClassificationSource = 'ai' | 'rule_based' | 'manual';

export interface ActivityRecord {
  id: string;
  timestamp: string;
  windowTitle: string;
  processName: string;
  classification: ActivityClassification;
  classificationSource: ClassificationSource;
  activityType?: string;
  aiComment?: string;
  taskId?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export type TaskAction =
  | { type: 'complete'; taskId: string }
  | { type: 'updateHint'; taskId: string; newHint: string };

export interface ChatResponse {
  message: string;
  actions: TaskAction[];
}

export interface DbStatusInfo {
  available: boolean;
  mode: 'mysql' | 'file';
}

export interface MigrationReport {
  successCount: number;
  skipCount: number;
  errorCount: number;
  errors: string[];
}

export interface TaskChatContext {
  tasks: Task[];
  currentTaskId?: string;
}
