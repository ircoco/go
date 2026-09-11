<script setup>
import { ArrowLeftOutlined } from '@ant-design/icons-vue'

defineProps({
  stepLabel: { type: String, required: true },
  subtitle: { type: String, required: true },
  showBack: { type: Boolean, default: false },
})

const emit = defineEmits(['back'])
</script>

<template>
  <a-layout-header class="qh-page-header">
    <div class="qh-brand">
      <a-button v-if="showBack" type="text" title="返回上一步" @click="emit('back')">
        <template #icon><ArrowLeftOutlined /></template>
      </a-button>
      <span class="qh-brand-mark">教学板书</span>
      <a-tag color="processing">{{ stepLabel }}</a-tag>
      <a-typography-text type="secondary">{{ subtitle }}</a-typography-text>
    </div>
    <a-space :size="8">
      <slot name="actions" />
    </a-space>
  </a-layout-header>
</template>
