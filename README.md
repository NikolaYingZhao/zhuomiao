# 桌喵 🐱

<p align="center">
  <b>一只住在你桌面上的猫，管着你的任务，盯着你好好干活。</b><br/>
  <em>A desktop pet cat that lives on your taskbar, manages your to-dos, and makes sure you stay focused.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/版本-1.0.5-blue?style=flat-square" alt="Version"/>
  <img src="https://img.shields.io/badge/平台-Windows-lightgrey?style=flat-square" alt="Platform"/>
  <img src="https://img.shields.io/badge/开源-MIT-green?style=flat-square" alt="License"/>
</p>

---

## 它是做什么的？

你肯定有过这样的经历：

> 打开电脑准备干活，刷了会儿手机，看了会儿视频，吃了个瓜……抬头一看，三小时过去了，什么也没干。

桌喵就是为解决这个问题而生的。

它是一只**住在你桌面上的小猫**。平时安安静静地趴着，偶尔摇摇尾巴、打个哈欠。但你一旦开始"摸鱼"——比如打开了抖音、小红书、B站——它就会冒出来，用气泡提醒你：

> 💬 "又刷起来了？你的任务还没完成呢！"

如果你配置了 AI（可选），它还能更智能地判断你到底是在工作还是在摸鱼，甚至能通过对话帮你管理任务。

**简单来说：桌喵 = 桌面宠物 + 任务管理 + 摸鱼克星。**

---

## 功能一览

| | | |
|---|---|---|
| 🐱 | **一只活生生的桌宠** | 纯 CSS 动画小猫，7 种心情状态。开心时蹦蹦跳跳，生气时浑身发抖，睡觉时还会打呼噜 |
| 📋 | **任务管理** | 添加任务、标记完成、分类追踪。支持优先级和截止日期 |
| 👀 | **自动监督** | 每 45 秒悄悄看一眼你在干什么。摸鱼？它知道 |
| 🤖 | **AI 大脑（可选）** | 接入 OpenAI 或兼容 API，智能判断当前活动是"工作"还是"摸鱼" |
| 💬 | **和猫聊天** | 直接用自然语言跟桌喵对话来管理任务。说一句"我做完数学作业了"，它帮你勾选 |
| 📊 | **活动图表** | 按小时统计你今天的时间花在哪儿了，支持手动纠正误判 |
| 🎯 | **自定义规则** | 自己定义什么算"摸鱼"。比如把公司内部系统加入白名单 |
| 💾 | **数据不丢** | 优先存 MySQL，断网自动降级为本地文件，怎么都不会丢 |
| 🔄 | **多窗口同步** | 宠物窗口、任务面板、设置窗口之间状态实时同步 |

---

## 界面一览

桌喵有三个窗口，各司其职：

**🐱 宠物窗口（主窗口）**
一只半透明小猫趴在桌面上，可以拖着走。点击右键打开菜单，快速添加任务、打开任务面板、查看活动图表、和猫聊天。

**📋 任务面板**
管理你的所有任务。添加、删除、完成、清空已完成——该有的都有。

**⚙️ 设置面板**
三个标签页：通用设置（数据目录）、监控规则（自定义黑名单）、AI 配置（接入你的 API）。

---

## 怎么用？

### 下载安装

