# Design QA — Aurora Command

## 对比目标

- Source visual truth: `/Users/wikiglobal/.codex/generated_images/019f7081-24e1-7843-8bd4-11be649e14f2/exec-04d3276d-541b-4556-9adc-a825813a4ddb.png`（用户选定的第 3 张 Aurora Command 概念稿）。
- Implementation screenshot: `/private/tmp/aurora-command-pc-chat.png`。
- Primary viewport: 1440 × 1024，桌面端；已按用户要求作为主验收面。
- State: 已登录、普通对话、历史消息和数据溯源可见；联网搜索已从关闭切换为开启并确认状态更新。另检查了金融模式与资产搜索布局：`/private/tmp/aurora-command-pc-financial.png`。

## 证据

- 完整视图：已在同一视觉比较输入中打开 Aurora Command 概念稿与 1440 × 1024 浏览器截图，核对整体外壳、侧栏、连接状态、阅读区和输入器。
- 聚焦区域：同一桌面会话中检查新建会话/金融对话按钮、活跃会话、工具溯源表面、联网搜索开关和输入器；金融模式中检查研究画布、导航以及资产搜索结果。
- 交互：金融模式可进入和退出；联网搜索开关切换后 DOM 显示 `[checked]`；浏览器控制台错误数为 0。

## Findings

- 无 P0、P1 或 P2 问题。
- [P3] 概念稿包含一组带实时报价的研究摘要，而当前实现按既有产品约束不虚构数据、继续展示“等待查询”和工具溯源。这是功能保留的有意差异，不修改。
- [P3] 概念稿中的装饰性 AI 徽标没有引入到当前页面，以避免增加未授权图标资产；现有功能性界面保持不变。

## Fidelity Surfaces

- Fonts and typography: 使用 `Inter` 优先的现代无衬线回退链；桌面标题采用 700 与紧凑字距，正文和消息采用 1.8 行高，侧栏与元信息保持较轻的光学权重。
- Spacing and layout rhythm: 外壳为 24px 圆角；主区、侧栏、消息及输入器留白清晰；桌面保持左右结构，未发现裁切或水平溢出。
- Colors and visual tokens: 采用柔白/冰蓝/淡紫基调，青紫渐变仅用于主操作；`--glass-blur: 20px`、半透明表面与低扩散阴影在主要容器中一致使用。
- Image quality and asset fidelity: 目标方向不依赖产品插画、照片或品牌图；当前实现没有用低质量替代资产。背景光和噪点由用户明确要求的 CSS 视觉语言实现。
- Copy and content: 保留原始中文状态、工具溯源、会话标题、输入提示与风险提示；未新增虚构金融数据。

## Comparison History

1. 初次移动端金融模式检查发现资产搜索结果仍为绝对定位，遮住研究导航（P2）。根因是桌面下拉菜单未参与移动端布局高度计算。已在移动端改为 `position: static`，并加入测试 `mobile financial asset results stay in flow instead of covering the research navigation`。
2. PC 重点检查发现同一绝对定位在 1440px 金融模式下覆盖聊天面板（P2）。已为 `.financial-workbench-bar .asset-search-results` 保留顶部栏布局空间，并加入测试 `desktop financial asset results reserve top-bar space instead of covering the chat panel`。
3. 修复后重新捕获 PC 金融工作台与桌面主对话截图；两处 P2 均不存在，金融模式、会话和联网搜索交互仍正常。

## Implementation Checklist

- [x] 桌面玻璃外壳、背景光与单一青紫强调色。
- [x] 24px/胶囊/8px 的圆角分层。
- [x] 按钮与可交互表面的悬停上浮、按下回弹、可见焦点与减少动态支持。
- [x] PC 金融资产搜索结果不覆盖聊天面板。
- [x] 移动端金融资产搜索结果不覆盖研究导航。
- [x] 桌面浏览器交互和控制台检查。

final result: passed

## 2026-09-03 Codex 风格紧凑输入区

### 环境与证据

- 本地开发服务：`http://127.0.0.1:5173/`（Nest 服务：`http://127.0.0.1:8787`）。
- 桌面截图：`/tmp/deepseek-compact-composer-desktop.png`。
- 长输入、审批和附件截图：`/tmp/deepseek-compact-composer-states.png`。
- 移动截图：`/tmp/deepseek-compact-composer-mobile.png`。
- 320px 窄屏截图：`/tmp/deepseek-compact-composer-320.png`。
- 附件移除后截图：`/tmp/deepseek-compact-composer-attachment-removed.png`。
- 停止生成状态截图：`/tmp/deepseek-compact-composer-stop.png`。

### 桌面验收（1440 x 900）

- 空输入的 composer 实测 `760 x 106px`，文本域为 `40px`，仅保留文本域和单层工具栏；旧模型工具说明、常驻审批卡、上下文说明及双操作按钮均不存在。
- 十行文本时，文本域实测为 `200px`，内容高度为 `256px`，`overflow-y: auto`；消息列表保持独立 `overflow-y: auto`，聊天面板为 `overflow: hidden`。
- 焦点态为单一 `3px` 绿色 outline，带 `2px` offset；未再出现双重焦点环。
- 审批按钮切换后 `aria-pressed="true"`；最长文本附件成功显示 chip，并可移除。移除后的实际页面截图中 chip 数量为 `0`，composer 回到 `106px`。附件完成状态由 polite live region 播报。
- 本地后端未配置模型，真实请求会立即返回 `model_unavailable`，无法观察持续的真实流式生成。使用 Playwright 对 `/api/chat/stream` 的 `2s` 延迟 SSE 拦截验证界面状态：停止按钮可见、已启用、尺寸 `44 x 44px`，点击后发送按钮原位恢复；停止态截图与脚本输出一并保留。

### 移动验收（390 x 844，补充 320 x 844）

- 390px：页面与 body 宽度均为 `390px`；composer 为 `370px`，长文件名 chip 为 `332px`，没有页面级横向滚动、遮挡或双全宽操作按钮。
- 320px：独立浏览器 context 与截图中，页面和 body 宽度均为 `320px`；composer 为 `300px`，chip 为 `262px`。附件、审批和发送控件分别为 `44 x 44px`、`70 x 44px`、`44 x 44px`，均可触达。
- 所有关键状态均完成实际页面检查：空输入、长输入、审批开启、长文本附件、附件移除、焦点、模拟流式停止、390px 与 320px 窄屏。

### 自动验证

- `pnpm test`：432/432 通过。
- `pnpm typecheck`：通过。
- `pnpm build`：通过。
