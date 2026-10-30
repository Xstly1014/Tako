<template>
  <span class="tako-logo"
    ><svg viewBox="0 0 40 40" aria-hidden="true">
      <path
        d="M8 24V17a12 12 0 0 1 24 0v7c5 4 0 10-5 5-4 7-10 7-14 0-5 5-10-1-5-5Z"
        fill="currentColor"
      />
      <circle cx="15" cy="18" r="2" fill="white" />
      <circle cx="25" cy="18" r="2" fill="white" /></svg
    ><span>tako</span></span
  >
</template>
<style scoped>
.tako-logo {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-brand, #315de8);
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -1px;
  line-height: 1;
}
.tako-logo svg {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
}
</style>
