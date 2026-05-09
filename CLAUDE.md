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
| `panel` | Task management UI | Hidden, 420×560 |
| `settings` | 3-tab settings (general / monitor rules / AI config) | Hidden, 480×600 |

### Frontend (`src/`)

- **`src/routes/+page.svelte`** — Core pet window logic (~713 lines). Contains the 45-second activity monitoring loop, drag handling, speech bubbles, context menu, and multi-window orchestration (opens panel/settings windows via `WebviewWindow` API).
- **`src/routes/panel/+page.svelte`** — Hosts `TaskPanel` component.
- **`src/routes/settings/+page.svelte`** — Hosts `SettingsPanel` component.
- **`src/lib/components/`** — `PetAnimation.svelte` (pure CSS cat with 7 animation states), `TaskPanel.svelte`, `TaskItem.svelte`, `SettingsPanel.svelte`, `ActivityChart.svelte` (hourly bar chart with calibration), `SpeechBubble.svelte`.
- **`src/lib/services/ai.ts`** — AI integration: `classifyActivity()` (asks AI if current window is productive/slacking), `chatWithAI()`, `guessActivityType()` (rule-based heuristic fallback), `validateAiConfig()`.
- **`src/lib/services/persistence.ts`** — Bridges frontend to Rust via `invoke()`: `saveAppData`/`load_app_data`, custom data directory management, batched `saveAll()`/`loadAll()` with version tracking, 5-second auto-save.
- **`src/lib/stores/index.ts`** — Svelte 5 writable/derived stores. `createTaskStore()` factory with `add`/`remove`/`toggle`/`updateTask`/`clearCompleted`. Exports: `tasks`, `petState`, `petMessage`, `isPanelOpen`, `isSettingsOpen`, `monitorRules`, `activeWindow`, `aiConfig`, `activityRecords`.
- **`src/lib/types/index.ts`** — Core types: `Task`, `MonitorRule`, `ActiveWindow`, `PetState`, `AIConfig`, `ActivityRecord`.

### Backend (`src-tauri/src/lib.rs`)

Single 290-line file with all Rust logic:

- **`get_active_window`** — Uses Win32 API (`GetForegroundWindow`, `GetWindowThreadProcessId`, `OpenProcess`, `QueryFullProcessImageNameW`) to return foreground window title + process info.
- **`start_monitor_cycle`** — Background thread emitting `active-window-changed` events.
- **`save_app_data` / `load_app_data`** — Generic key-value JSON file persistence to the data directory.
- **`get_data_dir` / `set_data_dir`** — Custom data directory management.
- **System tray** — Tray icon with "显示桌喵" / "彻底退出" menu on startup.

### Data Flow

```
Win32 API → Rust get_active_window → Frontend checkActivity() (every 45s)
  → Rule matching (blacklist on title/process)
  → AI judgment (if configured; considers context like tutorial vs entertainment)
  → Speech bubble + pet state change
  → ActivityRecord persisted to {data_dir}/activity-records.json
```

### Data Model

All user data is persisted as individual JSON files in the app data directory:
- `tasks.json` — Task list
- `monitor-rules.json` — Blacklist rules
- `ai-config.json` — AI endpoint/key/model/prompt
- `activity-records.json` — 30-day rolling window of activity records

### Key Constants

- Monitor interval: 45 seconds (`MONITOR_INTERVAL_MS` in `+page.svelte`)
- Auto-save interval: 5 seconds
- Speech bubble duration: 5 seconds
- Tauri dev server port: 1420
- Default AI: OpenAI `gpt-4o-mini` with Chinese system prompt (cat persona)

### Platform Notes

- Windows-only (`#[cfg(target_os = "windows")]` in Rust). Non-Windows gets stubs returning empty strings.
- Uses `@tauri-apps/api` v2, `@tauri-apps/plugin-opener`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-store`.
- SvelteKit runs in SPA mode (`adapter-static` with `fallback: "index.html"`), SSR disabled.