1. 前往 [Releases](https://github.com/NikolaYingZhao/zhuomiao/releases) 页面
2. 下载最新的 `.exe` 安装包
3. 双击安装，搞定

> 目前仅支持 **Windows** 系统。

### 基本操作

| 操作 | 方法 |
|------|------|
| 移动小猫 | 拖拽它 |
| 打开右键菜单 | 在小猫身上点右键 |
| 快速添加任务 | 右键菜单 → 快速添加任务 |
| 打开任务面板 | 右键菜单 → 任务面板 |
| 打开设置 | 右键菜单 → 设置 |
| 退出 | 右键菜单 → 彻底退出 |

### 配置数据库（可选）

桌喵支持两种数据存储方式：

- **本地文件模式**（默认）：不需要任何配置，数据自动保存在本地。开箱即用。
- **MySQL 模式**：如果你有自己的数据库，可以在 `src-tauri/.env` 文件中配置连接地址，数据会存到数据库里。

不需要数据库也完全没关系。桌喵会自动检测——MySQL 能连上就用，连不上就自动用本地文件，**数据永远不会丢**。

### 配置 AI（可选）

想要桌喵更聪明？给它接上 AI 大脑：

1. 打开设置面板 → AI 配置
2. 填入你的 API 地址、API Key 和模型名称
3. 点击"测试连接"
4. 保存

支持所有 **OpenAI 兼容的 API 端点**（OpenAI 官方、DeepSeek、通义千问等都可以）。默认模型是 `gpt-4o-mini`。

配置完 AI 后，桌喵就能：
- 智能判断你在工作还是在摸鱼（比单纯匹配规则准确得多）
- 和你聊天，用自然语言管理任务
- 在你创建任务时自动推测"怎么算完成"

不想用 AI 也完全可以，桌喵自带一套基于规则的判断系统，一样能用。

---

## 开发者专区

如果你想自己编译、修改或贡献代码，下面是快速上手指南。

### 环境要求

| 工具 | 版本 | 用途 |
|------|------|------|
| [Node.js](https://nodejs.org/) | v18+ | 前端构建 |
| [Rust](https://www.rust-lang.org/) | latest stable | 后端编译 |
| [Tauri CLI](https://tauri.app/) | v2 | 桌面应用框架 |
| [MySQL](https://www.mysql.com/) | 任意 | 可选，数据存储 |

### 编译运行

```bash
# 克隆仓库
git clone https://github.com/NikolaYingZhao/zhuomiao.git
cd zhuomiao

# 安装前端依赖
npm install

# （可选）配置数据库
echo 'DATABASE_URL=mysql://用户名:密码@localhost:3306/zhuomiao' > src-tauri/.env

# 开发模式启动
npm run tauri dev

# 类型检查
npm run check

# 打包发布
npm run tauri build
```

### 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | [Tauri 2](https://tauri.app/) — 轻量、安全、Rust 驱动 |
| 前端 | [Svelte 5](https://svelte.dev/) + [SvelteKit](https://kit.svelte.dev/) — 响应式、无虚拟 DOM |
| 语言 | [TypeScript](https://www.typescriptlang.org/) |
| 后端 | [Rust](https://www.rust-lang.org/) — Win32 API 窗口检测 |
| 数据库 | [MySQL](https://www.mysql.com/) via [sqlx](https://github.com/launchbadge/sqlx) |
| AI | OpenAI 兼容 API |

### 项目结构

```
zhuomiao/
├── src/                          # 前端（SvelteKit + TypeScript）
│   ├── lib/
│   │   ├── components/           # UI 组件
│   │   │   ├── PetAnimation.svelte    # 猫咪动画（纯 CSS，7 种状态）
│   │   │   ├── TaskPanel.svelte       # 任务管理面板
│   │   │   ├── TaskItem.svelte        # 单条任务
│   │   │   ├── SettingsPanel.svelte   # 设置面板（3 个标签页）
│   │   │   ├── ActivityChart.svelte   # 活动分布图表
│   │   │   ├── SpeechBubble.svelte    # 气泡提示
│   │   │   └── QuickChat.svelte       # AI 聊天面板
│   │   ├── services/             # 业务逻辑
│   │   │   ├── ai.ts             # AI 集成（分类 / 对话 / 验证）
│   │   │   ├── chat.ts           # 聊天上下文 & 指令解析
│   │   │   ├── persistence.ts    # 双模持久化（MySQL + 本地文件）
│   │   │   └── sync.ts           # 跨窗口状态同步
│   │   ├── stores/               # Svelte 5 响应式状态管理
│   │   └── types/                # TypeScript 类型定义
│   └── routes/                   # 页面路由
│       ├── +page.svelte          # 宠物主窗口
│       ├── panel/+page.svelte    # 任务面板
│       └── settings/+page.svelte # 设置窗口
│
├── src-tauri/                    # 后端（Rust）
│   ├── src/
│   │   ├── lib.rs                # 应用入口 & 命令注册 & 系统托盘
│   │   ├── models.rs             # 数据库模型
│   │   ├── db/mod.rs             # 连接池 & 自动迁移
│   │   └── commands/             # Tauri 命令
│   │       ├── task.rs           # 任务 CRUD
│   │       ├── activity.rs       # 活动记录
│   │       ├── rule.rs           # 监控规则
│   │       ├── config.rs         # AI 配置 & 数据库状态
│   │       └── migration.rs      # 数据迁移
│   └── tauri.conf.json           # Tauri 配置
│
└── docs/                         # 项目文档
```

### 架构简说

桌喵的架构分三层：

**🪟 系统层（Rust）**
通过 Win32 API 检测当前前台窗口，把窗口标题和进程名传给前端。启动时读取 `.env` 尝试连接 MySQL，失败则自动降级为本地文件模式。

**🧠 逻辑层（TypeScript）**
45 秒一个循环：拿到当前窗口信息 → 先过规则黑名单 → 再让 AI 判断（如果配了）→ 决定要不要提醒你。所有操作即时持久化，同时通过 Tauri 事件系统广播到其他窗口。

**🎨 展示层（Svelte 5）**
三个独立窗口各自运行，通过事件桥接同步状态。猫咪动画纯 CSS 实现，不需要任何图片资源。

数据流：
```
Win32 API → 检测前台窗口 → 规则匹配 → AI 判断 → 提醒/记录
                                                ↓
                                        持久化到 MySQL 或本地文件
                                                ↓
                                        跨窗口状态同步
```

---

## 开源协议

[MIT](LICENSE) © 2026 NikolaYingZhao

桌喵是开源软件，你可以自由使用、修改和分发。欢迎提 Issue 和 PR！
