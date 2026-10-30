<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
const props = defineProps<{
  versions: { version: number; published_at: string; platform_limited?: boolean }[]
  selected?: number
  displayed?: number
  busy?: boolean
  more?: boolean
}>()
const emit = defineEmits<{ select: [version: number]; load: [] }>()
const start = ref(0),
  size = ref(7),
  rail = ref<HTMLElement>()
const ordered = computed(() => [...props.versions].sort((a, b) => a.version - b.version))
const nodes = computed(() => ordered.value.slice(start.value, start.value + size.value))
function locate() {
  const i = ordered.value.findIndex((v) => v.version === props.selected)
  if (i >= 0 && (i < start.value || i >= start.value + size.value))
    start.value = Math.floor(i / size.value) * size.value
  start.value = Math.max(0, Math.min(start.value, Math.max(0, ordered.value.length - size.value)))
}
watch(() => [props.selected, props.versions.length], locate, { immediate: true })
function resize() {
  size.value = window.matchMedia('(max-width: 767px)').matches ? 4 : 7
  locate()
}
onMounted(() => {
  resize()
  window.addEventListener('resize', resize)
})
onUnmounted(() => window.removeEventListener('resize', resize))
async function move(event: KeyboardEvent, version: number) {
  const index = ordered.value.findIndex((v) => v.version === version)
  let target = index
  if (event.key === 'ArrowRight') target = Math.min(ordered.value.length - 1, index + 1)
  else if (event.key === 'ArrowLeft') target = Math.max(0, index - 1)
  else if (event.key === 'Home') target = 0
  else if (event.key === 'End') target = ordered.value.length - 1
  else return
  event.preventDefault()
  const item = ordered.value[target]
  if (!item || props.busy) return
  start.value = Math.max(0, Math.min(target, ordered.value.length - size.value))
  await nextTick()
  rail.value?.querySelector<HTMLButtonElement>(`[data-version="${item.version}"]`)?.focus()
  emit('select', item.version)
}
function label(v: { version: number; published_at: string; platform_limited?: boolean }) {
  return `版本 ${v.version}，${new Date(v.published_at).toLocaleString('zh-CN')}${v.platform_limited ? '，受限' : ''}${v.version === props.displayed ? '，读者正在看' : ''}`
}
</script>
<template>
  <div class="version-rail">
    <p v-if="!ordered.length" class="fine">尚无可显示的发布记录。</p>
    <template v-else>
      <div class="rail-row">
        <button
          type="button"
          v-if="ordered.length > size"
          aria-label="更早的已加载版本"
          :disabled="busy || start === 0"
          @click="start = Math.max(0, start - size)"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="m14 6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </button>
        <div ref="rail" class="rail-nodes" role="group" aria-label="选择版本预览">
          <button
            v-for="(v, i) in nodes"
            :key="v.version"
            type="button"
            class="rail-node"
            :class="{
              'is-selected': v.version === selected,
              'is-displayed': v.version === displayed,
              'is-limited': v.platform_limited,
            }"
            :data-version="v.version"
            :aria-label="label(v)"
            :aria-pressed="v.version === selected"
            :tabindex="
              v.version === selected || (!nodes.some((n) => n.version === selected) && i === 0)
                ? 0
                : -1
            "
            :disabled="busy"
            @click="emit('select', v.version)"
            @keydown="move($event, v.version)"
          >
            <span class="rail-dot" />
          </button>
        </div>
        <button
          type="button"
          v-if="ordered.length > size"
          aria-label="更新的已加载版本"
          :disabled="busy || start + size >= ordered.length"
          @click="start = Math.min(ordered.length - size, start + size)"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="m10 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </button>
      </div>
      <div class="rail-legend">
        <span><i class="key-displayed" />读者正在看</span
        ><span><i class="key-preview" />当前预览</span
        ><button
          v-if="more"
          type="button"
          class="text-button"
          :disabled="busy"
          @click="emit('load')"
        >
          加载更早版本
        </button>
      </div>
    </template>
  </div>
</template>
<style scoped>
.version-rail {
  margin: 12px 0 0;
}
.rail-row {
  display: flex;
  gap: 4px;
  align-items: center;
}
.rail-row > button {
  width: 36px;
  min-height: 44px;
  padding: 8px;
  border: 0;
  background: transparent;
  color: var(--color-muted, #626c7a);
}
.rail-nodes {
  display: flex;
  flex: 0 1 auto;
  min-width: 0;
}
.rail-node {
  position: relative;
  flex: 0 0 48px;
  min-width: 48px;
  height: 48px;
  border: 0;
  border-radius: 0;
  padding: 0;
  background: transparent !important;
}
.rail-node:after {
  content: '';
  position: absolute;
  left: 50%;
  right: -50%;
  top: 23px;
  height: 2px;
  background: var(--color-line, #dfe3e9);
}
.rail-node:last-child:after {
  display: none;
}
.rail-dot {
  position: absolute;
  top: 19px;
  left: calc(50% - 5px);
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #8792a3;
  z-index: 1;
}
.is-displayed .rail-dot {
  background: var(--color-brand, #315de8);
  border-radius: 2px;
}
.is-limited .rail-dot {
  background: #ae343b;
  border-radius: 0;
  transform: rotate(45deg);
}
.is-selected .rail-dot {
  outline: 2px solid var(--color-ink, #202631);
  outline-offset: 4px;
}
.rail-node:disabled {
  opacity: 0.6;
  cursor: wait;
}
.rail-node:focus-visible {
  outline: 2px solid var(--color-brand, #315de8);
  outline-offset: 0;
}
.rail-legend {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-muted, #626c7a);
}
.rail-legend span {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rail-legend i {
  display: inline-block;
  width: 8px;
  height: 8px;
}
.key-displayed {
  background: var(--color-brand, #315de8);
  border-radius: 2px;
}
.key-preview {
  border: 1px solid var(--color-ink, #202631);
  border-radius: 50%;
  outline: 1px solid var(--color-ink, #202631);
  outline-offset: 2px;
}
.rail-legend button {
  margin-left: auto;
  font-size: 12px;
}
@media (max-width: 767px) {
  .rail-legend {
    gap: 16px;
    flex-wrap: wrap;
  }
  .rail-legend button {
    margin-left: 0;
  }
}
</style>
