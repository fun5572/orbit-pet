# Orbit Pet

Orbit Pet 是一个使用 Tauri 2、TypeScript 和参数化 SVG 构建的跨平台圆形机器人桌宠，支持 macOS 和 Windows。

## 功能

- 自然随机眨眼，眼睛会跟随全局鼠标位置。
- 会根据鼠标距离和移动速度产生圆眼、椭圆眼、长条眼和惊吓大小眼等表情。
- 鼠标长时间不动时会先无聊、再睡觉；睡醒后会随机自己蹦跳玩耍。
- 鼠标或键盘输入可以唤醒宠物，睡眠时支持惊醒效果。
- 监听键盘输入并从头顶生成随机气泡，输入越快气泡越多。
- 左键拖动宠物时会锁定成被拎起的无辜哭泣表情，带有流动眼泪和弹性摇摆。
- 提供经典款与蝴蝶结款，蝴蝶结款使用粉色气泡。
- 右键打开设置，可以调整宠物大小、外观和多套颜色。
- 透明无边框、始终置顶、透明区域点击穿透，支持托盘显示、隐藏和退出。
- 可选 Codex 集成：显示进行中任务、等待确认、执行阶段与完成提醒。

## Codex 集成

Codex 集成默认关闭，不影响桌宠本身的鼠标跟随、睡眠、玩耍、键盘气泡和拖动效果。

1. 右键点击宠物打开设置。
2. 在“Codex 集成”中点击“安装连接”。
3. Orbit Pet 会将自带的本地捕获脚本安装到应用数据目录，并仅合并更新 `~/.codex/hooks.json` 中属于 Orbit Pet 的 Hook。
4. 在 Codex 的 `/hooks` 中审查并启用 Orbit Pet Hook。
5. 打开集成开关，后续 Codex 任务即会出现在桌宠任务列表中。

连接脚本源码位于 [`integrations/orbit-pet-bridge`](./integrations/orbit-pet-bridge)，编译时直接内置到 Orbit Pet，不需要插件 Marketplace。它仅观察以下事件：

- `UserPromptSubmit`：任务开始，显示“正在思考”。
- `PreToolUse`：命令执行前，显示“正在执行命令”。
- `PostToolUse`：命令结束后，显示“正在处理结果”。
- `PermissionRequest`：显示“等待确认”。
- `Stop` 和 `SessionEnd`：显示完成提醒并结束任务状态。

所有捕获数据都只通过本机应用数据目录传递，不会联网，也不会替 Codex 允许或拒绝任何操作。

## 下载

可在 GitHub [Releases](../../releases) 中下载：

- macOS Apple Silicon：`.dmg`
- Windows x64：NSIS `.exe`

macOS 全局键盘气泡需要“输入监控”权限。如果监听失效，可从 Orbit Pet 设置中执行重新授权并重启应用。

## 本地开发

需要：

- Node.js 22
- Rust stable toolchain
- macOS：Xcode Command Line Tools
- Windows：Microsoft C++ Build Tools 和 WebView2 Runtime

```bash
npm ci
npm test
npm run tauri dev
```

仅预览前端：

```bash
npm run dev
```

浏览器预览会使用页面内鼠标位置模拟全局鼠标，不包含完整的桌面级输入监听。

## 自行打包

建议分别在 macOS 和 Windows 本机打包：

```bash
npm ci
npm test
npm run tauri build
```

只生成指定格式：

```bash
# macOS：.app + .dmg
npm run tauri build -- --bundles app,dmg

# Windows：NSIS .exe
npm run tauri build -- --bundles nsis
```

打包产物位于 `src-tauri/target/release/bundle/`。`.github/workflows/build-desktop.yml` 也提供了 macOS/Windows 原生构建矩阵，可以手动触发，也会在推送 `v*` 标签时运行。

正式对外分发前，请自行配置 Apple Developer ID 签名与公证，以及 Windows 代码签名证书。
