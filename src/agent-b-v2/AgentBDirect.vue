<script setup>
/* @qh-core LANE=B-V2 POINT=UI_WORKBENCH five-field table primary */
import { computed, ref, toRaw, watch, onUnmounted } from 'vue'
import { message } from 'ant-design-vue'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import {
  CheckCircleOutlined,
  WarningOutlined,
  DownloadOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  PlusOutlined,
  DeleteOutlined,
  RollbackOutlined,
  SoundOutlined,
  SafetyCertificateOutlined,
  FieldTimeOutlined,
  EyeOutlined,
  LoadingOutlined,
  ReloadOutlined,
  FileDoneOutlined,
  HolderOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons-vue'
import QhPageHeader from '../components/QhPageHeader.vue'
import { getAgentBoardToolCatalog } from '../board-tools/boardToolCatalog.js'
import { BOARD_MARK_COLORS } from '../board-tools/roughNotationTool.js'
import { ROUGH_DRAWING_COLORS } from '../board-tools/roughDrawingTool.js'
import { saveLiveBoardPreview } from '../board-preview/liveBoardPreview.js'
import { generateAgentBV2Rows } from './service.js'
import { applyAgentBV2Timeline } from './timing.js'
import { listSkills, DEFAULT_SKILL_ID } from './skills/index.js'
import { checkAgentRows, applyCheckResult, revertCheckResult } from '../check-agent/service.js'
import { batchPolishRowsMathAsr } from '../lib/mathAsrConverter.js'
import { agentBApiConfig } from '../lib/agentBApiConfig.js'
import { userApiConfig } from '../lib/userApiConfig.js'
import { exportElementsMarkdown, exportSpeechMarkdown, exportStoryboardMarkdown } from '../lib/speechMarkdown.js'
import VisualTimeline from '../components/VisualTimeline.vue'

const props = defineProps({
  initialHandoff: { type: Object, required: true },
})
const emit = defineEmits(['back-to-step1'])

// 安全深拷贝：规避 Vue reactive proxy 循环引用与不可序列化对象抛错导致的白屏
function safeDeepClone(val, fallback = {}) {
  try {
    if (val === undefined || val === null) return fallback
    return JSON.parse(JSON.stringify(toRaw(val)))
  } catch (err) {
    console.warn('[safeDeepClone] 数据深拷贝异常，已启用安全浅拷贝降级:', err)
    return (val && typeof val === 'object') ? { ...val } : fallback
  }
}

const localHandoff = ref(safeDeepClone(props.initialHandoff))
const handoff = computed(() => localHandoff.value)
// props 变化时同步更新 localHandoff（父组件重新传入 handoff 时）
watch(() => props.initialHandoff, (val) => {
  if (val) localHandoff.value = safeDeepClone(val)
}, { deep: true })

// 智能教研优雅思考步骤（分散等待时长，直观感知深度创作进程）
const GENERATING_STEPS = [
  { icon: '🔍', title: '研读题意与条件', desc: '正在解析关键已知条件、未知量与四区板书空间规划...' },
  { icon: '💡', title: '搭建儿童思维支架', desc: '正在唤醒核心知识点，梳理温柔循序的提问链与易错点...' },
  { icon: '✍️', title: '规划板书起手点与节拍', desc: '正在推导板书核心算式，精确定位起手坐标与留白布局...' },
  { icon: '🎙️', title: '润色专属口播文案', desc: '正在推敲由浅入深、温润自然的口播发音节奏与标点停顿...' },
  { icon: '✨', title: '对齐讲学时序分镜', desc: '正在校验口播语速与画布动作执行轴，五字段讲义即将呈现...' },
]
const generatingStepIndex = ref(0)
let generatingTimer = null

function startGeneratingTimer() {
  generatingStepIndex.value = 0
  clearInterval(generatingTimer)
  generatingTimer = setInterval(() => {
    // 阶段进度只允许向前，避免长请求时从最后一阶段跳回第一阶段造成“加载卡住/倒退”的错觉。
    generatingStepIndex.value = Math.min(generatingStepIndex.value + 1, GENERATING_STEPS.length - 1)
  }, 2800)
}

function stopGeneratingTimer() {
  clearInterval(generatingTimer)
  generatingTimer = null
}

onUnmounted(() => {
  stopGeneratingTimer()
})
const rows = ref([])
const state = ref('idle')
const errorText = ref('')
const generatedModel = ref('')
const checkState = ref('idle')
const checkChanges = ref([])
const checkSource = ref('check_agent') // 'check_agent' | 'math_asr'
const pendingCheckRows = ref(null)
const checkResultOpen = ref(false)
const checkFailedFallback = ref(false)
const deliverableGenerating = ref(false)
const deliverableResult = ref(null)
const deliverableModalOpen = ref(false)
const toolsOpen = ref(false)
const customSystemPrompt = ref('')
const refineLoading = ref(false)
const refineResultOpen = ref(false)
const refineResult = ref(null)
const skillList = listSkills()
const selectedSkillId = ref(DEFAULT_SKILL_ID)
const promptEditOpen = ref(false)
const currentSkillName = computed(() => {
  if (customSystemPrompt.value?.trim()) return '自定义提示词'
  const skill = skillList.find(s => s.id === selectedSkillId.value)
  return skill?.name || selectedSkillId.value
})
let checkRunId = 0
const toolCatalog = getAgentBoardToolCatalog()
const checkFieldLabels = {
  stage: '环节',
  speech: '口播稿',
  board: '板书内容',
  board_timing: '板书落笔时机',
  actionSpec: '板书动作',
  answer_error: '数学核验',
  structure: '结构精简',
}

const toolLabels = {
  underline: '下划线',
  highlight: '高亮',
  'rough-line': '辅助线',
  'rough-arrow': '箭头',
}

function formatToolFields(schema) {
  return Object.entries(schema).map(([name, value]) => ({
    name,
    value: typeof value === 'string' ? value : JSON.stringify(value),
  }))
}

function formatToolExample(example) {
  return JSON.stringify({ action: example }, null, 2)
}

const toolReferenceRows = toolCatalog.tools.flatMap((tool) => {
  if (tool.actions) {
    return tool.actions.map((item) => ({
      key: item.action,
      tool: tool.id,
      label: toolLabels[item.action] || item.action,
      summary: item.description,
      fields: formatToolFields({ ...tool.actionSchema, action: item.action }),
      example: formatToolExample(item.example),
    }))
  }
  return [{
    key: tool.id,
    tool: tool.id,
    label: toolLabels[tool.id] || tool.id,
    summary: tool.purpose,
    fields: formatToolFields(tool.actionSchema),
    example: formatToolExample(tool.example),
  }]
})

const stageAccentColors = {
  '题目': '#1677ff',
  '分析': '#fa8c16',
  '解答': '#52c41a',
  '总结': '#722ed1',
}

// stage 标签颜色（antd 内置色名，自动生成浅底色+深文字）
const stageTagColors = {
  '题目': 'blue',
  '分析': 'orange',
  '解答': 'green',
  '总结': 'purple',
}

// 画布参数配置（导出时跟着要素表一起导出）
const canvasParams = ref({
  coordinateMode: 'percentage',
  questionFontSize: 30,
  questionFontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  questionLineHeight: 1.65,
  rowGapMs: 1500,
  speechSpeed: 160,
})

// board 列编辑状态：-1 表示无编辑，>=0 表示正在编辑的行索引
const editingBoardIndex = ref(-1)

// 解析 board 字段，兼容 v1.0(string) 和 v2.0(object {startCoord, content, startDelay})
function parseBoard(board) {
  if (board == null) return { startCoord: '', content: '', startDelay: null }
  if (typeof board === 'string') {
    // v1.0 兼容：尝试解析 [x%, y%] 前缀
    const match = board.match(/^\[(\d+(?:\.\d+)?%\s*,\s*\d+(?:\.\d+)?%)\]\s*/)
    if (match) return { startCoord: '[' + match[1] + ']', content: board.slice(match[0].length), startDelay: null }
    return { startCoord: '', content: board, startDelay: null }
  }
  if (typeof board === 'object') {
    let startDelay = null
    if (typeof board.startDelay === 'number' && Number.isFinite(board.startDelay)) {
      startDelay = board.startDelay
    } else if (typeof board.startDelay === 'string') {
      const m = board.startDelay.match(/[\d.]+/)
      if (m) {
        const val = parseFloat(m[0])
        if (Number.isFinite(val)) startDelay = val
      }
    }
    return {
      startCoord: board.startCoord || '',
      startDelay,
      content: board.content || '',
    }
  }
  return { startCoord: '', content: String(board), startDelay: null }
}

function renderBoardContent(board) {
  const { content } = parseBoard(board)
  if (!content) return ''
  let result = String(content)
  // 处理 $$...$$（display mode）
  result = result.replace(/\$\$([\s\S]+?)\$\$/g, (match, expr) => {
    try {
      return katex.renderToString(expr.trim(), { throwOnError: false, displayMode: true, strict: 'ignore' })
    } catch { return match }
  })
  // 处理 $...$（inline mode）
  result = result.replace(/\$([^\$\n]+?)\$/g, (match, expr) => {
    try {
      return katex.renderToString(expr.trim(), { throwOnError: false, strict: 'ignore' })
    } catch { return match }
  })
  // 处理裸 LaTeX（包含 \frac \begin \sqrt 等）
  if (/\\(frac|begin|sqrt|sum|int|lim|boxed|times|div|cdot|leq|geq|neq|approx|pm|infty|alpha|beta|gamma|delta|theta|lambda|pi|perp|parallel|angle|triangle|odot|text|mathrm|mathbf|mathcal|mathbb|operatorname|over)/.test(result)) {
    try {
      return katex.renderToString(result, { throwOnError: false, strict: 'ignore' })
    } catch { return result }
  }
  return result
}

// 列空间合理分配与自由折叠模式（夏夏专属：支持按需折叠每列，超大留白，杜绝劣质滑动条）
const layoutPreset = ref('standard') // 'standard' | 'speech_focus' | 'board_focus' | 'custom'
const collapsedCols = ref({
  speech: false,
  board: false,
  actionSpec: false,
})

function setLayoutPreset(preset) {
  layoutPreset.value = preset
  if (preset === 'standard') {
    collapsedCols.value.speech = false
    collapsedCols.value.board = false
    collapsedCols.value.actionSpec = false
  } else if (preset === 'speech_focus') {
    collapsedCols.value.speech = false
    collapsedCols.value.board = true
    collapsedCols.value.actionSpec = true
  } else if (preset === 'board_focus') {
    collapsedCols.value.speech = true
    collapsedCols.value.board = false
    collapsedCols.value.actionSpec = false
  }
}

function toggleColumn(colKey) {
  layoutPreset.value = 'custom'
  collapsedCols.value[colKey] = !collapsedCols.value[colKey]
}

const columns = computed(() => {
  const isSpeechCol = collapsedCols.value.speech
  const isBoardCol = collapsedCols.value.board
  const isActionCol = collapsedCols.value.actionSpec

  return [
    {
      title: '排序',
      key: 'index',
      width: 70,
      align: 'center',
    },
    {
      title: '教学环节',
      key: 'stage',
      width: 86,
      align: 'center',
    },
    {
      title: isSpeechCol ? '口播 (已折叠)' : '演播室口播稿 (Speech)',
      key: 'speech',
      width: isSpeechCol ? 78 : (isBoardCol && isActionCol ? '72%' : isBoardCol ? '58%' : '46%'),
      minWidth: isSpeechCol ? 78 : 280,
    },
    {
      title: isBoardCol ? '板书 (已折叠)' : '课堂同步板书 (Board)',
      key: 'board',
      width: isBoardCol ? 78 : (isSpeechCol && isActionCol ? '72%' : isSpeechCol ? '58%' : '38%'),
      minWidth: isBoardCol ? 78 : 220,
    },
    {
      title: isActionCol ? '动作' : '板书动作',
      key: 'actionSpec',
      width: isActionCol ? 64 : 106,
      align: 'center',
    },
    {
      title: '行操作',
      key: 'operations',
      width: 106,
      align: 'center',
    },
  ]
})

// 计算单行字数与预估时长
function getRowEstimatedSeconds(speech) {
  const charCount = String(speech || '').replace(/\s+/g, '').length
  const speed = canvasParams.value?.speechSpeed || 160
  const sec = Math.max(1, Math.round((charCount / speed) * 60))
  return { charCount, seconds: sec }
}

// 计算全表总预估时长与总字数
const totalEstimatedStats = computed(() => {
  if (!rows.value.length) return { charCount: 0, text: '0秒', seconds: 0 }
  let totalChars = 0
  rows.value.forEach((r) => {
    totalChars += String(r.speech || '').replace(/\s+/g, '').length
  })
  const speed = canvasParams.value?.speechSpeed || 160
  const totalSpeechSec = Math.round((totalChars / speed) * 60)
  const totalGapSec = Math.round(((rows.value.length - 1) * (canvasParams.value?.rowGapMs || 1500)) / 1000)
  const totalSec = totalSpeechSec + totalGapSec
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  const timeStr = `${m > 0 ? `${m}分` : ''}${s}秒`
  return { charCount: totalChars, text: timeStr, seconds: totalSec }
})

// 计算全表板书动作规范总数
const totalActionCount = computed(() => {
  if (!rows.value.length) return 0
  return rows.value.reduce((acc, r) => acc + (Array.isArray(r.actionSpec) ? r.actionSpec.length : 0), 0)
})

// 纯前端本地数学算式口播兜底秒级转换（夏夏双保险核心）
function runInstantMathAsrPolish() {
  if (!rows.value.length) {
    message.warning('请先生成五字段执行表后再进行 ASR 兜底转换')
    return
  }
  const result = batchPolishRowsMathAsr(rows.value)
  if (!result.changes.length) {
    message.success('当前口播稿已全部符合数学自然读音规范，无需调整 ╰(๑◕ ▿ ◕๑)╯')
    return
  }
  pendingCheckRows.value = result.rows
  checkChanges.value = result.changes
  checkSource.value = 'math_asr'
  checkState.value = 'ready'
  checkResultOpen.value = true
  checkFailedFallback.value = false
  message.success(`已完成数学算式纯前端兜底分析，共发现 ${result.changes.length} 处规范化建议，已打开对比弹窗`)
}

let rowKeySeq = 1
const rowKeyWeakMap = new WeakMap()

const tableRows = computed(() =>
  rows.value.map((row, index) => {
    let key = rowKeyWeakMap.get(row)
    if (!key) {
      key = `row-uid-${rowKeySeq++}-${index}`
      rowKeyWeakMap.set(row, key)
    }
    return { ...row, _rowKey: key }
  })
)
const problemTypeLabel = computed(() => ({
  geometry: '几何题',
  calculation: '计算题',
  word: '应用题',
}[handoff.value?.problemType] || handoff.value?.problemType || '未确认'))
const pureTextLabel = computed(() => (handoff.value?.imageKind || 'text_only') === 'text_only' ? '是' : '否')
const boardFocusLabel = computed(() => ({
  geometry_diagram: '几何图解',
  calculation_process: '演算过程',
  relation_understanding: '关系理解',
  mixed: '综合分析',
}[handoff.value?.boardFocus] || handoff.value?.boardFocus || '未确认'))
const relatedKnowledge = computed(() => Array.isArray(handoff.value?.relatedKnowledge)
  ? handoff.value.relatedKnowledge
  : [])
const knowledgeAnalysis = computed(() => handoff.value?.knowledgeAnalysis || null)
const coreKnowledge = computed(() => Array.isArray(knowledgeAnalysis.value?.coreKnowledge)
  ? knowledgeAnalysis.value.coreKnowledge
  : [])
const selectedKnowledge = ref(null)
const keyFormulaList = computed(() => Array.isArray(knowledgeAnalysis.value?.keyFormulaList)
  ? knowledgeAnalysis.value.keyFormulaList
  : [])
const uncertainItems = computed(() => Array.isArray(handoff.value?.uncertainItems)
  ? handoff.value.uncertainItems
  : [])
const suggestedLayoutLabel = computed(() => ({
  left_right: '左右布局',
  top_bottom: '上下布局',
}[handoff.value?.suggestedLayout?.layout] || handoff.value?.suggestedLayout?.layout || '无'))
const confirmedAtLabel = computed(() => formatDisplayTime(handoff.value?.confirmedAt))
const zoneParameterRows = computed(() => {
  const anchors = handoff.value?.zoneAnchors || {}
  const labels = { question: '题目区', analysis: '分析区', solution: '解答区', summary: '总结区' }
  return Object.entries(labels).map(([key, label]) => ({
    key,
    label,
    value: formatRegion(anchors[key]?.regionStartCoord),
  }))
})
const handoffFlowSteps = computed(() => [
  { title: '识别题目', status: 'finish', description: '第1步已确认' },
  { title: '判断题型', status: handoff.value?.problemType ? 'finish' : 'wait', description: problemTypeLabel.value },
  { title: '画布排版', status: handoff.value?.boardPlan ? 'finish' : 'wait', description: '真画布与四区布局' },
  {
    title: '知识关联',
    status: relatedKnowledge.value.length ? 'finish' : 'wait',
    description: relatedKnowledge.value.length ? `${relatedKnowledge.value.length} 条可选参考` : '可选，按题目判断',
  },
  { title: '组装输入', status: 'finish', description: '题目、图片、布局、工具' },
  {
    title: '待发送生成',
    status: state.value === 'generating' ? 'process' : rows.value.length ? 'finish' : 'wait',
    description: state.value === 'generating'
      ? '正在生成 Agent B 五字段'
      : rows.value.length
        ? `已生成 ${rows.value.length} 行`
        : '准备就绪 · 点击生成',
  },
])

function formatDisplayTime(value) {
  const date = value ? new Date(value) : new Date()
  return Number.isNaN(date.valueOf()) ? String(value || '') : date.toLocaleString('zh-CN', { hour12: false })
}

function displayValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function formatRegion(region) {
  if (!region) return '未规划'
  const pct = (value) => Number(Number(value).toFixed(2))
  const size = region.w == null ? '' : `，宽 ${pct(region.w)}%${region.h == null ? '' : `，高 ${pct(region.h)}%`}`
  return `起点 (${pct(region.x)}%, ${pct(region.y)}%)${size}`
}

function invalidateCheck() {
  checkRunId += 1
  checkState.value = 'idle'
  pendingCheckRows.value = null
}

function updateRow(index, field, value) {
  invalidateCheck()
  rows.value[index] = { ...rows.value[index], [field]: value }
  if (field === 'speech' || field === 'stage') rows.value = applyAgentBV2Timeline(rows.value)
}

// 编辑 board.content 时保持 startCoord 不变（v2.0 结构化 board）
function updateBoardContent(index, content) {
  invalidateCheck()
  const current = parseBoard(rows.value[index].board)
  rows.value[index] = {
    ...rows.value[index],
    board: { startCoord: current.startCoord, content },
  }
}

// 编辑 board.startCoord 时保持 content 不变
function updateBoardStartCoord(index, startCoord) {
  invalidateCheck()
  const current = parseBoard(rows.value[index].board)
  rows.value[index] = {
    ...rows.value[index],
    board: { startCoord: startCoord || '', content: current.content, startDelay: current.startDelay },
  }
}

// 编辑 board.startDelay 落笔时机
function updateBoardStartDelay(index, startDelay) {
  invalidateCheck()
  const current = parseBoard(rows.value[index]?.board)
  const val = Number(parseFloat(startDelay) || 0)
  rows.value[index] = {
    ...rows.value[index],
    board: {
      ...current,
      startDelay: Math.max(0, Number(val.toFixed(1))),
    },
  }
}

// 视觉时间轴事件：点击某 Row 组定位并高亮表格对应行
function onSelectRowFromTimeline(index) {
  editingBoardIndex.value = index
  const allRows = document.querySelectorAll('.studio-table .ant-table-row')
  if (allRows && allRows[index]) {
    allRows[index].scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

// 视觉时间轴事件：调整某 Row 组板书动画起手 +n 秒延时
function onUpdateStartDelayFromTimeline({ index, startDelay }) {
  invalidateCheck()
  const current = parseBoard(rows.value[index]?.board)
  rows.value[index] = {
    ...rows.value[index],
    board: {
      ...current,
      startDelay: Number(startDelay.toFixed(1)),
    },
  }
  rows.value = applyAgentBV2Timeline(rows.value)
  message.success(`已调整第 ${index + 1} 组板书落笔起手为 +${startDelay.toFixed(1)}s ╰(๑◕ ▿ ◕๑)╯`)
}

function insertRowAfter(index) {
  invalidateCheck()
  const newRow = {
    stage: rows.value[index]?.stage || '分析',
    speech: '',
    board: { startCoord: '', content: '' },
    actionSpec: [],
  }
  rows.value.splice(index + 1, 0, newRow)
  rows.value = applyAgentBV2Timeline(rows.value)
  message.success('已在下方插入空白行，快来写下补充内容吧 ╰(๑◕ ▿ ◕๑)╯')
}

function deleteRow(index) {
  if (rows.value.length <= 1) {
    message.warning('不能全部删完哦，最少要保留一行内容哈 ฅ(⌯꒦ິ³꒦ິ⌯)ฅ')
    return
  }
  invalidateCheck()
  rows.value.splice(index, 1)
  rows.value = applyAgentBV2Timeline(rows.value)
  message.success('已成功删除该行 ٩(｡•ω•｡)و')
}

// Row 组手动拖拽排序与时间轴自动重算
const draggingIndex = ref(-1)
const dragOverIndex = ref(-1)
const dropPosition = ref('') // 'before' | 'after' | ''

function cleanupDrag() {
  draggingIndex.value = -1
  dragOverIndex.value = -1
  dropPosition.value = ''
}

function onHandleDragStart(event, index) {
  draggingIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
    const tr = event.target?.closest?.('tr')
    if (tr && event.dataTransfer.setDragImage) {
      event.dataTransfer.setDragImage(tr, 30, 20)
    }
  }
}

function onRowDragOver(event, index) {
  if (draggingIndex.value === -1) return
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }

  if (draggingIndex.value === index) {
    dragOverIndex.value = -1
    dropPosition.value = ''
    return
  }

  dragOverIndex.value = index
  const rect = event.currentTarget.getBoundingClientRect()
  const offset = event.clientY - rect.top
  dropPosition.value = offset < rect.height / 2 ? 'before' : 'after'
}

function onRowDragLeave(event, index) {
  if (event.currentTarget && event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) {
    return
  }
  if (dragOverIndex.value === index) {
    dragOverIndex.value = -1
    dropPosition.value = ''
  }
}

function onRowDrop(event, index) {
  event.preventDefault()
  const sourceIndex = draggingIndex.value
  if (sourceIndex === -1 || sourceIndex === index) {
    cleanupDrag()
    return
  }

  let targetIndex = index
  if (dropPosition.value === 'after' && sourceIndex < index) {
    targetIndex = index
  } else if (dropPosition.value === 'before' && sourceIndex > index) {
    targetIndex = index
  } else if (dropPosition.value === 'after' && sourceIndex > index) {
    targetIndex = index + 1
  } else if (dropPosition.value === 'before' && sourceIndex < index) {
    targetIndex = index - 1
  }
  targetIndex = Math.max(0, Math.min(rows.value.length - 1, targetIndex))

  if (sourceIndex !== targetIndex) {
    moveRow(sourceIndex, targetIndex)
  }
  cleanupDrag()
}

function onRowDragEnd() {
  cleanupDrag()
}

function customRow(record, index) {
  return {
    class: {
      'table-row-dragging': draggingIndex.value === index,
      'table-row-dragover-top': dragOverIndex.value === index && dropPosition.value === 'before',
      'table-row-dragover-bottom': dragOverIndex.value === index && dropPosition.value === 'after',
    },
    onDragover: (e) => onRowDragOver(e, index),
    onDragleave: (e) => onRowDragLeave(e, index),
    onDrop: (e) => onRowDrop(e, index),
  }
}

function moveRow(fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return
  if (fromIndex >= rows.value.length || toIndex >= rows.value.length) return

  invalidateCheck()
  const list = [...rows.value]
  const [movedItem] = list.splice(fromIndex, 1)
  list.splice(toIndex, 0, movedItem)

  // 重新规范化 actionSpec 中的全局 order（单手一维递增，保证全局动作编号与时间线播放顺序严格一致）
  let globalOrder = 1
  list.forEach((r) => {
    if (Array.isArray(r.actionSpec)) {
      r.actionSpec.forEach((item) => {
        if (item?.action && typeof item.action === 'object') {
          item.action.order = globalOrder++
        }
      })
    }
  })

  // 核心：在拖拽完成后自动重新计算整个视频的时间轴序列
  rows.value = applyAgentBV2Timeline(list, {
    rowGapMs: canvasParams.value?.rowGapMs || 1500,
  })

  message.success(`已调整行顺序（第 ${fromIndex + 1} 行 ➔ 第 ${toIndex + 1} 行），并已自动重新计算全片视频时间轴 ╰(๑◕ ▿ ◕๑)╯`)
}

// 监听演播室 Row 间隔与语速参数变化，实时重新计算全片时间轴
watch(
  () => [canvasParams.value?.rowGapMs, canvasParams.value?.speechSpeed],
  () => {
    if (rows.value.length) {
      rows.value = applyAgentBV2Timeline(rows.value, {
        rowGapMs: canvasParams.value?.rowGapMs || 1500,
      })
    }
  }
)

function actionLabel(entry) {
  const action = entry?.action
  if (!action) return '能力缺口'
  return [action.tool, action.action].filter(Boolean).join(' · ')
}

function actionContent(entry) {
  if (entry?.capabilityGap) return entry.capabilityGap.need
  const action = entry?.action || {}
  return action.content || action.target?.exactText || ''
}

// B 生成缓存：localStorage，24小时过期，Shift+点击强制刷新
const B_CACHE_PREFIX = 'b-gen:'
const B_CACHE_TTL = 24 * 60 * 60 * 1000

function bCacheKey() {
  const h = handoff.value || {}
  // 知识点摘要：取前3个知识点的名称，避免只取数量导致换知识点命中旧缓存
  const knowledgeDigest = Array.isArray(h.relatedKnowledge)
    ? h.relatedKnowledge.slice(0, 3).map(k => typeof k === 'string' ? k : (k.knowledgePoint || k.name || '')).join(',')
    : ''
  // knowledgeAnalysis 摘要：取 teachingFocus 前80字
  const analysisDigest = h.knowledgeAnalysis?.teachingFocus
    ? String(h.knowledgeAnalysis.teachingFocus).slice(0, 80)
    : ''
  return B_CACHE_PREFIX + [
    h.problemText?.slice(0, 80) || '',
    h.problemType || '',
    h.boardFocus || '',
    knowledgeDigest,
    analysisDigest,
    h.stageRatioSuggestion?.type || '',
    h.boardPlan?.question?.x || '',
    selectedSkillId.value || '',
    customSystemPrompt.value ? 'custom' : 'default',
  ].join('|')
}

function bCacheGet() {
  try {
    const raw = localStorage.getItem(bCacheKey())
    if (!raw) return null
    const data = JSON.parse(raw)
    if (Date.now() - data.timestamp > B_CACHE_TTL) {
      localStorage.removeItem(bCacheKey())
      return null
    }
    return data
  } catch { return null }
}

function bCacheSet(rows, model) {
  try {
    localStorage.setItem(bCacheKey(), JSON.stringify({ rows, model, timestamp: Date.now() }))
  } catch {
    // 存储超限防御：主动清理旧的 b-gen 缓存条目后再写入
    try {
      const keysToRemove = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(B_CACHE_PREFIX)) keysToRemove.push(k)
      }
      keysToRemove.forEach(k => localStorage.removeItem(k))
      localStorage.setItem(bCacheKey(), JSON.stringify({ rows, model, timestamp: Date.now() }))
    } catch {
      /* 依然无法写入则静默降级，不中断主流程 */
    }
  }
}

