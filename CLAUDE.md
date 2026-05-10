# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Project: 桌喵 (Zhuomiao)

A smart desktop pet cat built with **Tauri 2** + **SvelteKit** + **TypeScript** (frontend) and **Rust** (backend). The pet sits on your desktop, monitors active windows, and nags you when you're slacking off (摸鱼). Windows-only.

## Commands

```bash
# Install dependencies
npm install

# Run in dev mode (opens Tauri window with hot reload)
npm run tauri dev

# Type-check Svelte components
npm run check

# Build for production (outputs installer to src-tauri/target/release/)
npm run tauri build
```

## Architecture

### Three Tauri Windows

| Label | Purpose | Initial State |
|---|---|---|
| `pet` (main) | Transparent overlay with animated cat | Visible, always-on-top, 280×320 |
| `panel` | Task management UI | Hidden, 420×640 |
| `settings` | 3-tab settings (general / monitor rules / AI config) | Hidden, 480×600 |

### Frontend (`src/`)

- **`src/routes/+page.svelte`** — Core pet window logic (~760 lines). Contains the 45-second activity monitoring loop, drag handling, speech bubbles, context menu, multi-window orchestration, quick task input with AI-suggested completion hints, QuickChat panel, activity chart, and task completion confirmation flow.
- **`src/routes/panel/+page.svelte`** — Hosts `TaskPanel` component.
- **`src/routes/settings/+page.svelte`** — Hosts `SettingsPanel` component.
- **`src/lib/components/`** — `PetAnimation.svelte` (pure CSS cat with 7 animation states), `TaskPanel.svelte`, `TaskItem.svelte`, `SettingsPanel.svelte`, `ActivityChart.svelte` (hourly bar chart with manual calibration), `SpeechBubble.svelte`, `QuickChat.svelte` (AI chat panel for task management).
- **`src/lib/services/ai.ts`** — AI integration: `classifyActivity()` (structured classification + activity type), `chatWithAI()`, `guessActivityType()` (rule-based heuristic fallback), `validateAiConfig()`.
- **`src/lib/services/chat.ts`** — QuickChat logic: `buildTaskContextPrompt()` (injects task list into AI context), `chatWithTaskContext()`, `parseChatResponse()` (extracts `[COMPLETE:id]` and `[HINT:id:text]` actions from AI replies).
- **`src/lib/services/persistence.ts`** — Dual-mode persistence: tries MySQL via `invoke()` first, falls back to JSON file storage on DB errors. Exports `createTask`, `removeTask`, `updateTask`, `toggleTask`, `clearCompleted`, `loadAllFromDB`, `saveAll`, `loadAll`, `setupAutoSave`. All task operations update the Svelte store immediately and persist in background.
- **`src/lib/stores/index.ts`** — Svelte 5 writable/derived stores. `createTaskStore()` factory with `add`/`remove`/`toggle`/`updateTask`/`clearCompleted`. Exports: `tasks`, `petState`, `petMessage`, `isPanelOpen`, `isSettingsOpen`, `monitorRules`, `activeWindow`, `aiConfig`, `activityRecords`, `dbStatus`, `chatMessages`. Derived stores: `incompleteTasks`, `completedTasks`, `tasksByCategory`.
- **`src/lib/types/index.ts`** — Core types: `Task` (with `completionHint`, `completionMethod`), `MonitorRule`, `ActiveWindow`, `PetState`, `AIConfig`, `ActivityRecord` (with `classificationSource`, `activityType`, `aiComment`, `taskId`), `ChatMessage`, `TaskAction`, `ChatResponse`, `DbStatusInfo`, `MigrationReport`.

### Backend (`src-tauri/src/`)

Modular structure (previously a single `lib.rs`):

