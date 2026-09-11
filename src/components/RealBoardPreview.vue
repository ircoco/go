<script setup>
/* @qh-core LANE=SHARED POINT=TRUE_PREVIEW 1726x980 capture source */
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import BoardContentLayer from './BoardContentLayer.vue'
import {
  CANVAS_W as DESIGN_W,
  CANVAS_H as DESIGN_H,
  TABLE_REF_W,
  TABLE_REF_H,
} from '../utils/canvasCoords'
import { createBoardToolRuntime } from '../board-tools/boardToolCatalog.js'

const props = defineProps({
  canvasImageUrl: { type: String, default: '/canvas.png' },
  problemText: { type: String, default: '' },
  /** 完整规划：四标签+区+题目；没有则只显示题目标签/题文默认位 */
  boardPlan: { type: Object, default: null },
  /** 兼容只传 topicLayout */
  topicLayout: { type: Object, default: null },
  showGrid: { type: Boolean, default: false },
  showAllLabels: { type: Boolean, default: false },
  showZoneGuides: { type: Boolean, default: false },
  interactive: { type: Boolean, default: true },
  sourceImageUrl: { type: String, default: '' },
  keepOriginal: { type: Boolean, default: false },
  /** Agent B 输出的动作数组，自动在 L3 层播放 */
  actionSpec: { type: Array, default: () => [] },
  /** 是否自动播放 actionSpec，默认 true */
  autoPlay: { type: Boolean, default: true },
})

const emit = defineEmits(['pick-coord', 'topic-measured'])
const hover = ref(null)
const boardRef = ref(null)
const roughSvgRef = ref(null)
let runtime = null

function resolveCanvas() {
  return roughSvgRef.value
}

function resolveRegion(region) {
  if (!boardRef.value) return null
  return boardRef.value.querySelector(`[data-board-region="${region}"]`)
}

function resolveRegionBounds(region) {
  const zone = props.boardPlan?.[region]
  if (!zone) return null
  return {
    x: (zone.x / 100) * DESIGN_W,
    y: (zone.y / 100) * DESIGN_H,
    width: (zone.w / 100) * DESIGN_W,
    height: (zone.h / 100) * DESIGN_H,
  }
}

function initRuntime() {
  if (runtime) return
  runtime = createBoardToolRuntime({
    resolveCanvas,
    resolveRegion,
    resolveRegionBounds,
    boardPlan: props.boardPlan,
  })
}

function normalizeActionSpecItem(item) {
  // B 输出格式：{ action: { tool, order, ... } } 或 { capabilityGap: {...} }
  // 代码期望格式：{ tool, order, ... }
  if (item?.capabilityGap) return null
  if (item?.action && typeof item.action === 'object') {
    return { ...item.action }
  }
  return item
}

function playActionSpec() {
  if (!runtime || !props.autoPlay) return
  runtime.clear()
  if (props.actionSpec?.length) {
    const normalized = props.actionSpec
      .map(normalizeActionSpecItem)
      .filter(Boolean)
    if (normalized.length) {
      runtime.enqueueAll(normalized)
    }
  }
}

onMounted(() => nextTick(() => {
  initRuntime()
  playActionSpec()
}))

watch(() => props.actionSpec, () => {
  nextTick(playActionSpec)
}, { deep: true })

onBeforeUnmount(() => {
  runtime?.clear()
  runtime = null
})

function onMove(e) {
  if (!props.interactive) return
  const rect = e.currentTarget.getBoundingClientRect()
  const xPct = ((e.clientX - rect.left) / rect.width) * 100
  const yPct = ((e.clientY - rect.top) / rect.height) * 100
  const px = Math.round((xPct / 100) * DESIGN_W)
  const py = Math.round((yPct / 100) * DESIGN_H)
  hover.value = {
    xPct: xPct.toFixed(1),
    yPct: yPct.toFixed(1),
    px,
    py,
    refX: Math.round((px / DESIGN_W) * TABLE_REF_W),
    refY: Math.round((py / DESIGN_H) * TABLE_REF_H),
  }
}
function onLeave() {
  hover.value = null
}
function onClick() {
  if (!props.interactive || !hover.value) return
  emit('pick-coord', { ...hover.value })
}
</script>

<template>
  <div class="real-board-wrap">
    <div
      ref="boardRef"
      class="board"
      :class="{ interactive }"
      data-board-canvas="true"
      :style="{ aspectRatio: `${DESIGN_W} / ${DESIGN_H}` }"
      @mousemove="onMove"
      @mouseleave="onLeave"
      @click="onClick"
    >
      <div class="board-layer board-layer-l1" data-board-layer="L1">
        <img class="board-paper" :src="canvasImageUrl" alt="甲方画布" draggable="false" />
      </div>

      <BoardContentLayer
        :problem-text="problemText"
        :board-plan="boardPlan"
        :topic-layout="topicLayout"
        :show-grid="showGrid"
        :show-all-labels="showAllLabels"
        :show-zone-guides="showZoneGuides"
        :source-image-url="sourceImageUrl"
        :keep-original="keepOriginal"
        @topic-measured="emit('topic-measured', $event)"
      />

      <!-- L3 生成内容播放层：Agent B 输出在这里播放 -->
      <div class="board-layer board-layer-l3" data-board-layer="L3">
        <svg
          ref="roughSvgRef"
          class="rough-drawing-layer"
          data-board-overlay="rough-drawings"
          :viewBox="`0 0 ${DESIGN_W} ${DESIGN_H}`"
          preserveAspectRatio="none"
          aria-hidden="true"
        />

        <div
          class="annotation-layer"
          data-board-overlay="annotations"
          aria-hidden="true"
        />
        <slot name="playback" />
      </div>

      <!-- L4 用户画笔层：只保留边界，交互由下一步 Agent C 实现 -->
      <div class="board-layer board-layer-l4" data-board-layer="L4" aria-hidden="true" />

      <div v-if="hover" class="hover-readout">
        画布({{ hover.px }},{{ hover.py }})px / ({{ hover.xPct }},{{ hover.yPct }})%
        · 表约({{ hover.refX }},{{ hover.refY }})
        <span class="hint">点击复制</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.real-board-wrap { width: 100%; }
.board {
  container-type: inline-size;
  position: relative;
  width: min(100%, var(--board-preview-max, 860px));
  aspect-ratio: 1726 / 980;
  margin: 0 auto;
  overflow: hidden;
  border: 1px solid #9ccfd9;
  background: transparent;
  box-shadow: 0 10px 28px rgba(24, 40, 42, 0.12);
  user-select: none;
}
.board.interactive { cursor: crosshair; }
.board-layer {
  position: absolute;
  inset: 0;
}
.board-layer-l1 { z-index: 0; background: #fff; pointer-events: none; }
.board-layer-l3 { z-index: 2; background: transparent; pointer-events: none; }
.board-layer-l4 { z-index: 3; background: transparent; pointer-events: none; }
.board-paper {
  position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none;
}
.rough-drawing-layer {
  position: absolute; inset: 0; z-index: 4; width: 100%; height: 100%;
  overflow: visible; pointer-events: none;
}
.annotation-layer {
  position: absolute; inset: 0; z-index: 5; pointer-events: none;
}
.hover-readout {
  position: absolute; z-index: 6; left: 8px; right: 8px; bottom: 8px;
  background: rgba(15,23,42,.88); color: #e2e8f0; font-size: 11px;
  padding: 6px 8px; border-radius: 8px; pointer-events: none;
}
.hover-readout .hint { float: right; color: #93c5fd; }
</style>