async function generateRows(force = false) {
  if (state.value === 'generating') return
  if (!force) {
    const cached = bCacheGet()
    if (cached) {
      rows.value = cached.rows
      generatedModel.value = cached.model
      state.value = 'ready'
      message.info(`已使用缓存结果（${cached.rows.length}行），Shift+点击可强制刷新`)
      return
    }
  }
  invalidateCheck()
  state.value = 'generating'
  errorText.value = ''
  startGeneratingTimer()
  try {
    // B 生成只请求剧本；不加载板书字体或发起字体网络请求。
    const result = await generateAgentBV2Rows({
      handoff: handoff.value,
      systemPrompt: customSystemPrompt.value,
      skillId: selectedSkillId.value,
      rowGapMs: canvasParams.value.rowGapMs,
      canvasParams: { ...canvasParams.value },
    })
    rows.value = result.rows
    generatedModel.value = result.model
    state.value = 'ready'
    bCacheSet(result.rows, result.model)
    message.success(`已生成 ${rows.value.length} 行五字段执行表`)
  } catch (error) {
    state.value = 'error'
    errorText.value = error?.message || String(error)
    message.error(errorText.value)
  } finally {
    stopGeneratingTimer()
  }
}

async function checkRows(mode = 'standard') {
  if (!rows.value.length || checkState.value === 'checking') return
  const runId = ++checkRunId
  checkState.value = 'checking'
  errorText.value = ''
  checkChanges.value = []
  try {
    const result = await checkAgentRows({
      rows: rows.value,
      mode,
    })
    if (runId !== checkRunId) return
    pendingCheckRows.value = result.rows
    checkChanges.value = result.changes
    checkSource.value = 'check_agent'
    checkState.value = 'ready'
    checkResultOpen.value = true
    checkFailedFallback.value = result.checkStatus === 'failed_fallback'
    if (result.checkStatus === 'local_asr_polished') {
      message.success(result.changes.length ? `ASR 规范优化完成，发现 ${result.changes.length} 处口播/板书改进` : 'ASR 检查完成，当前内容已符合规范')
    } else if (checkFailedFallback.value) {
      message.warning(`Check Agent 返回格式异常，已回退原表（${result.checkError || '未提供错误详情'}）。当前显示的是原表，未做任何修改。`)
    } else {
      message.success(result.changes.length ? `Check 完成，发现 ${result.changes.length} 处建议` : 'Check 完成，未发现需要修正的内容')
    }
  } catch (error) {
    if (runId !== checkRunId) return
    checkState.value = 'error'
    errorText.value = error?.message || String(error)
    message.error(errorText.value)
  }
}

