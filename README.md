# AI Content Checker - Chrome Extension

一款Chrome浏览器扩展，用于检测网页中的AI生成内容（文本、图片、视频）。

A Chrome browser extension for detecting AI-generated content (text, images, videos) on web pages.

---

## 功能特性 / Features

- 🔍 **AI内容检测 / AI Content Detection** - 检测网页中的文本、图片和视频是否由AI生成
- ✅ **白名单管理 / Whitelist** - 标记可信网站，自动跳过检测
- ⛔ **黑名单管理 / Blacklist** - 标记已知AI内容来源，自动标记为高风险
- 🖱️ **自定义扫描范围 / Custom Scope** - 在页面上框选特定区域进行检测，或选择文本/图片/视频任意组合
- 📋 **URL历史记录 / URL History** - 记录每次检测的URL、结果和时间戳，支持后续快速复查
- 🔑 **API集成 / API Integration** - 支持GPTZero、Originality.ai、Hive等第三方检测服务
- 🌐 **中英双语 / Bilingual** - 完整的中英双语界面

---

## 安装方法 / Installation

### 开发者模式安装 / Developer Mode Installation

1. 克隆或下载本仓库 / Clone or download this repository
2. 打开Chrome浏览器，访问 `chrome://extensions/` / Open Chrome, navigate to `chrome://extensions/`
3. 启用右上角的"开发者模式 / Developer mode"开关
4. 点击"加载已解压的扩展程序 / Load unpacked"
5. 选择仓库中的 `extension/` 目录 / Select the `extension/` directory from this repo
6. 扩展程序图标将出现在工具栏 / The extension icon will appear in the toolbar

---

## 使用方法 / Usage

### 基本扫描 / Basic Scan

1. 访问任意网页 / Visit any webpage
2. 点击工具栏中的AI Checker图标 / Click the AI Checker icon in the toolbar
3. 选择要检测的内容类型（文本/图片/视频）/ Select content types (text/images/videos)
4. 点击"开始检测 / Start Scan" / Click "Start Scan"
5. 查看检测结果和AI概率分数 / View detection results and AI probability scores

### 自定义扫描范围 / Custom Scan Scope

1. 点击"🖱️ 选择范围"按钮，插件弹窗将关闭 / Click "🖱️ 选择范围", popup closes
2. 在页面上用鼠标选中要检测的文本 / Select text on the page with mouse
3. 重新打开插件弹窗，点击"开始检测" / Reopen the popup and click "Start Scan"

### 右键菜单 / Context Menu

右键点击页面可以快速访问以下功能 / Right-click on the page for quick access:
- 🔍 扫描整个页面 / Scan this page
- 🔍 检测选中文本 / Check selected text
- 🔍 检测图片 / Check this image (on images)

### 白名单/黑名单 / Whitelist & Blacklist

- 扫描后在结果页点击"✅ 加入白名单"或"⛔ 加入黑名单" / After scanning, click whitelist/blacklist buttons
- 或在设置页面 / Or in the options page:
  - 点击扩展图标 → ⚙️ → 白名单/黑名单 / Click icon → ⚙️ → Whitelist/Blacklist
  - 支持精确域名（`example.com`）或通配符（`*.example.com`）

---

## 检测方法 / Detection Methods

### 启发式算法（内置，无需配置）/ Heuristics (Built-in, no configuration needed)

| 检测项 | 说明 |
|--------|------|
| 句子长度均匀性 | AI生成文本句子长度往往高度一致 |
| 词汇多样性(TTR) | AI文本词汇多样性处于特定区间 |
| AI常用短语 | 检测"Furthermore"、"In conclusion"等AI高频词 |
| 段落结构 | AI倾向于生成结构规整的多段文本 |
| 第一人称缺失 | AI文本通常避免使用第一人称 |
| 图片URL分析 | 检测Midjourney、DALL-E等服务的URL特征 |
| 图片尺寸匹配 | AI图片常见固定尺寸（512×512等）|
| 视频来源检测 | 检测Runway、Pika等AI视频服务 |

### 第三方API（可选，更高准确率）/ Third-party APIs (Optional, Higher Accuracy)

| 服务 | 用途 | 获取密钥 |
|------|------|---------|
| GPTZero | 文本AI检测，支持多语言 | [gptzero.me](https://gptzero.me) |
| Originality.ai | 文本AI检测 + 抄袭检测 | [originality.ai](https://originality.ai) |
| Hive Moderation | 图片AI生成检测 | [thehive.ai](https://thehive.ai) |

在设置页面（⚙️ → API配置）中填入对应的API密钥即可启用。

---

## 项目结构 / Project Structure

```
extension/
├── manifest.json          # 扩展清单文件 (Manifest V3)
├── icons/
│   ├── icon16.png         # 16×16 图标
│   ├── icon48.png         # 48×48 图标
│   └── icon128.png        # 128×128 图标
├── popup/
│   ├── popup.html         # 弹出窗口 HTML
│   ├── popup.css          # 弹出窗口样式
│   └── popup.js           # 弹出窗口逻辑
├── content/
│   └── content.js         # 注入页面的内容脚本（提取页面内容）
├── background/
│   └── background.js      # 后台服务工作线程（AI检测、存储管理）
├── options/
│   ├── options.html        # 设置页面 HTML
│   ├── options.css         # 设置页面样式
│   └── options.js          # 设置页面逻辑
└── utils/
    └── ai-detector.js      # AI检测核心算法和API集成
```

---

## 数据隐私 / Data Privacy

- 所有数据（白名单、黑名单、历史记录、API密钥）均**仅存储在本地浏览器**中
- 不会向任何服务器发送页面内容（除非您主动配置并使用第三方API）
- API密钥仅发送到对应官方API端点
- All data is stored **locally in the browser** only
- Page content is **never sent to any server** (unless you configure and use third-party APIs)

---

## 开发 / Development

本扩展使用原生JavaScript开发，无需构建工具。

This extension uses vanilla JavaScript with no build tools required.

```bash
# 克隆仓库 / Clone
git clone https://github.com/Runnlin/AI-checker.git
cd AI-checker

# 直接加载扩展目录 / Load extension directory directly
# chrome://extensions/ → Load unpacked → select extension/
```

---

## 许可证 / License

MIT License