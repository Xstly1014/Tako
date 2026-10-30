<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
const props = defineProps<{
  focus: 'email' | 'code' | ''
  state: 'idle' | 'sending' | 'checking' | 'sent' | 'error' | 'success'
}>()
const reduced = ref(true),
  hidden = ref(false),
  failed = ref(false),
  closedReady = ref(false),
  blink = ref(false)
let query: MediaQueryList | undefined,
  tick: ReturnType<typeof setTimeout> | undefined,
  end: ReturnType<typeof setTimeout> | undefined
const closed = computed(
  () =>
    closedReady.value &&
    !reduced.value &&
    !hidden.value &&
    props.state !== 'error' &&
    (blink.value ||
      props.focus === 'code' ||
      props.state === 'checking' ||
      props.state === 'success'),
)
function stop() {
  clearTimeout(tick)
  clearTimeout(end)
  blink.value = false
}
function schedule() {
  stop()
  if (reduced.value || hidden.value) return
  tick = setTimeout(() => {
    blink.value = true
    end = setTimeout(() => {
      blink.value = false
      schedule()
    }, 160)
  }, 6500)
}
function change() {
  reduced.value = !!query?.matches
  schedule()
}
function visibility() {
  hidden.value = document.hidden
  schedule()
}
watch(() => props.focus, schedule)
watch(
  () => props.state,
  (state) => {
    schedule()
    if (!reduced.value && !hidden.value && (state === 'sending' || state === 'sent')) {
      clearTimeout(tick)
      blink.value = true
      end = setTimeout(() => {
        blink.value = false
        schedule()
      }, 200)
    }
  },
)
onMounted(() => {
  query = window.matchMedia('(prefers-reduced-motion: reduce)')
  change()
  query.addEventListener('change', change)
  document.addEventListener('visibilitychange', visibility)
  visibility()
  const img = new Image()
  img.onload = () => {
    closedReady.value = true
  }
  img.src = '/images/tako-login-chibi-closed-v3.png'
})
onUnmounted(() => {
  stop()
  query?.removeEventListener('change', change)
  document.removeEventListener('visibilitychange', visibility)
})
</script>
<template>
  <div
    class="login-mascot"
    aria-hidden="true"
    :data-expression="closed ? 'closed' : 'open'"
    :data-state="state"
  >
    <img
      v-if="!failed"
      src="/images/tako-login-chibi-open-v3.png"
      alt=""
      width="1536"
      height="1024"
      fetchpriority="high"
      @error="failed = true"
    />
    <img
      v-if="closedReady && !failed"
      class="closed-frame"
      :class="{ 'frame-visible': closed }"
      src="/images/tako-login-chibi-closed-v3.png"
      alt=""
      width="1536"
      height="1024"
      @error="closedReady = false"
    />
  </div>
</template>
<style scoped>
.login-mascot {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 184px;
  pointer-events: none;
  overflow: hidden;
  z-index: 2;
}
.login-mascot img {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 276px;
  height: 184px;
  object-fit: contain;
}
.closed-frame {
  opacity: 0; /* Only replace the eye area: the body and silhouette never jump between generated frames. */
  clip-path: polygon(
    40% 42%,
    54% 42%,
    54% 59%,
    40% 59%,
    40% 42%,
    57% 50%,
    67% 50%,
    67% 65%,
    57% 65%,
    57% 50%
  );
}
.closed-frame.frame-visible {
  opacity: 1;
}
@media (max-width: 767px) {
  .login-mascot {
    height: 160px;
  }
  .login-mascot img {
    width: 240px;
    height: 160px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .closed-frame {
    display: none;
  }
}
</style>