function applyCheckChanges() {
  if (!pendingCheckRows.value || !checkChanges.value.length) return
  const changeCount = checkChanges.value.length
  const isAsr = checkSource.value === 'math_asr'
  rows.value = applyAgentBV2Timeline(pendingCheckRows.value, {
    rowGapMs: canvasParams.value?.rowGapMs || 1500,
  })
  if (!isAsr) {
    // Check Agent 结果同步写回服务端文件（文件即真相源）
    applyCheckResult(pendingCheckRows.value).catch(() => {
      message.warning('本地已应用，但保存到服务端失败，刷新后会恢复为原版本')
    })
  }
  pendingCheckRows.value = null
  checkChanges.value = []
  checkState.value = 'idle'
  checkResultOpen.value = false
  checkFailedFallback.value = false
  message.success(isAsr ? `已应用 ${changeCount} 处数学读音口播规范化修改` : `已应用 ${changeCount} 处 Check 修改`)
}

function discardCheckChanges() {
  pendingCheckRows.value = null
  checkResultOpen.value = false
  checkFailedFallback.value = false
}

// 还原到 Check 之前的原始版本
async function revertCheck() {
  try {
    const result = await revertCheckResult()
    rows.value = result.rows || []
    checkState.value = 'idle'
    message.success('已还原到 Check 之前的版本')
  } catch (error) {
    message.error(error?.message || '还原失败')
  }
}

function exportElements() {
  if (!rows.value.length) return
  exportElementsMarkdown(rows.value, {
    problemText: handoff.value?.problemText || '',
    model: generatedModel.value || agentBApiConfig.model || '',
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    canvasParams: JSON.parse(JSON.stringify(canvasParams.value)),
    handoffCanvasParams: handoff.value?.canvasParams || null,
    handoffBoardPlan: handoff.value?.boardPlan || null,
  })
  message.success('完整要素表 MD 已导出')
}

function exportSpeech() {
  if (!rows.value.length) return
  exportSpeechMarkdown(rows.value, {
    problemText: handoff.value?.problemText || '',
    model: generatedModel.value || agentBApiConfig.model || '',
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    handoffCanvasParams: handoff.value?.canvasParams || null,
  })
  message.success('口播稿 MD 已导出')
}

function exportStoryboard() {
  if (!rows.value.length) return
  exportStoryboardMarkdown(rows.value, {
    problemText: handoff.value?.problemText || '',
    model: generatedModel.value || agentBApiConfig.model || '',
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    handoffCanvasParams: handoff.value?.canvasParams || null,
    handoffBoardPlan: handoff.value?.boardPlan || null,
  })
  message.success('分镜表 MD 已导出')
}

// 固化生成最终交付产物单页：写入 public/deliverable/ 永久文件，刷新不丢失
async function generateDeliverablePage() {
  if (!rows.value.length) {
    message.warning('当前无生成内容，请先生成五字段后再固化产物单页')
    return
  }
  deliverableGenerating.value = true
  try {
    const payload = {
      projectCode: handoff.value?.projectCode,
      problemText: handoff.value?.problemText || '',
      sourceImageUrl: handoff.value?.sourceImageDataUrl || handoff.value?.sourceImageUrl || '',
      keepOriginal: Boolean(handoff.value?.keepOriginal),
      topicLayout: handoff.value?.topicLayout || null,
      boardPlan: handoff.value?.boardPlan || null,
      screenshotUrl: handoff.value?.screenshotUrl || '',
      meta: {
        problemType: handoff.value?.problemType || '小学数学题',
        boardFocus: handoff.value?.boardFocus || '图文结合',
        gradeLevel: handoff.value?.gradeLevel || '小学阶段',
        knowledgeTitle: handoff.value?.selectedKnowledge?.title || handoff.value?.knowledge || '核心知识点',
        canvasSize: { width: 1726, height: 980 },
      },
      stats: {
        totalDuration: totalEstimatedStats.value?.seconds || 0,
        totalDurationText: totalEstimatedStats.value?.text || '0秒',
        stepCount: rows.value?.length || 0,
        charCount: totalEstimatedStats.value?.charCount || 0,
        actionCount: totalActionCount.value || 0,
      },
      checkInfo: {
        checkApplied: checkState.value === 'ready' || checkChanges.value.length > 0,
        changeCount: checkChanges.value.length,
      },
      rows: toRaw(rows.value),
    }

    const res = await fetch('/api/deliverable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deliverable: payload }),
    })
    const data = await res.json()
    if (data.ok) {
      deliverableResult.value = data
      // 同步本地预览缓存作为双重保险
      saveLiveBoardPreview({
        problemText: payload.problemText,
        topicLayout: payload.topicLayout,
        boardPlan: payload.boardPlan,
        sourceImageUrl: payload.sourceImageUrl,
        keepOriginal: payload.keepOriginal,
        rows: payload.rows,
        projectCode: data.projectCode,
      })
      deliverableModalOpen.value = true
      message.success('教学视频素材产物单页已成功生成并归档！')
    } else {
      message.error(`生成产物单页失败：${data.error || '未知错误'}`)
    }
  } catch (err) {
    message.error(`生成产物单页网络异常：${err.message || String(err)}`)
  } finally {
    deliverableGenerating.value = false
  }
}

function openDeliverablePage() {
  const code = deliverableResult.value?.projectCode || handoff.value?.projectCode || ''
  // 优先打开落地归档的实体 HTML 单页文件（与 JSON 同名成对）
  const url = code ? `/deliverable/deliverable-${encodeURIComponent(code)}.html` : '/deliverable/current.html'
  window.open(url, '_blank')
}

function openLitePlayer() {
  window._LATEST_AGENT_B_RESULT = {
    projectCode: deliverableResult.value?.projectCode || handoff.value?.projectCode || '',
    handoff: handoff.value,
    rows: rows.value,
  }
  window.open('/lite-player.html', '_blank')
}

function downloadDeliverableJson() {
  const code = deliverableResult.value?.projectCode || handoff.value?.projectCode || ''
  if (!code) return
  const a = document.createElement('a')
  a.href = `/deliverable/deliverable-${encodeURIComponent(code)}.json`
  a.download = `deliverable-${code}.json`
  a.click()
}

// 知识点修缮：手动触发，调 POST /api/knowledge/refine，成功后弹结果弹窗，用户点应用才更新
async function refineKnowledge() {
  if (refineLoading.value) return
  refineLoading.value = true
  try {
    const resp = await fetch('/api/knowledge/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: userApiConfig.endpoint,
        model: userApiConfig.model,
        apiKey: userApiConfig.apiKey,
      }),
    })
    const result = await resp.json()
    if (result.ok && result.handoff) {
      refineResult.value = result
      refineResultOpen.value = true
    } else {
      message.error(result.error || '优化失败')
    }
  } catch (error) {
    message.error(error?.message || '优化异常')
  } finally {
    refineLoading.value = false
  }
}

// 应用修缮结果：更新 localHandoff，参数表动态读取自动刷新（不用刷新页面）
function applyRefine() {
  if (!refineResult.value?.handoff) return
  // refineResult 被 Vue ref 代理，handoff 对象带 ReactiveEffect 循环引用
  // 必须 toRaw + 安全深拷贝脱壳后再赋值，杜绝潜在的不可序列化对象抛错
  localHandoff.value = safeDeepClone(refineResult.value.handoff)
  refineResultOpen.value = false
  refineResult.value = null
  message.success('知识点已优化，参数表已更新')
}

// 保留原文：不更新，关闭弹窗
function keepOriginalRefine() {
  refineResultOpen.value = false
  refineResult.value = null
}

