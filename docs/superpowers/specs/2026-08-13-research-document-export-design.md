# 金融研究文档导出设计

## 目标

为已完成的金融研究报告提供 PDF 与 PPTX 同步下载，不引入服务端持久化、后台任务、账户体系或未受控的数据输入。

## 边界与数据契约

浏览器只能对已显示的 `researchReport` 发起导出；服务端仍将请求体作为不可信输入，再次以同一份严格结构校验标题、结论、依据、风险和数据时间。导出器只接收校验后的报告对象，不接收模型原始文本、Markdown、工具原始结果、URL 或客户端自定义模板。

接口固定为：

- `POST /api/exports/research/pdf`
- `POST /api/exports/research/pptx`

请求体为 `{ "report": ResearchReport }`。成功时返回附件二进制流；无效报告返回现有 `invalid_request` 错误。下载文件名由服务端固定为带时间戳的 ASCII 文件名，避免客户端控制响应头。

## 分层设计

- `shared/research-report.ts`：浏览器与服务端共用的只读报告契约和严格解析器。
- `server/application/export/`：导出用例和渲染端口，只依赖校验后的报告与二进制文档类型。
- `server/infrastructure/export/`：PDFKit 生成 A4 PDF，PptxGenJS 生成可编辑的 16:9 PPTX。
- `server/api/export/`：Nest 控制器负责请求校验、取消与 HTTP 下载响应，不包含排版细节。
- `src/`：仅在已解析的研究报告消息上呈现 PDF / PPTX 下载操作。

## 文档内容与展示

PDF 使用一页或多页的研究简报：标题、数据时间、结论、依据与风险。PPTX 使用三页：封面/结论、依据、风险与数据时间。内容长度继续使用研究报告既有上限；数组条目最多六条。PDF 使用部署环境中可用的 CJK 字体路径，以保证中文文本嵌入；找不到可用字体时返回受控错误而非输出缺字文件。

## 可靠性与验证

两个生成器在内存中返回 `Buffer`，不在服务端写入报告文件。控制器设置精确 MIME 类型、附件处置头和 `Content-Length`。测试覆盖：非法输入拒绝、响应头与二进制下载、渲染端口调用、PDF/PPTX 文件签名与前端仅对已验证报告显示按钮。完整门禁包括 TypeScript、测试、构建和 diff 检查。