- **`lib.rs`** — App entry point. Reads `DATABASE_URL` from `.env`, connects to MySQL via `sqlx`, runs migrations, falls back to file mode on failure. Registers all Tauri commands. Sets up system tray with "显示桌喵" / "彻底退出" menu. Windows-only active window detection via Win32 API (`GetForegroundWindow`, `GetWindowThreadProcessId`, `OpenProcess`, `QueryFullProcessImageNameW`). Also exposes `check_fish_detection` (rule-based slacking detection with task awareness).
- **`db/mod.rs`** — `DbState` struct wrapping an optional `MySqlPool` + atomic `is_file_mode` flag. `connect()` establishes MySQL connection, `run_migrations()` creates 4 tables (`tasks`, `activity_records`, `monitor_rules`, `ai_config`).
- **`models.rs`** — Database model structs with `sqlx::FromRow`: `DbTask`, `TaskInput`, `TaskPatch`, `DbActivityRecord`, `ActivityInput`, `DbMonitorRule`, `DbAiConfig`, `DbStatusInfo`, `MigrationReport`.
- **`commands/task.rs`** — `db_task_create`, `db_task_remove`, `db_task_update` (dynamic SQL for partial updates), `db_task_list`, `db_task_clear_completed`, `db_task_toggle`.
- **`commands/activity.rs`** — `db_activity_create`, `db_activity_list`, `db_activity_calibrate` (manual re-classification).
- **`commands/rule.rs`** — `db_rule_list`, `db_rule_save` (full replace).
- **`commands/config.rs`** — `db_config_get`, `db_config_save` (upsert), `db_status`, `db_connect` (runtime reconnect).
- **`commands/migration.rs`** — `migrate_from_json` — one-time migration from legacy JSON files to MySQL. Migrates tasks, monitor rules, and AI config with skip-on-duplicate logic.

### Data Flow

```
Win32 API → Rust get_active_window → Frontend checkActivity() (every 45s)
  → Rule matching (blacklist on title/process, skips if no incomplete tasks)
  → AI judgment (if configured; classifyActivity for structured type + chatWithAI for response)
  → AI may detect task completion → "completed?" confirmation → toggleTask with 'ai_detected'
  → Speech bubble + pet state change
  → ActivityRecord persisted (DB or JSON file)
```

### Dual Persistence Mode

- **MySQL mode** (default when `DATABASE_URL` is set in `.env`): All CRUD goes through `sqlx` MySQL queries. Falls back to file mode on connection loss.
- **File mode** (fallback / no `DATABASE_URL`): JSON files in the app data directory. Same format as before.
- **Migration**: `migrate_from_json` command transfers data from JSON files to MySQL (run once, skips duplicates).
- `.env` file at project root: `DATABASE_URL=mysql://user:pass@host/dbname`

### Data Model (MySQL Tables)

- `tasks` — `id VARCHAR(36) PK`, `title`, `category`, `priority`, `due_date`, `completed`, `created_at`, `completion_hint`, `completion_method`
- `activity_records` — `id VARCHAR(50) PK`, `timestamp`, `window_title`, `process_name`, `classification`, `classification_source`, `activity_type`, `ai_comment`, `task_id`
- `monitor_rules` — `id VARCHAR(36) PK`, `pattern`, `rule_type`, `is_blacklist`, `message`
- `ai_config` — `id INT PK DEFAULT 1`, `provider`, `endpoint`, `api_key`, `model`, `system_prompt`

### QuickChat Feature

An AI-powered chat interface (`QuickChat.svelte`) accessible from the pet window. Users can chat with the cat to manage tasks naturally. The AI receives the full task list as context and can emit structured actions (`[COMPLETE:id]`, `[HINT:id:text]`) embedded in natural language replies. Actions are parsed and executed automatically.

### Key Constants

- Monitor interval: 45 seconds (`MONITOR_INTERVAL_MS` in `+page.svelte`)
- Alert cooldown: 30 seconds (`lastAlertTime` in `+page.svelte`)
- QuickChat auto-close timeout: 30 seconds
- Auto-save interval: 5 seconds
- Speech bubble duration: 5 seconds
- Activity records retention: 30 days
- Tauri dev server port: 1420
- Default AI: OpenAI `gpt-4o-mini` with Chinese system prompt (cat persona)
- App version: 1.0.3

### Platform Notes

- Windows-only (`#[cfg(target_os = "windows")]` in Rust). Non-Windows gets stubs returning empty strings.
- Uses `@tauri-apps/api` v2, `@tauri-apps/plugin-opener`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-store`.
- SvelteKit runs in SPA mode (`adapter-static` with `fallback: "index.html"`), SSR disabled.
- Rust async runtime: `tokio` (full features). MySQL driver: `sqlx` with `runtime-tokio-rustls`.