function formatRefineField(value) {
  if (value == null) return '（无）'
  if (Array.isArray(value)) return value.map((item, i) => `${i + 1}. ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n')
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

// 比较修缮前后字段是否有变化
function isRefineFieldEqual(original, refined) {
  if (original == null && refined == null) return true
  if (original == null || refined == null) return false
  return JSON.stringify(original) === JSON.stringify(refined)
}

</script>

<template>
  <a-layout class="qh-page">
  <div v-if="state === 'generating'" class="qh-loading-overlay" role="status" aria-live="polite">
    <div class="qh-loading-orbit" aria-hidden="true"><span></span><span></span><span></span></div>
    <div class="qh-loading-kicker">AI 教研工作台 · {{ generatingStepIndex + 1 }} / {{ GENERATING_STEPS.length }}</div>
    <Transition name="qh-loading-copy" mode="out-in">
      <div :key="generatingStepIndex" class="qh-loading-copy">
        <div class="qh-loading-title">{{ GENERATING_STEPS[generatingStepIndex].title }}<span class="qh-loading-dots">...</span></div>
        <div class="qh-loading-subtitle">{{ GENERATING_STEPS[generatingStepIndex].desc }}</div>
      </div>
    </Transition>
    <div class="qh-loading-progress"><span :style="{ width: `${((generatingStepIndex + 1) / GENERATING_STEPS.length) * 100}%` }"></span></div>
    <div class="qh-loading-note">请稍候，正在为这道题组织一条温柔、循序的讲解路径</div>
  </div>
  <QhPageHeader
      step-label="第 2 步 · Agent B"
      subtitle="题目信息 → 五字段"
      show-back
      @back="emit('back-to-step1')"
    >
      <template #actions>
        <a-button
          title="可用工具"
          @click="toolsOpen = !toolsOpen"
        >
          <template #icon>
            <ToolOutlined />
          </template>
          工具
        </a-button>
      </template>
    </QhPageHeader>

    <a-layout-content class="qh-page-content">
      <a-space
        direction="vertical"
        size="middle"
        style="width:100%"
      >
        <a-card
          class="qh-surface-card handoff-workbench-card"
          size="small"
        >
          <template #title>
            <div class="handoff-card-title">
              <span class="handoff-title-badge">📋</span>
              <span class="handoff-title-text">Agent B 输入交接台</span>
              <span class="handoff-title-sub">已同步 Agent A 识别与四区排版参数</span>
            </div>
          </template>
          <template #extra>
            <a-button
              type="primary"
              size="small"
              class="btn-refine-confirm"
              :loading="refineLoading"
              @click="refineKnowledge"
            >
              优化确认
            </a-button>
          </template>
          <div class="handoff-summary-bar">
            <span class="handoff-summary-label">交接状态</span>
            <a-steps
              class="qh-handoff-steps"
              size="small"
              :items="handoffFlowSteps"
            />
          </div>
          <div class="handoff-stats-chips">
            <span class="handoff-stat-tag">题目 1 道</span>
            <span class="handoff-stat-tag">画布分区 {{ handoff?.boardPlan ? 4 : 0 }} 个</span>
            <span class="handoff-stat-tag">知识参考 {{ relatedKnowledge.length }} 条</span>
            <span class="handoff-stat-tag">工具能力 {{ toolCatalog.tools.length }} 项</span>
          </div>

          <div class="qh-section-title">
            题目信息
          </div>
          <a-descriptions
            bordered
            size="small"
            :column="3"
            class="handoff-descriptions"
          >
            <a-descriptions-item label="题目类型">
              <div class="field-val-box">
                <span class="field-val-main">{{ problemTypeLabel }}</span>
                <span class="qh-field-key">problemType</span>
              </div>
            </a-descriptions-item>
            <a-descriptions-item label="是否纯文本">
              <div class="field-val-box">
                <span class="field-val-main">{{ pureTextLabel }}</span>
                <span class="qh-field-key">imageKind</span>
              </div>
            </a-descriptions-item>
            <a-descriptions-item label="板书侧重">
              <div class="field-val-box">
                <span class="field-val-main">{{ boardFocusLabel }}</span>
                <span class="qh-field-key">boardFocus</span>
              </div>
            </a-descriptions-item>
            <a-descriptions-item label="交接时间">
              <div class="field-val-box">
                <span class="field-val-main">{{ confirmedAtLabel }}</span>
                <span class="qh-field-key">confirmedAt</span>
              </div>
            </a-descriptions-item>
            <a-descriptions-item label="建议年级">
              <div class="field-val-box">
                <span class="field-val-main">{{ handoff?.suggestedGrade || '未判断' }}</span>
                <span class="qh-field-key">suggestedGrade</span>
              </div>
            </a-descriptions-item>
            <a-descriptions-item label="建议布局">
              <div class="field-val-box">
                <span class="field-val-main">{{ suggestedLayoutLabel }}</span>
                <span class="qh-field-key">suggestedLayout</span>
              </div>
            </a-descriptions-item>
            <a-descriptions-item label="画布参数" :span="3">
              <div v-if="handoff?.canvasParams" class="canvas-params-desc-box">
                <div class="canvas-params-chips-wrap">
                  <span class="canvas-param-chip">
                    <span class="chip-k">尺寸</span>
                    <span class="chip-v">{{ handoff.canvasParams.canvasSize.width }}×{{ handoff.canvasParams.canvasSize.height }}px</span>
                  </span>
                  <span class="canvas-param-chip">
                    <span class="chip-k">题目字号</span>
                    <span class="chip-v">{{ handoff.canvasParams.fontSize.question.px }}px</span>
                  </span>
                  <span class="canvas-param-chip">
                    <span class="chip-k">正文字号</span>
                    <span class="chip-v">{{ handoff.canvasParams.fontSize.analysis.px }}px</span>
                  </span>
                  <span class="canvas-param-chip">
                    <span class="chip-k">行高</span>
                    <span class="chip-v">题{{ handoff.canvasParams.lineHeight.question }} / 文{{ handoff.canvasParams.lineHeight.others }}</span>
                  </span>
                  <span class="canvas-param-chip">
                    <span class="chip-k">板书速度</span>
                    <span class="chip-v">{{ handoff.canvasParams.boardSpeed }}</span>
                  </span>
                  <span class="canvas-param-chip">
                    <span class="chip-k">动作速度</span>
                    <span class="chip-v">{{ handoff.canvasParams.actionSpeed }}</span>
                  </span>
                </div>
                <span class="qh-field-key">canvasParams</span>
              </div>
              <span v-else class="param-empty-text">未携带画布参数</span>
            </a-descriptions-item>
          </a-descriptions>

          <div class="qh-section-title">
            知识点
          </div>
          <a-descriptions
            bordered
            size="small"
            :column="{ xxl: 2, xl: 2, lg: 2, md: 1, sm: 1, xs: 1 }"
            class="handoff-descriptions"
          >
            <a-descriptions-item label="知识分析">
              <div class="field-val-box">
                <span class="field-val-main">{{ coreKnowledge.length }} 个核心知识点 · {{ keyFormulaList.length }} 条公式</span>
                <span class="qh-field-key">knowledgeAnalysis</span>
              </div>
            </a-descriptions-item>
            <a-descriptions-item label="交接来源">
              <div class="field-val-box">
                <span class="field-val-main">{{ handoff?.agentPageName || 'Agent A' }} · {{ handoff?.agentCapability || '未声明能力' }} · v{{ handoff?.handoffVersion || 1 }}</span>
                <span class="qh-field-key">agentMeta</span>
              </div>
            </a-descriptions-item>
            <a-descriptions-item
              label="知识关联点"
              :span="2"
            >
              <div class="field-val-box wrap-box">
                <div class="field-val-main">
                  <a-space wrap size="small">
                    <a-tag v-if="relatedKnowledge.length === 0" color="default">未优化</a-tag>
                    <a-tag
                      v-for="(item, idx) in relatedKnowledge"
                      :key="typeof item === 'string' ? idx : (item['编号'] || item['知识点'])"
                      color="blue"
                      class="knowledge-point-tag"
                    >
                      {{ typeof item === 'string' ? item : (item['知识点'] || '未命名知识点') }}
                    </a-tag>
                  </a-space>
                </div>
                <span class="qh-field-key">relatedKnowledge</span>
              </div>
            </a-descriptions-item>
            <a-descriptions-item
              v-if="knowledgeAnalysis?.teachingFocus"
              label="教学重点"
              :span="2"
            >
              <div class="field-val-box">
                <span class="field-val-main font-medium">{{ knowledgeAnalysis.teachingFocus }}</span>
                <span class="qh-field-key">teachingFocus</span>
              </div>
            </a-descriptions-item>
            <a-descriptions-item
              v-if="keyFormulaList.length"
              label="关���公式"
              :span="2"
            >
              <div class="field-val-box wrap-box">
                <div class="field-val-main">
                  <a-space wrap size="small">
                    <a-tag
                      v-for="formula in keyFormulaList"
                      :key="formula"
                      color="cyan"
                      class="formula-tag"
                    >
                      {{ formula }}
                    </a-tag>
                  </a-space>
                </div>
                <span class="qh-field-key">keyFormulaList</span>
              </div>
            </a-descriptions-item>
            <a-descriptions-item
              v-if="uncertainItems.length"
              label="待确认项"
              :span="2"
            >
              <div class="field-val-box wrap-box">
                <div class="field-val-main">
                  <a-space wrap size="small">
                    <a-tag
                      v-for="item in uncertainItems"
                      :key="displayValue(item)"
                      color="orange"
                    >
                      {{ displayValue(item) }}
                    </a-tag>
                  </a-space>
                </div>
                <span class="qh-field-key">uncertainItems</span>
              </div>
            </a-descriptions-item>
            <a-descriptions-item
              label="使用方式"
              :span="2"
            >
              <span class="handoff-usage-note">
                Agent A 只给软建议，不是门槛或强制清单；锚定题目与四区骨架后，由 Agent B 自主取舍、改写和补充。
              </span>
            </a-descriptions-item>
          </a-descriptions>

          <div class="qh-section-title">
            布局参数
          </div>
          <a-descriptions
            bordered
            size="small"
            :column="1"
            class="handoff-descriptions"
          >
            <a-descriptions-item label="四区布局">
              <div class="field-val-box">
                <span class="field-val-main">
                  <a-badge :status="handoff?.boardPlan ? 'success' : 'default'" :text="handoff?.boardPlan ? '已确认（标准四区网格）' : '未确认'" />
                </span>
                <span class="qh-field-key">boardPlan</span>
              </div>
            </a-descriptions-item>
            <a-descriptions-item label="四区参数">
              <div class="field-val-box wrap-box">
                <div class="field-val-main">
                  <div class="zone-tags-grid">
                    <div
                      v-for="zone in zoneParameterRows"
                      :key="zone.key"
                      class="zone-param-chip"
                    >
                      <span class="zone-chip-label">{{ zone.label }}</span>
                      <span class="zone-chip-val">{{ zone.value }}</span>
                    </div>
                  </div>
                </div>
                <span class="qh-field-key">zoneAnchors</span>
              </div>
            </a-descriptions-item>
          </a-descriptions>

          <div class="qh-section-title">
            交接元数据
          </div>
          <a-descriptions
            bordered
            size="small"
            :column="{ xxl: 2, xl: 2, lg: 2, md: 1, sm: 1, xs: 1 }"
            class="handoff-descriptions"
          >
            <a-descriptions-item label="画布截图">
              <div class="field-val-box">
                <span v-if="handoff?.screenshotUrl" class="meta-path-val">
                  {{ handoff.screenshotUrl }}
                </span>
                <span v-else class="param-empty-text">暂无截图</span>
                <span class="qh-field-key">screenshotUrl</span>
              </div>
            </a-descriptions-item>
            <a-descriptions-item label="知识库地址">
              <div class="field-val-box">
                <span class="meta-path-val">
                  {{ handoff?.knowledgeBasePath || 'doc/knowledge-a.compact.json' }}
                </span>
                <span class="qh-field-key">knowledgeBasePath</span>
              </div>
            </a-descriptions-item>
          </a-descriptions>

          <!-- 题型配比建议（SK-06 绑定CU） -->
          <div v-if="handoff?.stageRatioSuggestion" class="stage-ratio-suggestion">
            <div class="qh-section-title">
              题型配比建议
            </div>
            <a-descriptions
              bordered
              size="small"
              :column="{ xxl: 2, xl: 2, lg: 2, md: 1, sm: 1, xs: 1 }"
              class="handoff-descriptions"
            >
              <a-descriptions-item label="题型分类">
                <div class="field-val-box">
                  <div class="field-val-main">
                    <a-tag color="purple">
                      {{ handoff.stageRatioSuggestion.cuCode }} · {{ handoff.stageRatioSuggestion.type }} · {{ handoff.stageRatioSuggestion.category }}
                    </a-tag>
                    <a-tag v-if="handoff.stageRatioSuggestion.confidence === 'high'" color="green">高置信</a-tag>
                    <a-tag v-else-if="handoff.stageRatioSuggestion.confidence === 'medium'" color="orange">中置信</a-tag>
                  </div>
                  <span class="qh-field-key">cuCode</span>
                </div>
              </a-descriptions-item>
              <a-descriptions-item label="对应知识点">
                <div class="field-val-box">
                  <span class="field-val-main text-secondary">{{ handoff.stageRatioSuggestion.topicExamples }}</span>
                  <span class="qh-field-key">topicExamples</span>
                </div>
              </a-descriptions-item>
              <a-descriptions-item label="配比本质">
                <div class="field-val-box">
                  <span class="field-val-main">{{ handoff.stageRatioSuggestion.essence }}</span>
                  <span class="qh-field-key">essence</span>
                </div>
              </a-descriptions-item>
              <a-descriptions-item label="环节配比占比">
                <div class="ratio-bars-wrap">
                  <span class="ratio-pill analysis">分析 {{ handoff.stageRatioSuggestion.suggestedRatio.analysis }}</span>
                  <span class="ratio-pill solution">解答 {{ handoff.stageRatioSuggestion.suggestedRatio.solution }}</span>
                  <span class="ratio-pill summary">总结 {{ handoff.stageRatioSuggestion.suggestedRatio.summary }}</span>
                  <span class="ratio-pill intro">开收场 {{ handoff.stageRatioSuggestion.suggestedRatio.introAndClosing }}</span>
                </div>
              </a-descriptions-item>
            </a-descriptions>
          </div>

          <div
            v-if="coreKnowledge.length"
            class="knowledge-chips"
          >
            <a-tag
              v-for="item in coreKnowledge"
              :key="item.knowledgeId || item.knowledgePoint"
              color="blue"
              class="knowledge-chip"
              @click="selectedKnowledge = item"
            >
              {{ item.knowledgePoint || '未命名知识���' }}
            </a-tag>
          </div>
        </a-card>

        <a-alert
          v-if="errorText"
          type="error"
          show-icon
          :message="errorText"
        />


        <a-row :gutter="[16, 16]">
          <a-col :span="24">
            <a-card
              class="qh-surface-card studio-problem-card"
              :bordered="false"
            >
              <div class="problem-card-header">
                <div class="problem-card-title-wrap">
                  <span class="problem-card-badge">题</span>
                  <span class="problem-card-title">已确认题目</span>
                  <span class="problem-type-pill">{{ problemTypeLabel }}</span>
                  <span v-if="handoff?.suggestedGrade" class="grade-pill">{{ handoff.suggestedGrade }}</span>
                </div>
                <div class="problem-card-extra">
                  <span class="problem-char-stat">{{ (handoff?.problemText || '').length }} 字</span>
                </div>
              </div>
              <div class="problem-text-content">
                {{ handoff?.problemText || '暂无题目内容' }}
              </div>
            </a-card>
          </a-col>
        </a-row>

        <a-card class="qh-surface-card studio-workbench-card" :bordered="false">
          <template #title>
            <div class="workbench-title-box">
              <div class="workbench-title-left">
                <span class="workbench-main-title">五字段执行表</span>
                <span class="workbench-tag tag-type">{{ problemTypeLabel }}</span>
                <span class="workbench-tag tag-skill" title="当前讲课风格">{{ currentSkillName }}</span>
                <span v-if="generatedModel" class="workbench-tag tag-model">{{ generatedModel }}</span>
                <span v-if="rows.length" class="workbench-tag tag-rows">{{ rows.length }} 行</span>
              </div>
              <div v-if="rows.length" class="workbench-stat-pill">
                <FieldTimeOutlined style="margin-right: 4px; color: #0284c7;" />
                <span>总字数 {{ totalEstimatedStats.charCount }} 字 · 预估用时 {{ totalEstimatedStats.text }}</span>
              </div>
            </div>
          </template>

          <template #extra>
            <div class="studio-actions-container">
              <!-- 双保险 ASR 兜底与独立校验组 -->
              <div class="action-btn-group group-asr">
                <a-button
                  type="primary"
                  class="btn-asr-fallback"
                  :disabled="!rows.length || state === 'generating'"
                  title="纯前端本地数学算式语音兜底秒级转换：处理分数、未知数 x、幂运算与带括号混合运算，无需等待网络或模型"
                  @click="runInstantMathAsrPolish"
                >
                  <template #icon>
                    <SafetyCertificateOutlined />
                  </template>
                  ASR 兜底转换
                </a-button>

                <a-button
                  :disabled="!rows.length || state === 'generating'"
                  :loading="checkState === 'checking'"
                  class="btn-check-agent"
                  title="调用独立 Check Agent 进行语义与节奏深度润色"
                  @click="checkRows('standard')"
                >
                  <template #icon>
                    <CheckCircleOutlined />
                  </template>
                  Check Agent
                </a-button>

                <a-button
                  :disabled="!rows.length"
                  class="btn-revert"
                  title="还原到 Check 之前的原始版本"
                  @click="revertCheck"
                >
                  <template #icon>
                    <RollbackOutlined />
                  </template>
                  还原
                </a-button>
              </div>

              <!-- 最终交付产物单页组（Check Agent 之后的核心闭环按钮） -->
              <div class="action-btn-group group-deliverable">
                <a-button
                  type="primary"
                  class="btn-generate-deliverable"
                  :disabled="!rows.length || state === 'generating'"
                  :loading="deliverableGenerating"
                  title="确认满意后，固化生成最终教学视频素材参数单页（写入 public/deliverable/ 永久存档，刷新不丢失）"
                  @click="generateDeliverablePage"
                >
                  <template #icon>
                    <FileDoneOutlined />
                  </template>
                  生成产物单页
                </a-button>

                <a-button
                  v-if="deliverableResult"
                  class="btn-view-deliverable"
                  title="新窗口打开已生成的产物单页"
                  @click="openDeliverablePage"
                >
                  <template #icon>
                    <EyeOutlined />
                  </template>
                  查看产物单页
                </a-button>
              </div>

              <!-- 简易演播室组 (夏夏直观画布拖拽 + Fish Audio TTS 真实音频) -->
              <div class="action-btn-group group-lite-player">
                <a-button
                  class="btn-open-lite-player"
                  :disabled="!rows.length"
                  title="打开夏夏专属简易版播放器：画布直观拖拽排版 + 时间轴按语音顺序播放 MP3"
                  @click="openLitePlayer"
                >
                  <template #icon>
                    <PlayCircleOutlined />
                  </template>
                  ⚡ 简易版播放器 (拖拽+TTS)
                </a-button>
              </div>

              <!-- 导出数据组 -->
              <div class="action-btn-group group-export">
                <a-dropdown :disabled="!rows.length">
                  <template #overlay>
                    <a-menu>
                      <a-menu-item key="speech" @click="exportSpeech">
                        <DownloadOutlined /> 一键导出口播稿 MD (纯语音)
                      </a-menu-item>
                      <a-menu-item key="elements" @click="exportElements">
                        <DownloadOutlined /> 导出完整要素表 MD (五字段全量)
                      </a-menu-item>
                      <a-menu-item key="storyboard" @click="exportStoryboard">
                        <DownloadOutlined /> 导出时序分镜表 MD (时序排版)
                      </a-menu-item>
                    </a-menu>
                  </template>
                  <a-button :disabled="!rows.length" class="btn-export-dropdown">
                    <template #icon>
                      <DownloadOutlined />
                    </template>
                    导出讲义 MD
                  </a-button>
                </a-dropdown>
              </div>

              <!-- 提示词与核心生成组 -->
              <div class="action-btn-group group-generate">
                <a-button
                  class="btn-settings"
                  title="编辑/切换提示词"
                  @click="promptEditOpen = true"
                >
                  <template #icon>
                    <SettingOutlined />
                  </template>
                  提示词
                </a-button>

                <a-button
                  type="primary"
                  class="btn-main-generate"
                  :loading="state === 'generating'"
                  title="Shift+点击强制刷新缓存"
                  @click="(e) => generateRows(e.shiftKey)"
                >
                  <template #icon>
                    <ThunderboltOutlined />
                  </template>
                  {{ rows.length ? '重新生成五字段' : '生成 Agent B 五字段' }}
                </a-button>
              </div>
            </div>
          </template>

          <!-- 演播室时序与节奏控制面板 -->
          <div class="studio-params-panel">
            <div class="params-panel-header">
              <span class="params-panel-title">⏱️ 演播室时序与节奏</span>
              <span class="params-panel-hint">控制口播基准语速与行停顿，画布规格与字号忠实继承自 Agent A</span>
            </div>
            <div class="params-panel-controls">
              <div class="param-control-item">
                <span class="param-label">口播语速</span>
                <a-input-number
                  v-model:value="canvasParams.speechSpeed"
                  size="small"
                  :min="80"
                  :max="300"
                  :step="10"
                  addon-after="字/分"
                  style="width: 122px"
                />
              </div>

              <div class="param-control-item">
                <span class="param-label">Row 间隔停顿</span>
                <a-input-number
                  v-model:value="canvasParams.rowGapMs"
                  size="small"
                  :min="0"
                  :max="3000"
                  :step="100"
                  addon-after="ms"
                  style="width: 114px"
                />
              </div>

              <div class="param-control-item">
                <span class="param-coord-pill">
                  📐 标准真画布 1726×980 (16:9) · 四区百分比坐标系
                </span>
              </div>

              <div class="param-control-item">
                <span class="param-coord-pill secondary">
                  🔤 题 {{ handoff?.canvasParams?.fontSize?.question?.px || 30 }}px / 文 {{ handoff?.canvasParams?.fontSize?.analysis?.px || 24 }}px
                </span>
              </div>
            </div>
          </div>

          <div
            v-if="!rows.length"
            class="workbench-empty-state"
          >
            <div class="empty-icon-box">📐</div>
            <div class="empty-text-title">题目信息与四区排版已就绪</div>
            <div class="empty-text-sub">点击右上角「生成 Agent B 五字段」按钮，即可为小朋友生成由浅入深、温润启发式的讲课剧本</div>
            <a-button
              type="primary"
              size="large"
              class="btn-empty-generate"
              :loading="state === 'generating'"
              @click="(e) => generateRows(e.shiftKey)"
            >
              <template #icon>
                <ThunderboltOutlined />
              </template>
              开始生成五字段执行表
            </a-button>
          </div>

          <div v-else class="studio-table-container">
            <!-- 视觉时间轴组件：映射每个 Row 组为独立区块，展示 MP3 时长与 +n 秒板书起手延时 -->
            <VisualTimeline
              :rows="rows"
              :active-index="editingBoardIndex"
              @select-row="onSelectRowFromTimeline"
              @update-start-delay="onUpdateStartDelayFromTimeline"
            />

            <!-- 列空间合理分配与自由折叠工具条（夏夏专属） -->
            <div class="studio-col-layout-bar">
              <div class="col-layout-left">
                <span class="col-layout-label">分列布局:</span>
                <div class="preset-btn-group">
                  <button
                    type="button"
                    :class="['preset-btn', { active: layoutPreset === 'standard' }]"
                    title="标准全景：口播与板书舒适并列，空间均衡分配"
                    @click="setLayoutPreset('standard')"
                  >
                    🌟 标准全景
                  </button>
                  <button
                    type="button"
                    :class="['preset-btn', { active: layoutPreset === 'speech_focus' }]"
                    title="专注口播：折叠板书与动作，口播稿占超宽阔视野，沉浸打磨讲课录音文案"
                    @click="setLayoutPreset('speech_focus')"
                  >
                    🎙️ 专注口播
                  </button>
                  <button
                    type="button"
                    :class="['preset-btn', { active: layoutPreset === 'board_focus' }]"
                    title="专注板书：折叠口播与动作，板书占超宽阔视野，沉浸推导公式与推演几何"
                    @click="setLayoutPreset('board_focus')"
                  >
                    ✍️ 专注板书
                  </button>
                </div>
              </div>

              <div class="col-layout-right">
                <span class="col-layout-sublabel">每列折叠:</span>
                <button
                  type="button"
                  :class="['col-toggle-chip', { collapsed: collapsedCols.speech }]"
                  :title="collapsedCols.speech ? '点击展开口播列' : '点击折叠收起口播列'"
                  @click="toggleColumn('speech')"
                >
                  <span :class="['chip-dot', { off: collapsedCols.speech }]"></span>
                  🎙️ 口播稿 {{ collapsedCols.speech ? '(已折叠)' : '' }}
                </button>
                <button
                  type="button"
                  :class="['col-toggle-chip', { collapsed: collapsedCols.board }]"
                  :title="collapsedCols.board ? '点击展开板书列' : '点击折叠收起板书列'"
                  @click="toggleColumn('board')"
                >
                  <span :class="['chip-dot', { off: collapsedCols.board }]"></span>
                  ✍️ 课堂板书 {{ collapsedCols.board ? '(已折叠)' : '' }}
                </button>
                <button
                  type="button"
                  :class="['col-toggle-chip', { collapsed: collapsedCols.actionSpec }]"
                  :title="collapsedCols.actionSpec ? '点击展开动作列' : '点击折叠收起动作列'"
                  @click="toggleColumn('actionSpec')"
                >
                  <span :class="['chip-dot', { off: collapsedCols.actionSpec }]"></span>
                  ⚡ 板书动作 {{ collapsedCols.actionSpec ? '(已折叠)' : '' }}
                </button>
              </div>
            </div>

            <a-table
              :columns="columns"
              :data-source="tableRows"
              row-key="_rowKey"
              :pagination="false"
              class="studio-table"
              :bordered="false"
              :custom-row="customRow"
            >
            <!-- 表头自定义渲染：支持直接在表头点击折叠/展开每列 -->
            <template #headerCell="{ column }">
              <div v-if="column.key === 'speech'" class="col-header-flex">
                <span>{{ column.title }}</span>
                <button
                  type="button"
                  class="col-fold-trigger"
                  :title="collapsedCols.speech ? '点击展开口播稿列' : '点击折叠收起口播稿列，为板书腾出超大视野'"
                  @click.stop="toggleColumn('speech')"
                >
                  {{ collapsedCols.speech ? '展开 ◀▶' : '折叠' }}
                </button>
              </div>
              <div v-else-if="column.key === 'board'" class="col-header-flex">
                <span>{{ column.title }}</span>
                <button
                  type="button"
                  class="col-fold-trigger"
                  :title="collapsedCols.board ? '点击展开课堂板书列' : '点击折叠收起课堂板书列，为口播腾出超大视野'"
                  @click.stop="toggleColumn('board')"
                >
                  {{ collapsedCols.board ? '展开 ◀▶' : '折叠' }}
                </button>
              </div>
              <div v-else-if="column.key === 'actionSpec'" class="col-header-flex center">
                <span>{{ column.title }}</span>
                <button
                  type="button"
                  class="col-fold-trigger"
                  :title="collapsedCols.actionSpec ? '点击展开动作列' : '点击折叠收起动作列'"
                  @click.stop="toggleColumn('actionSpec')"
                >
                  {{ collapsedCols.actionSpec ? '展开' : '折叠' }}
                </button>
              </div>
              <span v-else>{{ column.title }}</span>
            </template>

            <template #bodyCell="{ column, record, index }">
              <!-- 序号与拖拽把手列 -->
              <div v-if="column.key === 'index'" class="cell-index-box">
                <div class="index-badge-row">
                  <div
                    class="row-drag-handle"
                    draggable="true"
                    title="按住鼠标拖拽此行调整顺序"
                    @dragstart="onHandleDragStart($event, index)"
                    @dragend="onRowDragEnd"
                  >
                    <HolderOutlined />
                  </div>
                  <span class="studio-row-badge">{{ index + 1 }}</span>
                </div>
                <div
                  v-if="record.estimatedStartMs != null"
                  class="row-timeline-pill"
                  :title="`第 ${index + 1} 组：${(record.estimatedStartMs / 1000).toFixed(1)}s ~ ${(record.estimatedEndMs / 1000).toFixed(1)}s（耗时 ${(record.estimatedDurationMs / 1000).toFixed(1)}s）`"
                >
                  {{ (record.estimatedStartMs / 1000).toFixed(1) }}s-{{ (record.estimatedEndMs / 1000).toFixed(1) }}s
                </div>
              </div>

              <!-- 环节列 (Stage) -->
              <div v-else-if="column.key === 'stage'" class="cell-stage-box">
                <a-popover trigger="click" placement="bottomLeft" :overlayStyle="{ minWidth: '120px' }">
                  <template #content>
                    <div class="stage-picker-title">切换环节</div>
                    <a-space direction="vertical" size="4" style="display: flex;">
                      <a-button
                        v-for="opt in ['题目', '分析', '解答', '总结']"
                        :key="opt"
                        size="small"
                        :type="record.stage === opt ? 'primary' : 'text'"
                        class="stage-picker-btn"
                        @click="updateRow(index, 'stage', opt)"
                      >
                        {{ opt }}
                      </a-button>
                    </a-space>
                  </template>
                  <div :class="['stage-capsule', 'stage-' + record.stage]" title="点击切换教学环节">
                    <span class="stage-capsule-dot" />
                    <span class="stage-capsule-text">{{ record.stage }}</span>
                  </div>
                </a-popover>
              </div>

              <!-- 口播稿列 (Speech) -->
              <div v-else-if="column.key === 'speech'" class="cell-speech-box">
                <!-- 口播列折叠态：精巧微缩胶囊，点击一键展开 -->
                <div
                  v-if="collapsedCols.speech"
                  class="collapsed-cell-card speech-collapsed"
                  title="口播稿已折叠，点击展开"
                  @click="toggleColumn('speech')"
                >
                  <SoundOutlined class="collapsed-icon" />
                  <span class="collapsed-text">{{ getRowEstimatedSeconds(record.speech).charCount }}字</span>
                  <span class="collapsed-tip">展开</span>
                </div>
                <!-- 口播列展开态：舒展大卡片 -->
                <div v-else class="speech-textarea-card">
                  <a-textarea
                    :value="record.speech"
                    :auto-size="{ minRows: 2, maxRows: 8 }"
                    class="studio-speech-input"
                    placeholder="请输入老师口播文案（支持自然标点停顿）..."
                    @change="(event) => updateRow(index, 'speech', event.target.value)"
                  />
                  <div class="speech-stat-footer">
                    <span class="speech-stat-chars">{{ getRowEstimatedSeconds(record.speech).charCount }} 字</span>
                    <span class="speech-stat-divider">·</span>
                    <span class="speech-stat-time">约 {{ getRowEstimatedSeconds(record.speech).seconds }} 秒</span>
                  </div>
                </div>
              </div>

              <!-- 板书内容列 (Board) -->
              <div v-else-if="column.key === 'board'" class="cell-board-box">
                <!-- 板书列折叠态：精巧微缩胶囊，点击一键展开 -->
                <div
                  v-if="collapsedCols.board"
                  class="collapsed-cell-card board-collapsed"
                  title="板书内容已折叠，点击展开"
                  @click="toggleColumn('board')"
                >
                  <span class="collapsed-icon">✍️</span>
                  <span class="collapsed-text">{{ parseBoard(record.board).startCoord || '板书' }}</span>
                  <span class="collapsed-tip">展开</span>
                </div>
                <!-- 板书列展开态 -->
                <div v-else-if="editingBoardIndex !== index" class="board-card-view" @click="editingBoardIndex = index">
                  <div class="board-card-topbar">
                    <div class="board-tags-left">
                      <span v-if="parseBoard(record.board).startCoord" class="board-coord-tag">
                        {{ parseBoard(record.board).startCoord }}
                      </span>
                      <span v-else class="board-coord-tag empty">未定起手点</span>
                      <span
                        v-if="parseBoard(record.board).startDelay"
                        class="board-delay-tag"
                        :title="`本行语音播放 +${parseBoard(record.board).startDelay}s 后动笔写板书`"
                      >
                        ⏱️ +{{ parseBoard(record.board).startDelay }}s
                      </span>
                    </div>
                    <span class="board-edit-hint">点击编辑板书</span>
                  </div>
                  <div class="board-math-render" v-html="renderBoardContent(record.board) || '<span class=\'board-empty-hint\'>（无板书内容）</span>'" />
                </div>

                <div v-else class="board-card-edit">
                  <div class="board-edit-grid">
                    <div>
                      <div class="board-edit-label">起手坐标:</div>
                      <a-input
                        :value="parseBoard(record.board).startCoord"
                        size="small"
                        placeholder="如 [10%, 45%]"
                        class="board-coord-input"
                        @change="(event) => updateBoardStartCoord(index, event.target.value)"
                      />
                    </div>
                    <div>
                      <div class="board-edit-label">落笔时机 (语音播放后延时):</div>
                      <a-input-number
                        :value="parseBoard(record.board).startDelay || 0"
                        size="small"
                        :min="0"
                        :max="60"
                        :step="0.1"
                        addon-after="秒"
                        style="width: 110px;"
                        @change="(val) => updateBoardStartDelay(index, val)"
                      />
                    </div>
                  </div>
                  <div class="board-edit-label" style="margin-top: 6px;">板���内容 (支持 KaTeX):</div>
                  <a-textarea
                    :value="parseBoard(record.board).content"
                    :auto-size="{ minRows: 2, maxRows: 8 }"
                    class="board-content-input"
                    @change="(event) => updateBoardContent(index, event.target.value)"
                  />
                  <div class="board-edit-actions">
                    <a-button size="small" type="primary" class="board-done-btn" @click="editingBoardIndex = -1">
                      完成
                    </a-button>
                  </div>
                </div>
              </div>

              <!-- 板书动作列 (ActionSpec) -->
              <div v-else-if="column.key === 'actionSpec'" class="cell-action-box">
                <!-- 动作列折叠态：极细胶囊 -->
                <div v-if="collapsedCols.actionSpec" class="collapsed-action-wrap">
                  <a-popover
                    v-if="record.actionSpec && record.actionSpec.length"
                    trigger="click"
                    placement="left"
                  >
                    <template #content>
                      <div class="action-popover-title">当前行板书动作详情</div>
                      <a-list
                        :data-source="record.actionSpec"
                        size="small"
                        style="width: 360px; max-height: 400px; overflow: auto"
                      >
                        <template #renderItem="{ item }">
                          <a-list-item>
                            <a-space direction="vertical" size="small" style="width: 100%;">
                              <a-space :size="4" wrap>
                                <a-tag v-if="item.action?.order" color="blue">#{{ item.action.order }}</a-tag>
                                <a-tag color="cyan">{{ actionLabel(item) }}</a-tag>
                              </a-space>
                              <div class="action-popover-content">{{ actionContent(item) }}</div>
                            </a-space>
                          </a-list-item>
                        </template>
                      </a-list>
                    </template>
                    <div class="collapsed-action-pill" title="点击查看动作指令参数">
                      <span class="action-badge-icon">⚡</span>
                      <span class="action-badge-num">{{ record.actionSpec.length }}</span>
                    </div>
                  </a-popover>
                  <span v-else class="action-empty-dash">—</span>
                </div>

                <!-- 动作列展开态 -->
                <a-popover
                  v-else-if="record.actionSpec && record.actionSpec.length"
                  trigger="click"
                  placement="left"
                >
                  <template #content>
                    <div class="action-popover-title">当前行板书动作详情</div>
                    <a-list
                      :data-source="record.actionSpec"
                      size="small"
                      style="width: 360px; max-height: 400px; overflow: auto"
                    >
                      <template #renderItem="{ item }">
                        <a-list-item>
                          <a-space direction="vertical" size="small" style="width: 100%;">
                            <a-space :size="4" wrap>
                              <a-tag v-if="item.action?.order" color="blue">#{{ item.action.order }}</a-tag>
                              <a-tag color="cyan">{{ actionLabel(item) }}</a-tag>
                            </a-space>
                            <div class="action-popover-content">{{ actionContent(item) }}</div>
                          </a-space>
                        </a-list-item>
                      </template>
                    </a-list>
                  </template>
                  <div class="action-badge-pill active" title="点击查看动作指令参数">
                    <span class="action-badge-icon">⚡</span>
                    <span>{{ record.actionSpec.length }} 个动作</span>
                  </div>
                </a-popover>
                <span v-else class="action-empty-dash">—</span>
              </div>

              <!-- 操作列 (Operations) -->
              <div v-else-if="column.key === 'operations'" class="cell-ops-box">
                <a-space :size="4">
                  <a-button
                    type="text"
                    size="small"
                    class="btn-op-move"
                    :disabled="index === 0"
                    title="上移此行"
                    @click="moveRow(index, index - 1)"
                  >
                    <template #icon><ArrowUpOutlined /></template>
                  </a-button>
                  <a-button
                    type="text"
                    size="small"
                    class="btn-op-move"
                    :disabled="index === rows.length - 1"
                    title="下移此行"
                    @click="moveRow(index, index + 1)"
                  >
                    <template #icon><ArrowDownOutlined /></template>
                  </a-button>
                  <a-button
                    type="primary"
                    shape="circle"
                    size="small"
                    class="btn-op-add"
                    title="在下方新增一行"
                    @click="insertRowAfter(index)"
                  >
                    <template #icon><PlusOutlined /></template>
                  </a-button>
                  <a-popconfirm
                    title="确定要删除这一行吗？"
                    ok-text="确定删除"
                    cancel-text="取消"
                    @confirm="deleteRow(index)"
                  >
                    <a-button
                      type="text"
                      danger
                      shape="circle"
                      size="small"
                      class="btn-op-del"
                      title="删除这一行"
                    >
                      <template #icon><DeleteOutlined /></template>
                    </a-button>
                  </a-popconfirm>
                </a-space>
              </div>
            </template>
          </a-table>
        </div>
      </a-card>

        <a-card
          v-if="toolsOpen"
          title="可用工具说明"
          class="qh-surface-card qh-tool-card"
          size="small"
        >
          <template #extra>
            <a-typography-text type="secondary">
              单手串行 · 随口播触发 · 坐标单位百分比
            </a-typography-text>
          </template>
          <a-row :gutter="[12, 12]">
            <a-col
              v-for="item in toolReferenceRows"
              :key="item.key"
              :span="24"
            >
              <a-card
                size="small"
                class="qh-tool-item"
              >
                <a-row
                  :gutter="12"
                  align="top"
                >
                  <a-col :span="6">
                    <div class="qh-tool-preview">
                      <svg
                        v-if="item.key === 'underline'"
                        viewBox="0 0 120 40"
                        width="100%"
                        height="40"
                      >
                        <text
                          x="10"
                          y="18"
                          font-size="14"
                          fill="#263238"
                          font-family="serif"
                        >标记的文字</text>
                        <path
                          d="M8 26 Q 60 38 112 26"
                          :stroke="BOARD_MARK_COLORS.red"
                          stroke-width="2"
                          fill="none"
                          stroke-linecap="round"
                        />
                      </svg>
                      <svg
                        v-else-if="item.key === 'highlight'"
                        viewBox="0 0 120 40"
                        width="100%"
                        height="40"
                      >
                        <rect
                          x="6"
                          y="8"
                          width="108"
                          height="22"
                          :fill="BOARD_MARK_COLORS.yellow"
                          opacity="0.4"
                          rx="3"
                        />
                        <text
                          x="10"
                          y="24"
                          font-size="14"
                          fill="#263238"
                          font-family="serif"
                        >高亮的文字</text>
                      </svg>
                      <svg
                        v-else-if="item.key === 'rough-line'"
                        viewBox="0 0 120 40"
                        width="100%"
                        height="40"
                      >
                        <path
                          d="M10 20 Q 60 18 110 22"
                          :stroke="ROUGH_DRAWING_COLORS.ink"
                          stroke-width="2"
                          fill="none"
                          stroke-linecap="round"
                        />
                      </svg>
                      <svg
                        v-else-if="item.key === 'rough-arrow'"
                        viewBox="0 0 120 40"
                        width="100%"
                        height="40"
                      >
                        <path
                          d="M10 20 Q 60 18 100 22"
                          :stroke="ROUGH_DRAWING_COLORS.red"
                          stroke-width="2"
                          fill="none"
                          stroke-linecap="round"
                        />
                        <path
                          d="M100 22 L 110 16 M 100 22 L 108 28"
                          :stroke="ROUGH_DRAWING_COLORS.red"
                          stroke-width="2"
                          fill="none"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </div>
                  </a-col>
                  <a-col :span="18">
                    <div class="qh-tool-title">
                      <a-tag color="blue">
                        {{ item.label }}
                      </a-tag>
                      <span class="qh-tool-tool-id">{{ item.tool }}</span>
                    </div>
                    <div class="qh-tool-summary">
                      {{ item.summary }}
                    </div>
                    <div class="qh-tool-fields">
                      <div
                        v-for="f in item.fields"
                        :key="f.name"
                        class="qh-tool-field"
                      >
                        <code class="qh-field-name">{{ f.name }}</code>
                        <span class="qh-field-value">{{ f.value }}</span>
                      </div>
                    </div>
                  </a-col>
                </a-row>
                <div
                  v-if="item.example"
                  class="qh-tool-example"
                >
                  <div class="qh-tool-example-label">
                    示例
                  </div>
                  <pre class="qh-tool-example-code">{{ item.example }}</pre>
                </div>
              </a-card>
            </a-col>
          </a-row>
          <a-divider style="margin: 12px 0" />
          <a-row :gutter="12">
            <a-col :span="12">
              <a-typography-title :level="5">
                通用参数
              </a-typography-title>
              <div class="qh-tool-common">
                <div><b>action.order</b>：全表唯一正整数，按播放顺序递增</div>
                <div><b>标记颜色</b>：下划线红色；高亮浅黄色</div>
                <div>
                  <b>直线 / 箭头颜色</b>：<a-tag color="default">
                    ink
                  </a-tag> <a-tag color="red">
                    red
                  </a-tag>
                </div>
                <div><b>笔画 strokeWidthId</b>：normal（细）/ emphasis（粗）</div>
              </div>
            </a-col>
            <a-col :span="12">
              <a-typography-title :level="5">
                可用区域
              </a-typography-title>
              <div class="qh-tool-common">
                <div>
                  <a-tag>question 题目区</a-tag> <a-tag color="orange">
                    analysis 分析区
                  </a-tag>
                </div>
                <div>
                  <a-tag color="green">
                    solution 解答区
                  </a-tag> <a-tag color="purple">
                    summary 总结区
                  </a-tag>
                </div>
                <div style="margin-top:6px;color:#8c8c8c;font-size:12px">
                  绘图工具四个区域都可以画；文字标记只能标记已有的文字
                </div>
              </div>
            </a-col>
          </a-row>
        </a-card>
      </a-space>
    </a-layout-content>
    <a-modal
      :open="Boolean(selectedKnowledge)"
      :title="selectedKnowledge?.knowledgePoint || '知识点详情'"
      width="720px"
      :footer="null"
      @cancel="selectedKnowledge = null"
    >
      <a-descriptions
        v-if="selectedKnowledge"
        bordered
        size="small"
        :column="1"
        class="knowledge-detail-table"
      >
        <a-descriptions-item label="编号">
          {{ selectedKnowledge.knowledgeId || '未提供' }}
        </a-descriptions-item>
        <a-descriptions-item label="学段 / 系列 / 类型">
          {{ [selectedKnowledge.rawKnowledgeRecord?.学段, selectedKnowledge.rawKnowledgeRecord?.系列, selectedKnowledge.rawKnowledgeRecord?.类型].filter(Boolean).join(' / ') || '未提供' }}
        </a-descriptions-item>
        <a-descriptions-item label="经典样题">
          {{ selectedKnowledge.rawKnowledgeRecord?.经典样题 || '未提供' }}
        </a-descriptions-item>
        <a-descriptions-item label="考点">
          {{ selectedKnowledge.examinationPoint || selectedKnowledge.rawKnowledgeRecord?.考点 || '未提供' }}
        </a-descriptions-item>
        <a-descriptions-item label="策略方法">
          {{ selectedKnowledge.strategy || selectedKnowledge.rawKnowledgeRecord?.策略方法 || '未提供' }}
        </a-descriptions-item>
        <a-descriptions-item label="讲解要点">
          {{ selectedKnowledge.rawKnowledgeRecord?.讲解要点举例 || '未提供' }}
        </a-descriptions-item>
        <a-descriptions-item label="易错点">
          {{ selectedKnowledge.commonMistakes?.join('；') || selectedKnowledge.rawKnowledgeRecord?.易错点 || '未提供' }}
        </a-descriptions-item>
        <a-descriptions-item label="公式">
          {{ selectedKnowledge.formula || '按本题判断' }}
        </a-descriptions-item>
        <a-descriptions-item label="总结归纳">
          {{ selectedKnowledge.summary || selectedKnowledge.rawKnowledgeRecord?.总结归纳 || '未提供' }}
        </a-descriptions-item>
      </a-descriptions>
    </a-modal>
    <a-modal
      v-model:open="checkResultOpen"
      :title="checkSource === 'math_asr' ? 'ASR 纯前端数学算式语音转换建议' : 'Check Agent 独立督导润色结果'"
      :width="760"
      @cancel="discardCheckChanges"
    >
      <div
        v-if="checkFailedFallback"
        class="qh-check-empty"
      >
        <WarningOutlined style="color: #faad14;" />
        <div>
          <strong>Check Agent 返回格式异常，已回退原表</strong>
          <p>当前五字段执行表保持原样，未做任何修改。</p>
        </div>
      </div>
      <div
        v-else-if="!checkChanges.length"
        class="qh-check-empty"
      >
        <CheckCircleOutlined />
        <div>
          <strong>未发现需要润色的内容</strong>
          <p>当前五字段执行表保持原样。</p>
        </div>
      </div>
      <a-list
        v-else
        bordered
        :data-source="checkChanges"
        class="qh-check-list"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <div class="qh-check-change">
              <a-space
                wrap
                size="small"
              >
                <a-tag color="blue">
                  第 {{ item.row || '?' }} 行
                </a-tag>
                <a-tag>{{ checkFieldLabels[item.field] || item.field }}</a-tag>
                <a-typography-text type="secondary">
                  {{ item.reason }}
                </a-typography-text>
              </a-space>
              <div class="qh-check-diff">
                <div>
                  <span>原文</span>
                  <p>{{ item.before || '（空）' }}</p>
                </div>
                <div>
                  <span>修正后</span>
                  <p>{{ item.after || '（空）' }}</p>
                </div>
              </div>
            </div>
          </a-list-item>
        </template>
      </a-list>
      <template #footer>
        <a-button @click="discardCheckChanges">
          保留原文
        </a-button>
        <a-button
          v-if="checkChanges.length"
          type="primary"
          @click="applyCheckChanges"
        >
          应用 {{ checkChanges.length }} 处修改
        </a-button>
      </template>
    </a-modal>

    <a-modal
      v-model:open="refineResultOpen"
      title="知识点修缮对比"
      :footer="null"
      width="900px"
      :destroy-on-close="true"
    >
      <a-alert
        v-if="refineResult?.refineOk === false"
        type="warning"
        :message="refineResult?.warning || 'AI 这次没返回标准格式，已保留原内容，可重试'"
        show-icon
        style="margin-bottom: 16px"
      />
      <div v-else>
        <div style="margin-bottom: 12px">
          <a-typography-text type="secondary" style="font-size: 12px">
            左侧为 Agent A 自动匹配结果，右侧为教研 Agent 提炼优化。对比后选择是否应用。
          </a-typography-text>
        </div>
        <a-descriptions
          bordered
          size="small"
          :column="1"
        >
          <a-descriptions-item label="关联知识点">
            <div class="refine-compare-row">
              <div class="refine-compare-col refine-col-original">
                <div class="refine-compare-label">
                  机筛原文
                </div>
                <pre class="refine-compare-content">{{ formatRefineField(handoff?.relatedKnowledge) }}</pre>
              </div>
              <div class="refine-compare-col refine-col-refined">
                <div class="refine-compare-label">
                  教研修缮
                  <a-tag v-if="!isRefineFieldEqual(handoff?.relatedKnowledge, refineResult?.handoff?.relatedKnowledge)" color="green" size="small" style="margin-left: 6px">已优化</a-tag>
                </div>
                <pre class="refine-compare-content">{{ formatRefineField(refineResult?.handoff?.relatedKnowledge) }}</pre>
              </div>
            </div>
          </a-descriptions-item>
          <a-descriptions-item label="教学重点">
            <div class="refine-compare-row">
              <div class="refine-compare-col refine-col-original">
                <div class="refine-compare-label">
                  机筛原文
                </div>
                <pre class="refine-compare-content">{{ formatRefineField(handoff?.knowledgeAnalysis?.teachingFocus) }}</pre>
              </div>
              <div class="refine-compare-col refine-col-refined">
                <div class="refine-compare-label">
                  教研修缮
                  <a-tag v-if="!isRefineFieldEqual(handoff?.knowledgeAnalysis?.teachingFocus, refineResult?.handoff?.knowledgeAnalysis?.teachingFocus)" color="green" size="small" style="margin-left: 6px">已优化</a-tag>
                </div>
                <pre class="refine-compare-content">{{ formatRefineField(refineResult?.handoff?.knowledgeAnalysis?.teachingFocus) }}</pre>
              </div>
            </div>
          </a-descriptions-item>
          <a-descriptions-item label="关键公式">
            <div class="refine-compare-row">
              <div class="refine-compare-col refine-col-original">
                <div class="refine-compare-label">
                  机筛原文
                </div>
                <pre class="refine-compare-content">{{ formatRefineField(handoff?.knowledgeAnalysis?.keyFormulaList) }}</pre>
              </div>
              <div class="refine-compare-col refine-col-refined">
                <div class="refine-compare-label">
                  教研修缮
                  <a-tag v-if="!isRefineFieldEqual(handoff?.knowledgeAnalysis?.keyFormulaList, refineResult?.handoff?.knowledgeAnalysis?.keyFormulaList)" color="green" size="small" style="margin-left: 6px">已优化</a-tag>
                </div>
                <pre class="refine-compare-content">{{ formatRefineField(refineResult?.handoff?.knowledgeAnalysis?.keyFormulaList) }}</pre>
              </div>
            </div>
          </a-descriptions-item>
          <a-descriptions-item label="公式提示">
            <div class="refine-compare-row">
              <div class="refine-compare-col refine-col-original">
                <div class="refine-compare-label">
                  机筛原文
                </div>
                <pre class="refine-compare-content">{{ formatRefineField(handoff?.knowledgeAnalysis?.formulaHints) }}</pre>
              </div>
              <div class="refine-compare-col refine-col-refined">
                <div class="refine-compare-label">
                  教研修缮
                  <a-tag v-if="!isRefineFieldEqual(handoff?.knowledgeAnalysis?.formulaHints, refineResult?.handoff?.knowledgeAnalysis?.formulaHints)" color="green" size="small" style="margin-left: 6px">已优化</a-tag>
                </div>
                <pre class="refine-compare-content">{{ formatRefineField(refineResult?.handoff?.knowledgeAnalysis?.formulaHints) }}</pre>
              </div>
            </div>
          </a-descriptions-item>
          <a-descriptions-item label="常见错误">
            <div class="refine-compare-row">
              <div class="refine-compare-col refine-col-original">
                <div class="refine-compare-label">
                  机筛原文
                </div>
                <pre class="refine-compare-content">{{ formatRefineField(handoff?.commonMistakes) }}</pre>
              </div>
              <div class="refine-compare-col refine-col-refined">
                <div class="refine-compare-label">
                  教研修缮
                  <a-tag v-if="!isRefineFieldEqual(handoff?.commonMistakes, refineResult?.handoff?.commonMistakes)" color="green" size="small" style="margin-left: 6px">已优化</a-tag>
                </div>
                <pre class="refine-compare-content">{{ formatRefineField(refineResult?.handoff?.commonMistakes) }}</pre>
              </div>
            </div>
          </a-descriptions-item>
        </a-descriptions>
      </div>
      <div class="refine-modal-footer">
        <a-space>
          <a-button @click="keepOriginalRefine">
            保留原文
          </a-button>
          <a-button
            type="primary"
            @click="applyRefine"
          >
            应用修缮
          </a-button>
        </a-space>
      </div>
    </a-modal>

    <!-- 提示词编辑弹窗 -->
    <a-modal
      v-model:open="promptEditOpen"
      title="提示词设置"
      :width="720"
      @ok="promptEditOpen = false"
    >
      <a-divider orientation="left">
        讲解风格
      </a-divider>
      <a-typography-paragraph type="secondary" style="font-size: 12px;">
        选择不同的讲解风格 Skill，决定老师的人设、讲解节奏和内容侧重。
      </a-typography-paragraph>
      <a-select
        v-model:value="selectedSkillId"
        style="width: 100%;"
        :disabled="state === 'generating'"
      >
        <a-select-option
          v-for="skill in skillList"
          :key="skill.id"
          :value="skill.id"
        >
          {{ skill.name }}
          <template v-if="skill.description">
            <a-typography-text type="secondary" style="font-size: 12px; display: block;">
              {{ skill.description }}
            </a-typography-text>
          </template>
        </a-select-option>
      </a-select>

      <a-divider orientation="left">
        自定义 System Prompt
      </a-divider>
      <a-typography-paragraph type="secondary" style="font-size: 12px;">
        留空使用上方选中的 Skill 默认 Prompt；粘贴自定义 Prompt 后，点击生成即生效（优先级高于 Skill）。
      </a-typography-paragraph>
      <a-textarea
        v-model:value="customSystemPrompt"
        :rows="16"
        placeholder="留空使用默认 System Prompt"
        :disabled="state === 'generating'"
      />
      <div style="margin-top: 8px; display: flex; justify-content: space-between; align-items: center;">
        <a-typography-text type="secondary" style="font-size: 12px;">
          {{ customSystemPrompt.length }} 字 · 当前使用：{{ currentSkillName }}
        </a-typography-text>
        <a-space>
          <a-button size="small" :disabled="!customSystemPrompt" @click="customSystemPrompt = ''">
            清空自定义
          </a-button>
        </a-space>
      </div>
    </a-modal>

    <!-- 产物单页生成成功弹窗 -->
    <a-modal
      v-model:open="deliverableModalOpen"
      title="🎉 教学视频素材参数产物单页已生成"
      :width="620"
      :footer="null"
    >
      <div class="deliverable-modal-body">
        <a-result
          status="success"
          title="参数已固化为最终交付单页"
          :sub-title="`已归档至 public/deliverable/ · HTML 落地实体页面与 JSON 规格成对生成`"
        >
          <template #extra>
            <a-space size="middle" wrap>
              <a-button type="primary" size="large" class="btn-modal-open-deliverable" @click="openDeliverablePage">
                <template #icon><EyeOutlined /></template>
                立即打开 HTML 产物单页
              </a-button>
              <a-button size="large" @click="downloadDeliverableJson">
                <template #icon><DownloadOutlined /></template>
                下载配套 JSON 文件
              </a-button>
              <a-button size="large" @click="deliverableModalOpen = false">
                留在当前页面
              </a-button>
            </a-space>
          </template>
        </a-result>
        <div class="deliverable-modal-meta">
          <div class="meta-item">
            <span class="meta-label">交付项目编号:</span>
            <span class="meta-value code-font">{{ deliverableResult?.projectCode }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">实体 HTML 页面:</span>
            <span class="meta-value text-emerald font-mono">public/deliverable/deliverable-{{ deliverableResult?.projectCode }}.html</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">配套 JSON 文件:</span>
            <span class="meta-value text-slate font-mono">public/deliverable/deliverable-{{ deliverableResult?.projectCode }}.json</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">真画布规格:</span>
            <span class="meta-value">1726 × 980 (16:9 标准比例锁定)</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">已固化时序:</span>
            <span class="meta-value">{{ rows.length }} 步 (含五字段完整时序、纯净口播与动作规范)</span>
          </div>
        </div>
      </div>
    </a-modal>
  </a-layout>
</template>

<style scoped>
/* 页面工作台自适应放宽，保证演播室表格宽阔舒展 */
:deep(.qh-page-content) {
  max-width: 1480px;
  padding-left: 24px;
  padding-right: 24px;
}

/* 题目卡片高雅微质感 */
.studio-problem-card {
  background: #ffffff;
  border-radius: 12px;
  border: 1px solid #e8edf5;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.03);
  overflow: hidden;
}

.problem-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid #f1f5f9;
}

.problem-card-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.problem-card-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
}

.problem-card-title {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
}

.problem-type-pill {
  font-size: 12px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 100px;
  background: #eff6ff;
  color: #2563eb;
  border: 1px solid #dbeafe;
}

.grade-pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 100px;
  background: #f8fafc;
  color: #64748b;
  border: 1px solid #e2e8f0;
}

.problem-char-stat {
  font-size: 12px;
  color: #94a3b8;
}

.problem-text-content {
  font-size: 14px;
  line-height: 1.75;
  color: #334155;
  background: #f8fafc;
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid #f1f5f9;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 主工作台卡片 */
.studio-workbench-card {
  border-radius: 14px;
  border: 1px solid #e8edf5;
  box-shadow: 0 4px 20px rgba(15, 23, 42, 0.04);
  background: #ffffff;
  margin-top: 4px;
}

.workbench-title-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 12px;
}

.workbench-title-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.workbench-main-title {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.01em;
}

.workbench-tag {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 6px;
}

.tag-type {
  background: #eff6ff;
  color: #2563eb;
  border: 1px solid #dbeafe;
}

.tag-skill {
  background: #faf5ff;
  color: #7c3aed;
  border: 1px solid #f3e8ff;
}

.tag-model {
  background: #f0fdf4;
  color: #16a34a;
  border: 1px solid #dcfce7;
}

.tag-rows {
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #e2e8f0;
}

.workbench-stat-pill {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  font-weight: 500;
  color: #0369a1;
  background: #f0f9ff;
  border: 1px solid #e0f2fe;
  padding: 3px 10px;
  border-radius: 100px;
}

/* 操作栏分组 */
.studio-actions-container {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.action-btn-group {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #f8fafc;
  padding: 3px 6px;
  border-radius: 8px;
  border: 1px solid #edf2f7;
}

/* ASR 兜底暖金按钮 */
.btn-asr-fallback {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%) !important;
  border: none !important;
  box-shadow: 0 2px 6px rgba(217, 119, 6, 0.28) !important;
  font-weight: 500 !important;
  color: #ffffff !important;
  transition: all 0.2s ease !important;
}

.btn-asr-fallback:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(217, 119, 6, 0.36) !important;
}

.btn-check-agent {
  border-color: #cbd5e1;
  color: #334155;
  transition: all 0.2s ease;
}

.btn-check-agent:hover:not(:disabled) {
  border-color: #16a34a;
  color: #16a34a;
}

.btn-revert {
  border-color: #cbd5e1;
  color: #64748b;
}

.btn-export-dropdown {
  border-color: #cbd5e1;
  color: #334155;
}

.btn-settings {
  border-color: #cbd5e1;
  color: #475569;
}

/* 主生成按钮 */
.btn-main-generate {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%) !important;
  border: none !important;
  font-weight: 600 !important;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3) !important;
  transition: all 0.2s ease !important;
}

.btn-main-generate:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4) !important;
}

/* 画布与演播室参数面板 */
.studio-params-panel {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 14px;
}

.params-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.params-panel-title {
  font-size: 12px;
  font-weight: 700;
  color: #334155;
}

.params-panel-hint {
  font-size: 11px;
  color: #94a3b8;
}

.params-panel-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.param-control-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 6px;
  background: transparent;
  border: 1px solid transparent;
  transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}

.param-control-item:hover {
  background: #ffffff;
  border-color: #e2e8f0;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.05);
  transform: translateY(-1px);
}

.param-control-item:hover .param-label {
  color: #1e293b;
}

.param-label {
  font-size: 11px;
  color: #64748b;
  font-weight: 500;
  white-space: nowrap;
  transition: color 0.2s ease;
}

.param-coord-pill {
  font-size: 11px;
  color: #0284c7;
  background: #e0f2fe;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}

/* 空状态 */
.workbench-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 20px;
  text-align: center;
  background: #fbfcfe;
  border: 1px dashed #cbd5e1;
  border-radius: 12px;
  margin: 12px 0;
}

.empty-icon-box {
  font-size: 36px;
  margin-bottom: 12px;
  opacity: 0.85;
}

.empty-text-title {
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 6px;
}

.empty-text-sub {
  font-size: 13px;
  color: #64748b;
  max-width: 460px;
  line-height: 1.6;
  margin-bottom: 18px;
}

.btn-empty-generate {
  height: 40px;
  padding: 0 24px;
  border-radius: 8px;
  font-weight: 600;
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  border: none;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
}

/* 列空间合理分配与自由折叠工具条（夏夏专属） */
.studio-col-layout-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 6px 12px;
  margin-bottom: 10px;
}

.col-layout-left,
.col-layout-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.col-layout-label,
.col-layout-sublabel {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
}

.preset-btn-group {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: #edf2f7;
  padding: 2px;
  border-radius: 6px;
}

.preset-btn {
  border: none;
  background: transparent;
  padding: 3px 9px;
  font-size: 11px;
  font-weight: 500;
  color: #475569;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.preset-btn:hover {
  color: #1e293b;
  background: rgba(255, 255, 255, 0.6);
}

.preset-btn.active {
  background: #ffffff;
  color: #2563eb;
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

.col-toggle-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  border-radius: 100px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  cursor: pointer;
  transition: all 0.18s ease;
}

.col-toggle-chip:hover {
  border-color: #3b82f6;
  color: #2563eb;
}

.col-toggle-chip.collapsed {
  background: #f1f5f9;
  border-color: #e2e8f0;
  color: #94a3b8;
}

.chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22c55e;
  transition: background 0.2s ease;
}

.chip-dot.off {
  background: #cbd5e1;
}

/* 表头折叠切换按钮 */
.col-header-flex {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
}

.col-header-flex.center {
  justify-content: center;
}

.col-fold-trigger {
  border: none;
  background: #e2e8f0;
  color: #475569;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.18s ease;
  white-space: nowrap;
}

.col-fold-trigger:hover {
  background: #2563eb;
  color: #ffffff;
}

/* 折叠态单元格小卡片 */
.collapsed-cell-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 8px 4px;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}

.collapsed-cell-card:hover {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1d4ed8;
}

.collapsed-cell-card .collapsed-icon {
  font-size: 14px;
}

.collapsed-cell-card .collapsed-text {
  font-size: 11px;
  font-weight: 600;
  color: #475569;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 64px;
}

.collapsed-cell-card .collapsed-tip {
  font-size: 9px;
  color: #3b82f6;
  opacity: 0.8;
}

/* 动作列折叠态 */
.collapsed-action-wrap {
  display: flex;
  justify-content: center;
  align-items: center;
}

.collapsed-action-pill {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
  border-radius: 12px;
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.collapsed-action-pill:hover {
  background: #dbeafe;
  transform: scale(1.05);
}

.action-empty-dash {
  color: #cbd5e1;
  font-size: 13px;
}

/* 针对演播室表格滑动条的微质感轻量化设置 */
.studio-table :deep(.ant-table-body),
.studio-table :deep(.ant-table-content),
.studio-table :deep(.ant-table-scroll) {
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.16) transparent;
}

.studio-table :deep(.ant-table-body)::-webkit-scrollbar,
.studio-table :deep(.ant-table-content)::-webkit-scrollbar,
.studio-table :deep(.ant-table-scroll)::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}

.studio-table :deep(.ant-table-body)::-webkit-scrollbar-track,
.studio-table :deep(.ant-table-content)::-webkit-scrollbar-track,
.studio-table :deep(.ant-table-scroll)::-webkit-scrollbar-track {
  background: transparent;
}

.studio-table :deep(.ant-table-body)::-webkit-scrollbar-thumb,
.studio-table :deep(.ant-table-content)::-webkit-scrollbar-thumb,
.studio-table :deep(.ant-table-scroll)::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.16);
  border-radius: 999px;
}

.studio-table :deep(.ant-table-body)::-webkit-scrollbar-thumb:hover,
.studio-table :deep(.ant-table-content)::-webkit-scrollbar-thumb:hover,
.studio-table :deep(.ant-table-scroll)::-webkit-scrollbar-thumb:hover {
  background: rgba(100, 116, 139, 0.32);
}

/* 五字段表格美化 */
.studio-table {
  border-radius: 8px;
  overflow: hidden;
}

.studio-table :deep(.ant-table-thead > tr > th) {
  background: #f8fafc;
  color: #334155;
  font-size: 12px;
  font-weight: 700;
  padding: 10px 12px;
  border-bottom: 1px solid #e2e8f0;
}

.studio-table :deep(.ant-table-tbody > tr) {
  transition: all 0.24s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.studio-table :deep(.ant-table-tbody > tr > td) {
  padding: 9px 11px;
  border-bottom: 1px solid #edf2f7;
  vertical-align: top;
  background: #ffffff;
  transition: background-color 0.24s cubic-bezier(0.4, 0, 0.2, 1),
              box-shadow 0.24s cubic-bezier(0.4, 0, 0.2, 1),
              border-color 0.24s cubic-bezier(0.4, 0, 0.2, 1);
}

.studio-table :deep(.ant-table-tbody > tr:hover > td) {
  background: #f8fbff !important;
  border-bottom-color: #dbeafe;
}

.studio-table :deep(.ant-table-tbody > tr:hover > td:first-child) {
  box-shadow: inset 3px 0 0 0 #2563eb;
}

.studio-table :deep(.ant-table-tbody > tr:hover .studio-row-badge) {
  background: #dbeafe;
  color: #1d4ed8;
  transform: scale(1.08);
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.2);
}

.studio-table :deep(.ant-table-tbody > tr:hover .speech-textarea-card) {
  border-color: #cbd5e1;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.05);
}

.studio-table :deep(.ant-table-tbody > tr:hover .board-card-view) {
  border-color: #cbd5e1;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.05);
}

/* 序号徽章与拖拽手柄 */
.cell-index-box {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 3px;
  padding-top: 3px;
}

.index-badge-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.row-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 22px;
  border-radius: 4px;
  color: #94a3b8;
  cursor: grab;
  font-size: 13px;
  transition: all 0.15s ease;
  user-select: none;
}

.row-drag-handle:hover {
  color: #1677ff;
  background: #eff6ff;
}

.row-drag-handle:active {
  cursor: grabbing;
}

.row-timeline-pill {
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: #0284c7;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 100px;
  padding: 1px 6px;
  line-height: 1.2;
  white-space: nowrap;
}

/* 表格行拖拽交互样式 */
.studio-table :deep(.table-row-dragging td) {
  opacity: 0.45 !important;
  background-color: #f1f5f9 !important;
}

.studio-table :deep(.table-row-dragover-top td) {
  border-top: 3px solid #1677ff !important;
  background-color: #f0f7ff !important;
}

.studio-table :deep(.table-row-dragover-bottom td) {
  border-bottom: 3px solid #1677ff !important;
  background-color: #f0f7ff !important;
}

.studio-row-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
  background: #f1f5f9;
  color: #475569;
  transition: all 0.24s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 教学环节胶囊 */
.cell-stage-box {
  display: flex;
  justify-content: center;
  align-items: center;
  padding-top: 4px;
}

.stage-capsule {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 100px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}

.stage-capsule-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.stage-题目 {
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
}
.stage-题目 .stage-capsule-dot {
  background: #3b82f6;
}

.stage-分析 {
  background: #fff7ed;
  color: #c2410c;
  border: 1px solid #fed7aa;
}
.stage-分析 .stage-capsule-dot {
  background: #f97316;
}

.stage-解答 {
  background: #f0fdf4;
  color: #15803d;
  border: 1px solid #bbf7d0;
}
.stage-解答 .stage-capsule-dot {
  background: #22c55e;
}

.stage-总结 {
  background: #faf5ff;
  color: #7e22ce;
  border: 1px solid #e9d5ff;
}
.stage-总结 .stage-capsule-dot {
  background: #a855f7;
}

.stage-capsule:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
}

.stage-picker-title {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  margin-bottom: 4px;
  padding: 0 4px;
}

.stage-picker-btn {
  text-align: left;
  justify-content: flex-start;
  width: 100%;
}

/* 口播稿单元格 */
.speech-textarea-card {
  position: relative;
  background: #ffffff;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  transition: all 0.2s ease;
}

.speech-textarea-card:focus-within {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
}

.studio-speech-input {
  border: none !important;
  box-shadow: none !important;
  padding: 8px 10px 4px !important;
  font-size: 13px !important;
  line-height: 1.65 !important;
  color: #1e293b !important;
  resize: none !important;
}

.speech-stat-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  padding: 2px 8px 5px;
  font-size: 11px;
  color: #94a3b8;
}

.speech-stat-chars {
  font-weight: 500;
}

.speech-stat-divider {
  opacity: 0.6;
}

.speech-stat-time {
  color: #64748b;
}

/* 板书内容单元格 */
.board-card-view {
  background: #fbfcfe;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  padding: 6px 10px;
  min-height: 48px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.board-card-view:hover {
  background: #f8fafc;
  border-color: #3b82f6;
  border-style: solid;
  box-shadow: 0 2px 6px rgba(59, 130, 246, 0.08);
}

.board-card-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.board-tags-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.board-coord-tag {
  font-family: monospace;
  font-size: 10px;
  font-weight: 600;
  color: #0284c7;
  background: #e0f2fe;
  padding: 1px 6px;
  border-radius: 4px;
}

.board-coord-tag.empty {
  color: #94a3b8;
  background: #f1f5f9;
}

.board-delay-tag {
  font-family: monospace;
  font-size: 10px;
  font-weight: 600;
  color: #7c3aed;
  background: #f3e8ff;
  padding: 1px 6px;
  border-radius: 4px;
}

.board-edit-hint {
  font-size: 10px;
  color: #94a3b8;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.board-card-view:hover .board-edit-hint {
  opacity: 1;
  color: #3b82f6;
}

.board-math-render {
  font-size: 13px;
  line-height: 1.6;
  color: #1e293b;
  white-space: pre-wrap;
  word-break: break-word;
}

.board-empty-hint {
  font-size: 12px;
  color: #94a3b8;
  font-style: italic;
}

/* 板书编辑状态 */
.board-card-edit {
  background: #ffffff;
  border: 1px solid #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
  border-radius: 8px;
  padding: 8px;
}

.board-edit-grid {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 4px;
}

.board-edit-label {
  font-size: 10px;
  font-weight: 600;
  color: #64748b;
  margin-bottom: 2px;
}

.board-coord-input {
  font-family: monospace;
  font-size: 11px;
}

.board-content-input {
  font-size: 12px;
  line-height: 1.5;
}

.board-edit-actions {
  margin-top: 6px;
  text-align: right;
}

.board-done-btn {
  font-size: 11px;
  height: 24px;
  padding: 0 10px;
}

/* 板书动作胶囊 */
.cell-action-box {
  display: flex;
  justify-content: center;
  align-items: center;
  padding-top: 4px;
}

.action-badge-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  padding: 3px 8px;
  border-radius: 100px;
  background: #f0f9ff;
  color: #0284c7;
  border: 1px solid #bae6fd;
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-badge-pill:hover {
  background: #e0f2fe;
  border-color: #7dd3fc;
  transform: translateY(-1px);
}

.action-badge-icon {
  font-size: 10px;
}

.action-empty-dash {
  color: #cbd5e1;
  font-size: 12px;
}

.action-popover-title {
  font-size: 12px;
  font-weight: 700;
  color: #1e293b;
  padding-bottom: 6px;
  margin-bottom: 6px;
  border-bottom: 1px solid #f1f5f9;
}

.action-popover-content {
  font-size: 12px;
  color: #475569;
  line-height: 1.5;
}

/* 操作列按钮 */
.cell-ops-box {
  display: flex;
  justify-content: center;
  align-items: center;
  padding-top: 4px;
}

.btn-op-move {
  color: #64748b;
  width: 22px;
  height: 22px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.btn-op-move:hover:not(:disabled) {
  color: #1677ff !important;
  background: #eff6ff !important;
}

.btn-op-move:disabled {
  color: #cbd5e1 !important;
  cursor: not-allowed;
}

.btn-op-add {
  background: #f0fdf4 !important;
  color: #16a34a !important;
  border: 1px solid #bbf7d0 !important;
  box-shadow: none !important;
}

.btn-op-add:hover {
  background: #16a34a !important;
  color: #ffffff !important;
}

.btn-op-del {
  color: #94a3b8;
  transition: color 0.15s ease;
}

.btn-op-del:hover {
  color: #ef4444 !important;
  background: #fef2f2 !important;
}

/* KaTeX 渲染优化 */
.board-math-render :deep(.katex) {
  font-size: 1.1em;
}

.board-math-render :deep(.katex-display) {
  margin: 4px 0;
}

.knowledge-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 11px;
}

.knowledge-chip {
  margin: 0;
  padding: 3px 11px;
  border-radius: 999px;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.knowledge-chip:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(22, 119, 255, 0.16);
}

.knowledge-detail-table :deep(.ant-descriptions-item-label) {
  width: 132px;
  color: #49627c;
  background: #f6faff;
}

.qh-check-empty {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 22px 4px;
  color: #1677ff;
  font-size: 20px;
}

.qh-check-empty p {
  margin: 4px 0 0;
  color: #666;
  font-size: 12px;
}

.qh-check-change {
  width: 100%;
}

.qh-check-diff {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  margin-top: 10px;
}

.qh-check-diff > div {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid #e8e8e8;
  border-radius: 6px;
  background: #fafafa;
}

.qh-check-diff > div:last-child {
  border-color: #b7ebc6;
  background: #f6ffed;
}

.qh-check-diff span {
  color: #8c8c8c;
  font-size: 11px;
}

.qh-check-diff p {
  margin: 5px 0 0;
  color: #262626;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

@media (max-width: 720px) {
  .qh-check-diff {
    grid-template-columns: 1fr;
  }
}

.refine-compare-row {
  display: flex;
  gap: 12px;
}
.refine-compare-col {
  flex: 1;
  min-width: 0;
}
.refine-compare-label {
  font-size: 12px;
  color: #8c8c8c;
  margin-bottom: 4px;
}
.refine-col-original .refine-compare-label {
  color: #8c8c8c;
}
.refine-col-refined .refine-compare-label {
  color: #52c41a;
  font-weight: 500;
}
.refine-col-original .refine-compare-content {
  background: #fafafa;
  border: 1px solid #f0f0f0;
}
.refine-col-refined .refine-compare-content {
  background: #f6ffed;
  border: 1px solid #b7eb8f;
}
.refine-compare-content {
  padding: 8px 10px;
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  max-height: 200px;
  overflow-y: auto;
}
.refine-modal-footer {
  text-align: right;
  margin-top: 16px;
}

/* 参数表与交接台高质感排版 */
.handoff-workbench-card {
  border-radius: 12px !important;
  border: 1px solid #e2e8f0 !important;
  box-shadow: 0 4px 16px -2px rgba(15, 23, 42, 0.04) !important;
  overflow: hidden;
  background: #ffffff !important;
}

.handoff-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.handoff-title-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  font-size: 13px;
  background: #f1f5f9;
  border-radius: 6px;
}

.handoff-title-text {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.01em;
}

.handoff-title-sub {
  font-size: 11px;
  font-weight: 400;
  color: #64748b;
  margin-left: 2px;
}

.btn-refine-confirm {
  border-radius: 6px !important;
  font-weight: 500 !important;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.18) !important;
  transition: all 0.2s ease !important;
}
.btn-refine-confirm:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(37, 99, 235, 0.25) !important;
}

.handoff-summary-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: #f8fafc;
  border: 1px solid #f1f5f9;
  border-radius: 8px;
  margin-bottom: 8px;
}

.handoff-summary-label {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  white-space: nowrap;
}

.handoff-stats-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.handoff-stat-tag {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  padding: 2px 8px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  color: #475569;
  font-weight: 500;
}

.qh-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: #1e293b;
  margin: 14px 0 6px;
  letter-spacing: 0.01em;
}

.qh-section-title::before {
  content: '';
  display: inline-block;
  width: 3px;
  height: 12px;
  background: #3b82f6;
  border-radius: 2px;
}

.qh-section-title:first-of-type {
  margin-top: 2px;
}

/* 参数表描述列表样式穿透与质感微调 */
:deep(.handoff-descriptions.ant-descriptions-bordered) {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #e8edf5;
}

:deep(.handoff-descriptions .ant-descriptions-row) {
  transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}

:deep(.handoff-descriptions .ant-descriptions-item-label) {
  background: #f8fafc !important;
  color: #475569 !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  padding: 7px 12px !important;
  border-color: #f1f5f9 !important;
  width: 96px !important;
  min-width: 96px !important;
  transition: background-color 0.22s cubic-bezier(0.4, 0, 0.2, 1),
              color 0.22s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

:deep(.handoff-descriptions .ant-descriptions-item-content) {
  background: #ffffff !important;
  padding: 7px 12px !important;
  border-color: #f1f5f9 !important;
  word-break: break-word !important;
  overflow-wrap: anywhere !important;
  transition: background-color 0.22s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

/* 参数表表格行 hover 提升感 */
:deep(.handoff-descriptions .ant-descriptions-row:hover .ant-descriptions-item-label) {
  background: #f1f5f9 !important;
  color: #0f172a !important;
}

:deep(.handoff-descriptions .ant-descriptions-row:hover .ant-descriptions-item-content) {
  background: #fafcff !important;
}

:deep(.handoff-descriptions .ant-descriptions-row:hover .qh-field-key) {
  background: #e2e8f0;
  border-color: #cbd5e1;
  color: #1e293b;
  opacity: 1;
}

:deep(.handoff-descriptions .ant-descriptions-row:hover .canvas-param-chip),
:deep(.handoff-descriptions .ant-descriptions-row:hover .zone-param-chip) {
  background: #ffffff;
  border-color: #cbd5e1;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.05);
}

/* 单元格大字与小小字布局容器 */
.field-val-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  width: 100%;
}

.field-val-box.wrap-box {
  align-items: flex-start;
  flex-wrap: wrap;
}

.field-val-main {
  font-size: 12.5px;
  color: #0f172a;
  line-height: 1.5;
  min-width: 0;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.field-val-main.font-medium {
  font-weight: 600;
  color: #1e293b;
}

.field-val-main.text-secondary {
  color: #64748b;
  font-size: 12px;
}

/* 小小字段名徽标（优雅的微徽标，不撑爆表格） */
.qh-field-key {
  display: inline-flex;
  align-items: center;
  font-size: 9.5px;
  line-height: 14px;
  height: 16px;
  color: #64748b;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 0 5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  letter-spacing: 0.01em;
  white-space: nowrap;
  flex-shrink: 0;
  opacity: 0.85;
  user-select: all;
  transition: all 0.15s ease;
}

.qh-field-key:hover {
  background: #e2e8f0;
  color: #334155;
  border-color: #cbd5e1;
  opacity: 1;
}

/* 画布参数结构化展示芯片 */
.canvas-params-desc-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  flex-wrap: wrap;
}

.canvas-params-chips-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.canvas-param-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  padding: 2px 7px;
  background: #f8fafc;
  border: 1px solid #e8edf5;
  border-radius: 6px;
  color: #334155;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: default;
}

.canvas-param-chip:hover {
  background: #ffffff;
  border-color: #3b82f6;
  box-shadow: 0 2px 6px rgba(59, 130, 246, 0.12);
  transform: translateY(-1px);
}

.canvas-param-chip .chip-k {
  color: #64748b;
  font-size: 10.5px;
}

.canvas-param-chip .chip-v {
  font-weight: 600;
  color: #0f172a;
}

/* 四区参数网格 */
.zone-tags-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  width: 100%;
}

.zone-param-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 11.5px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: default;
}

.zone-param-chip:hover {
  background: #ffffff;
  border-color: #2563eb;
  box-shadow: 0 2px 6px rgba(37, 99, 235, 0.12);
  transform: translateY(-1px);
}

.zone-chip-label {
  color: #2563eb;
  font-weight: 600;
}

.zone-chip-val {
  color: #475569;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}

/* 题型配比进度胶囊 */
.ratio-bars-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.ratio-pill {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: 600;
}

.ratio-pill.analysis {
  background: #fff1f0;
  color: #cf1322;
  border: 1px solid #ffa39e;
}

.ratio-pill.solution {
  background: #e6f4ff;
  color: #0958d9;
  border: 1px solid #91caff;
}

.ratio-pill.summary {
  background: #f6ffed;
  color: #389e0d;
  border: 1px solid #b7eb8f;
}

.ratio-pill.intro {
  background: #f5f5f5;
  color: #595959;
  border: 1px solid #d9d9d9;
}

.meta-path-val {
  font-size: 11.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #2563eb;
  word-break: break-all;
}

.param-empty-text {
  font-size: 11.5px;
  color: #94a3b8;
  font-style: italic;
}

.handoff-usage-note {
  font-size: 12px;
  color: #64748b;
  line-height: 1.6;
}

.knowledge-point-tag {
  border-radius: 4px;
  font-size: 11.5px;
  padding: 1px 7px;
}

.formula-tag {
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  padding: 1px 7px;
}

/* 最终交付产物单页按钮样式 */
.group-deliverable {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-generate-deliverable {
  background: linear-gradient(135deg, #059669 0%, #10b981 100%) !important;
  border-color: #059669 !important;
  color: #ffffff !important;
  font-weight: 600 !important;
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.28) !important;
  transition: all 0.2s ease !important;
}

.btn-generate-deliverable:hover:not(:disabled) {
  background: linear-gradient(135deg, #047857 0%, #059669 100%) !important;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4) !important;
  transform: translateY(-1px);
}

.btn-generate-deliverable:disabled {
  opacity: 0.6 !important;
  box-shadow: none !important;
}

.btn-view-deliverable {
  border-color: #10b981 !important;
  color: #059669 !important;
  background: #f0fdf4 !important;
  font-weight: 500;
}

.btn-view-deliverable:hover {
  border-color: #059669 !important;
  color: #047857 !important;
  background: #dcfce7 !important;
}

/* 夏夏简易版播放器按钮 */
.group-lite-player {
  display: flex;
  align-items: center;
}

.btn-open-lite-player {
  background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%) !important;
  border-color: #4f46e5 !important;
  color: #ffffff !important;
  font-weight: 600 !important;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.28) !important;
  transition: all 0.2s ease !important;
}

.btn-open-lite-player:hover:not(:disabled) {
  background: linear-gradient(135deg, #4338ca 0%, #2563eb 100%) !important;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4) !important;
  transform: translateY(-1px);
}

.btn-open-lite-player:disabled {
  opacity: 0.55 !important;
  box-shadow: none !important;
}

/* 产物单页弹窗内容 */
.deliverable-modal-body {
  padding: 8px 0;
}

.btn-modal-open-deliverable {
  background: linear-gradient(135deg, #059669 0%, #10b981 100%) !important;
  border-color: #059669 !important;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3) !important;
}

.deliverable-modal-meta {
  margin-top: 20px;
  padding: 16px;
  background: #f8fafc;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.meta-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
}

.meta-label {
  color: #64748b;
}

.meta-value {
  color: #0f172a;
  font-weight: 500;
}

.meta-value.code-font {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #2563eb;
  background: #eff6ff;
  padding: 2px 6px;
  border-radius: 4px;
}

.meta-value.text-emerald {
  color: #059669;
}
</style>
