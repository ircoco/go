# 工程日志

## 2026-08-22 B Prompt 全量修复 + Check Agent 独立 + 修缮 UI 升级
- **核心产出**：B prompt 全量修缮、Check Agent 提示词独立、修缮对比 UI 升级、handoff 字段注释注入
- **B Prompt 修复**：删除时间线规则残留改为直播节奏说明、新增坐标格式说明（percentage/pixel 双模式）、actionSpec 与 board 坐标格式对齐、handoff 答案建议提醒
- **Check Agent 独立**：新建 `src/check-agent/prompt.js`，从 handler 内嵌抽离；重构 `server/checkAgentHandler.js`，从真相源读 boardPlan/coordinateMode 传给模型
- **修缮 UI 升级**：左右对比布局（左机筛原文/右教研修缮）、颜色区分（灰/绿）、已优化字段标签
- **handoff 字段注释**：`server/agentBV2Handler.js` 新增 `HANDOFF_FIELD_NOTES`，发给模型时每个关键字段前注入 `_xxx_说明` 注释（12 个字段）
- **发现问题**：修缮 API 一调就写文件（前端以为点应用才写）、relatedKnowledge 数据结构不统一（A 侧对象数组 vs 修缮字符串数组）
- **变更文件**：`src/agent-b-v2/prompt.js`、`src/check-agent/prompt.js`（新建）、`server/checkAgentHandler.js`、`src/agent-b-v2/AgentBDirect.vue`、`server/agentBV2Handler.js`
- **验证**：`npm run build` 通过、核心 JS `node --check` ALL OK

## 2026-08-21 全链路 API 压实 + zoneAnchors 命名统一 + prompt 修缮
- **目标**：所有 API 请求、提示词、规则文件全部压实，确保每个链路输入输出对得上
- **全链路 API 清单（8 个）**：
  1. `POST /api/recognition/problem` — Agent A 识别
  2. `POST /api/screenshot` — 画布截图
  3. `POST /api/handoff` — 写 handoff 真相源
  4. `GET /api/handoff` — 读 handoff
  5. `POST /api/agent-b-v2/generate` — Agent B 生成（核心）
  6. `POST /api/check-agent/check` — Check Agent（25% 重要度）
  7. `POST /api/knowledge/refine` — 知识点修缮（50% 重要度）
  8. `fetch(dataUrl)` — 本地缓存
- **zoneAnchors 命名统一**：key 从 `topic` → `question`，和 boardPlan 对齐；四区结构一致（都有 label/labelStartCoord/regionStartCoord{x,y,w,h}）
- **prompt.js 修缮（12 处）**：补 boardPlan/canvasParams/zoneAnchors 字段说明、新增 coordinateMode 字段、handoff 唯一真相源声明、坐标格式由 coordinateMode 驱动（不写死百分比）、字号行高表以 handoff 为准
- **变更文件**：`src/services/stepHandoff.js`、`src/agent-b-v2/prompt.js`
- **验证**：`npm run build` 通过、eslint 0 errors、写死百分比残留 0 处、zoneAnchors.topic 旧 key 0 处

## 2026-08-21 duration 全链路清理
- **决策**：时间不预计算，全部下游动态算；B 模型只输出内容（stage/speech/board/actionSpec），不输出时间字段
- **动作时间**：actionSpec 里的时间是相对 row 起点的偏移，不是全局绝对时间
- **行标识**：用 `stage-第N行` 替代时间列和 duration
- **已清理文件（8 个）**：`contract.js`、`prompt.js`、`timing.js`、`AgentBDirect.vue`、`speechMarkdown.js`、`checkAgentHandler.js`、`liyongle-elementary/output-format.js`、`liyongle-elementary/examples.js`
- **未清理（记录在案）**：`prompt-v3-draft.js`（草稿）、`proxySelfCheck.js`（自测脚本）、`board-rules.js`（动作级 durationMs 合理保留）
- **验证**：`npm run build` 通过（1.81s）

