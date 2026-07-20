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
