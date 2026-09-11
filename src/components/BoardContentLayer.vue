<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  BOARD_LAYOUT,
  limitTopicImageHeightPct,
  pctBox,
} from '../utils/boardLayout'
import { renderProblemHtml } from '../utils/mathText'
import { buildGridLines } from '../utils/canvasCoords'

const props = defineProps({
  problemText: { type: String, default: '' },
  boardPlan: { type: Object, default: null },
  topicLayout: { type: Object, default: null },
  showGrid: { type: Boolean, default: false },
  showAllLabels: { type: Boolean, default: false },
  showZoneGuides: { type: Boolean, default: false },
  sourceImageUrl: { type: String, default: '' },
  keepOriginal: { type: Boolean, default: false },
})

const emit = defineEmits(['topic-measured'])
const layerRef = ref(null)
const topicContentRef = ref(null)
const grid = buildGridLines()
let topicObserver = null

const plan = computed(() => {
  if (props.boardPlan?.topicLabel || props.boardPlan?.question) return props.boardPlan
  return {
    topicLabel: props.topicLayout?.topicLabel || BOARD_LAYOUT.topicLabel,
    question: props.topicLayout?.question || BOARD_LAYOUT.question,
    image: props.topicLayout?.image || null,
    analysisLabel: BOARD_LAYOUT.analysisLabel,
    analysis: BOARD_LAYOUT.analysis,
    solutionLabel: BOARD_LAYOUT.solutionLabel,
    solution: BOARD_LAYOUT.solution,
    summaryLabel: BOARD_LAYOUT.summaryLabel,
    summary: BOARD_LAYOUT.summary,
  }
})

const problemHtml = computed(() => renderProblemHtml(props.problemText || ''))
const showExtraLabels = computed(() => props.showAllLabels || Boolean(props.boardPlan?.analysisLabel))
const topicImageMaxHeight = computed(() => limitTopicImageHeightPct(plan.value.image))

function measureTopic() {
  const layer = layerRef.value
  const topic = topicContentRef.value
  if (!layer || !topic) return

  const layerRect = layer.getBoundingClientRect()
  const topicRect = topic.getBoundingClientRect()
  if (!layerRect.height) return

  emit('topic-measured', {
    bottomPct: Number((((topicRect.bottom - layerRect.top) / layerRect.height) * 100).toFixed(2)),
    heightPct: Number(((topicRect.height / layerRect.height) * 100).toFixed(2)),
  })
}

function observeTopic() {
  topicObserver?.disconnect()
  topicObserver = null
  if (!topicContentRef.value) return

  topicObserver = new ResizeObserver(measureTopic)
  topicObserver.observe(topicContentRef.value)
  measureTopic()
}

onMounted(() => nextTick(observeTopic))
watch(
  () => [props.problemText, props.sourceImageUrl, props.keepOriginal, props.topicLayout, props.boardPlan],
  () => nextTick(observeTopic),
  { deep: true },
)
onBeforeUnmount(() => topicObserver?.disconnect())
</script>

<template>
  <div ref="layerRef" class="board-content-layer" data-board-layer="L2">
    <div v-if="problemText.trim() || showExtraLabels" class="board-item label" :style="pctBox(plan.topicLabel)">
      <img src="/topic.png" alt="题目" draggable="false" />
    </div>

    <div
      v-if="keepOriginal && sourceImageUrl && plan.image"
      ref="topicContentRef"
      class="board-item topic-image"
      :style="{ ...pctBox(plan.image), maxHeight: topicImageMaxHeight + '%' }"
    >
      <img :src="sourceImageUrl" alt="原题" draggable="false" @load="measureTopic" />
    </div>

    <div
      v-if="problemText.trim() && !(keepOriginal && sourceImageUrl)"
      ref="topicContentRef"
      class="board-item topic-text"
      data-board-region="question"
      data-typography="approved-printed-question"
      :style="{
        ...pctBox(plan.question),
        fontSize: `calc(${plan.question.fontSize || 30} * 1cqw / 17.26)`,
      }"
      v-html="problemHtml"
    />

    <template v-if="showExtraLabels">
      <div class="board-item label" :style="pctBox(plan.analysisLabel)">
        <img src="/analysis.png" alt="分析" draggable="false" />
      </div>
      <div class="board-item label" :style="pctBox(plan.solutionLabel)">
        <img src="/solution.png" alt="解答" draggable="false" />
      </div>
      <div class="board-item label" :style="pctBox(plan.summaryLabel)">
        <img src="/summary.png" alt="总结" draggable="false" />
      </div>
    </template>

    <template v-if="showZoneGuides && showExtraLabels">
      <div class="guide analysis" :style="pctBox(plan.analysis)" />
      <div class="guide solution" :style="pctBox(plan.solution)" />
      <div class="guide summary" :style="pctBox(plan.summary)" />
    </template>

    <div v-if="showGrid" class="grid-layer">
      <div v-for="g in grid.minor" :key="'vm'+g.p" class="grid-line v minor" :style="{ left: g.p + '%' }" />
      <div v-for="g in grid.major" :key="'vM'+g.p" class="grid-line v major" :style="{ left: g.p + '%' }">
        <span class="tick">{{ g.p }}</span>
      </div>
      <div v-for="g in grid.minor" :key="'hm'+g.p" class="grid-line h minor" :style="{ top: g.p + '%' }" />
      <div v-for="g in grid.major" :key="'hM'+g.p" class="grid-line h major" :style="{ top: g.p + '%' }">
        <span class="tick y">{{ g.p }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.board-content-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: transparent;
  pointer-events: none;
}
.board-item { position: absolute; z-index: 3; }
.label img { display: block; width: 100%; height: auto; pointer-events: none; }
.topic-image { overflow: hidden; z-index: 3; background: transparent; }
.topic-image img {
  display: block; width: 100%; max-height: 100%; object-fit: contain;
  object-position: left top;
  filter: grayscale(1) contrast(1.05); pointer-events: none;
}
.topic-text {
  z-index: 4; color: #1f1f1f; line-height: 1.65; white-space: pre-wrap; word-break: break-word;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; font-weight: 500;
}
.topic-text :deep(.katex) { font-size: 1.0em; }
.guide {
  position: absolute; z-index: 2; border: 1px dashed rgba(14,165,233,.35);
  background: transparent; border-radius: 8px; pointer-events: none;
}
.guide.solution { border-color: rgba(16,185,129,.35); }
.guide.summary { border-color: rgba(168,85,247,.35); }
.grid-layer { position: absolute; inset: 0; z-index: 5; pointer-events: none; }
.grid-line { position: absolute; }
.grid-line.v { top: 0; bottom: 0; width: 0; border-left: 1px solid rgba(15,23,42,.05); }
.grid-line.h { left: 0; right: 0; height: 0; border-top: 1px solid rgba(15,23,42,.05); }
.grid-line.major.v { border-left-color: rgba(22,119,255,.22); }
.grid-line.major.h { border-top-color: rgba(22,119,255,.22); }
.tick {
  position: absolute; top: 2px; left: 2px; font-size: 9px; color: #2563eb;
  background: rgba(255,255,255,.7); padding: 0 2px;
}
.tick.y { top: auto; }
</style>
