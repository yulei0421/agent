# 金融研究文档导出实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已校验的金融研究报告导出为 PDF 或可编辑 PPTX，并提供 Nest 下载接口与前端操作。

**Architecture:** 共享报告契约负责浏览器和服务端的独立严格校验；导出应用服务只依赖渲染端口；Nest 控制器将内存二进制结果安全地作为附件输出；基础设施使用 PDFKit 与 PptxGenJS 生成文档。

**Tech Stack:** TypeScript strict、NestJS、React、PDFKit、PptxGenJS、Node test runner。

---

### Task 1: 共享报告契约与导出应用端口

**Files:** `shared/research-report.ts`、`src/lib/research-report.ts`、`server/application/export/research-export.service.ts`、`tests/researchExport.test.ts`

- [x] 写入导出请求仅接受严格研究报告、格式仅为 PDF/PPTX 的失败测试。
- [x] 将报告解析器移动到共享契约，并让浏览器保留相同导入接口。
- [x] 定义 `ResearchDocumentRenderer`、`ResearchExportService` 和不可变二进制响应模型。
- [x] 运行 `pnpm exec tsx --test tests/researchReport.test.ts tests/researchExport.test.ts`，确认通过。

### Task 2: PDF 与 PPTX 基础设施渲染器

**Files:** `package.json`、`pnpm-lock.yaml`、`server/infrastructure/export/research-document-renderer.ts`、`tests/researchDocumentRenderer.test.ts`

- [x] 写入 PDF 以 `%PDF-` 开头、PPTX 以 ZIP 文件头开头以及内容不直接读取不可信数据的失败测试。
- [x] 安装 PDFKit、PptxGenJS 与 PDFKit 类型声明。
- [x] 实现内存 PDF/PPTX 渲染器，固定页面、配色、字体、页数和报告字段。
- [x] 运行渲染器测试，并用样例检查两个输出的文件签名和结构。

### Task 3: Nest 下载接口与生产装配

**Files:** `server/api/export/export.controller.ts`、`server/app.module.ts`、`tests/exportController.test.ts`、`tests/appComposition.test.ts`

- [x] 写入无效 body 返回 400、PDF/PPTX 正确设置 MIME/附件头/长度的失败测试。
- [x] 实现控制器、受控错误映射和导出服务依赖注入。
- [x] 运行控制器和组成根测试，确认下载只由服务端生成。

### Task 4: 前端下载操作与文档

**Files:** `src/lib/research-export.ts`、`src/components/MessageItem.tsx`、`src/styles.css`、`tests/financialUi.test.ts`、`README.md`

- [x] 写入只在 `researchReport` 存在时显示两个下载按钮、客户端使用二进制 blob 下载的失败测试。
- [x] 实现按钮、下载客户端、加载与错误状态，以及既有视觉语言的响应式样式。
- [x] 更新 README 的接口、边界、依赖和使用说明。
- [x] 运行 `pnpm typecheck && pnpm test && pnpm build && git diff --check`。
