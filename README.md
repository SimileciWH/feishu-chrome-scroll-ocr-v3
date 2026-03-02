# feishu-chrome-scroll-ocr-v3

Chrome 插件：在飞书文档正文场景手动选区后，自动滚动截图并提取文本，最终保存 TXT。

## 方案说明（高可靠融合）
- **DOM文本提取（主通道）**：对选区内可见文本节点做结构化提取，避免纯OCR误差。
- **滚动截图 + 云OCR（补充通道）**：对每屏截图区域做 OCR.Space 识别，补足图片/特殊渲染文字。
- **融合输出**：主通道 + 补充通道合并并去重，导出 txt。

## 安装
1. 打开 `chrome://extensions`
2. 开启开发者模式
3. 加载已解压的扩展，选择本目录

## 使用
1. 打开飞书 docx 正文页面（如 `https://docs.feishu.cn/docx/...`）
2. 点击插件弹窗 `Select Region`，框选正文区域
3. 点击 `Capture + Extract`
4. 等待完成后浏览器会下载 `feishu-extract-*.txt`

## 配置
- OCR.Space API Key 可在弹窗里设置（默认 `helloworld`，有频率限制，建议替换）

## 已知限制
- OCR.Space 免费额度受限，长文档建议自备 key
- 复杂嵌套 iframe/虚拟滚动场景可能需微调滚动容器识别
