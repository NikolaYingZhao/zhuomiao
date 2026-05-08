# 桌喵 (Zhuomiao) 🐱

> 智能桌面宠物精灵，帮你管理任务、监督摸鱼。

> A smart desktop pet companion that helps you manage tasks and keeps you from slacking off.

![Version](https://img.shields.io/badge/version-1.0.2-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20-lightgrey)
![License](https://img.shields.io/license-MIT-green)

---

## ✨ Features / 功能特色

| Feature | 功能 | Description |
|---------|------|-------------|
| 🐱 Desktop Pet | 桌面宠物 | A cute cat pet lives on your desktop, always keeping you company |
| 📋 Task Management | 任务管理 | Add, complete, and track your daily tasks |
| 👀 Activity Monitoring | 行为监督 | Monitors active windows/apps and reminds you when slacking off |
| 🎭 Mood System | 心情系统 | Pet's mood changes based on your productivity |
| 💬 Speech Bubbles | 气泡提醒 | The pet talks to you with speech bubbles |
| ⚙️ Customizable | 可定制 | Settings panel to configure monitoring rules |

## 🖼️ Screenshots / 截图

> *Coming soon...*

## 🚀 Getting Started / 开始使用

### Prerequisites / 环境要求

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/) (latest stable)
- [Tauri CLI](https://tauri.app/)

### Development / 开发

```bash
# Clone the repo
git clone https://github.com/NikolaYingZhao/zhuomiao.git
cd zhuomiao

# Install dependencies
npm install

# Run in dev mode
npm run tauri dev

# Build for production
npm run tauri build
```

### Download / 下载

Download the latest `.exe` from the [Releases](https://github.com/NikolaYingZhao/zhuomiao/releases) page.

从 [Releases](https://github.com/NikolaYingZhao/zhuomiao/releases) 页面下载最新的 `.exe` 安装包。

## 🛠️ Tech Stack / 技术栈

- **[Tauri](https://tauri.app/)** — Lightweight desktop app framework
- **[SvelteKit](https://kit.svelte.dev/)** — Full-stack web framework
- **[TypeScript](https://www.typescriptlang.org/)** — Type-safe JavaScript
- **Rust** — Backend / system integration

## 📁 Project Structure / 项目结构

```
zhuomiao/
├── src/                  # SvelteKit frontend
│   ├── lib/
│   │   ├── components/   # Reusable UI components
│   │   ├── services/     # Business logic & persistence
│   │   └── types/        # TypeScript type definitions
│   └── routes/           # Page routes (pet, panel, settings)
├── src-tauri/            # Tauri backend (Rust)
│   ├── capabilities/     # Window permissions
│   └── tauri.conf.json   # Tauri configuration
└── static/               # Static assets
```

## 📄 License / 开源协议

[MIT](LICENSE) © 2025 Nikola Ying Zhao