## 2026-08-21 canvasParams 循环引用 bug 修复 + 参数体系梳理
- **问题**：`AgentBDirect.vue` 的 `generateRows` 中 `canvasParams` 是 `ref({...})`，但代码写了 `canvasParams.rowGapMs` 和 `{ ...canvasParams }`，展开的是 ref 对象本身（含 ReactiveEffect 循环引用），导致 `JSON.stringify` 报错
- **修复**：`canvasParams.xxx` → `canvasParams.value.xxx`
- **参数体系发现**：
  - 两套参数并存：handoff.canvasParams（数据层）vs UI canvasParams ref（B 页面用户可调）
  - 命名不一致：数据层题目区叫 `question`，UI 层叫 `topic`
  - zones 是死代码：定义了但从未被模板或 script 引用
  - 导出与渲染不一致：导出去读 UI canvasParams，渲染实际用 boardPlan 的值
- **变更文件**：`src/agent-b-v2/AgentBDirect.vue`、`src/agent-b-v2/contract.js`、`eslint.config.js`、`server/proxySelfCheck.js`、`reasonix.toml`
- **验证**：`npm run build` 通过（2.90s）

## 2026-08-17 修复 Agent B API URL 重复拼接问题
- **问题**：上游 API 传入完整 URL（含 `/chat/completions`）时，`server/http.js` 的请求 helper 会再次拼接路径，导致请求 404/500
- **根因**：`requestChatCompletion` 固定请求 `${baseURL}/chat/completions`，`requestAnthropicMessage` 固定请求 `${baseURL}/v1/messages`，未判断 baseURL 是否已包含目标路径
- **修复**：两个 helper 增加 `endsWith` 判断，已包含目标路径则直接使用，不再拼接
- **配套变更**：`src/lib/agentBApiConfig.js` 默认配置切换为 Agnes 完整 URL/模型/Key，storage key 升 v2 避免旧缓存污染
- **验证**：`npm run build` 通过、`npm run check:proxy` 通过、真实上游请求返回 HTTP 200
- **变更文件**：`server/http.js`、`src/lib/agentBApiConfig.js`、`AGENTS.md`（新增最小修复铁律）
- **教训**：修单一问题时禁止顺手修改无关文件，所有优化想法需用户确认后再执行

## 2026-09-05 优化 Agent B 交接台参数表排版与微徽标溢出质感
- **问题**：Agent B 输入交接台参数表中，大字（字段值）与小小字（字段名 `.qh-field-key`）紧贴排版生硬，长字段名或长文本时容易撑爆单元格溢出，整体灰扑扑缺乏设计质感。
- **根因**：`.qh-field-key` 直接内联拼接在值文本末尾，缺乏弹性包裹层；单元格缺失换行控制；画布参数与四区参数直接输出长字符串或单调标签。
- **修复**：
  - 引入 `.field-val-box` 主从布局，大字高对比清晰居左，小小字升级为优雅紧凑的等宽微型徽标，长文本支持自动断行。
  - 画布参数重构为结构化参数芯片展示（尺寸、字号、行高、板书/动作速度一目了然）。
  - 四区参数升级为带颜色区分的分区芯片网格。
  - 参数表外层增加圆角、微阴影与精致分区标题线，全面杜绝文本溢出。
- **变更文件**：`src/agent-b-v2/AgentBDirect.vue`、`ENGINEERING_LOG.md`
- **验证**：`compile_applet` 通过。

## 2026-09-05 为参数表与五字段表格行添加 hover states 与 smooth transitions
- **目标**：增强参数管理与脚本执行表的交互反馈和高级质感（premium & responsive）。
- **改动**：
  - 五字段执行表：`tr > td` 增加 `cubic-bezier(0.4, 0, 0.2, 1)` 平滑背景与阴影过渡，悬停时左边缘呈现精致蓝色指示线，行号徽标、口播卡片和板书卡片联动柔和微升。
  - 交接台参数管理描述表：各参数行悬停时标签和内容平滑过渡，字段微徽标、画布参数微芯片与四区芯片悬停时具有立体悬浮效果与高亮描边。
  - 演播室参数控制面板：每个参数控制项在 hover 时平滑浮起并呈现浅白卡片微阴影。
- **验证**：`compile_applet` 通过。
