# Design Token 模板与代码片段

本文件提供可直接复制使用的 CSS 变量系统、组件写法模板和检查脚本。

---

## 一、完整 Design Token 模板（CSS Variables）

复制到 `:root` 里作为基础，按需替换品牌色值。

```css
:root {
  /* ===== 色彩 ===== */

  /* 品牌色（主色）— 以 TDesign 腾讯蓝为例，替换为你的品牌色 */
  --color-brand: #0052d9;
  --color-brand-hover: #366ef4;   /* 悬停，比 brand 浅一档 */
  --color-brand-active: #003cab;  /* 按下，比 brand 深一档 */
  --color-brand-disabled: #b5c7ff; /* 禁用 */
  --color-brand-bg: #f2f3ff;      /* 品牌色浅背景（选中态、标签） */

  /* 功能色 */
  --color-success: #2ba471;
  --color-warning: #e37318;
  --color-error: #d54941;
  --color-link: #0052d9;

  /* 中性色 — 用透明度，深浅模式自动适配 */
  --text-primary: rgba(0, 0, 0, 0.9);   /* 正文 */
  --text-secondary: rgba(0, 0, 0, 0.6); /* 次要文字 */
  --text-tertiary: rgba(0, 0, 0, 0.4);  /* 辅助说明 */
  --text-disabled: rgba(0, 0, 0, 0.26); /* 禁用文字 */

  /* 背景色 */
  --color-bg: #ffffff;
  --color-bg-secondary: #f7f8fa;
  --color-bg-tertiary: #f1f2f3;

  /* 分割线 / 边框 */
  --color-border: rgba(0, 0, 0, 0.06);
  --color-border-hover: rgba(0, 0, 0, 0.12);
  --color-divider: rgba(0, 0, 0, 0.04);

  /* ===== 间距 ===== */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;

  /* ===== 圆角 ===== */
  --radius-sm: 4px;   /* 小标签、复选框 */
  --radius-md: 6px;   /* 按钮、输入框、卡片 */
  --radius-lg: 8px;   /* 弹窗、大卡片 */
  --radius-full: 999px;

  /* ===== 阴影 —— 最多 2 级 ===== */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);   /* 轻悬浮 */
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);  /* 浮层/下拉 */
  /* 不使用 lg/xl 阴影，AI 味重 */

  /* ===== 字体 ===== */
  --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI",
    "Microsoft YaHei", "Source Han Sans CN", sans-serif;

  --font-regular: 400;
  --font-semibold: 600;
  /* 不使用 700/800，中文 Windows 下是伪粗体 */

  /* 字阶 */
  --font-size-xs: 12px;   /* 辅助说明 */
  --font-size-sm: 13px;   /* 次要信息 */
  --font-size-base: 14px; /* 正文 */
  --font-size-md: 16px;   /* 小标题 */
  --font-size-lg: 20px;   /* 模块标题 */
  --font-size-xl: 28px;   /* 页面标题 */
  --font-size-2xl: 40px;  /* 展示型大标题 */

  /* 行高 = 字号 + 8px */
  --line-height-xs: 20px;
  --line-height-sm: 21px;
  --line-height-base: 22px;
  --line-height-md: 24px;
  --line-height-lg: 28px;
  --line-height-xl: 36px;
  --line-height-2xl: 48px;

  /* ===== 动效 ===== */
  --duration-fast: 120ms;
  --duration-base: 160ms;
  --duration-slow: 200ms;
  /* 不使用 300ms 以上的常规交互过渡 */

  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
}

/* 暗色模式 — 自动适配基于透明度的文字色 */
@media (prefers-color-scheme: dark) {
  :root {
    --text-primary: rgba(255, 255, 255, 0.9);
    --text-secondary: rgba(255, 255, 255, 0.6);
    --text-tertiary: rgba(255, 255, 255, 0.4);
    --text-disabled: rgba(255, 255, 255, 0.28);

    --color-bg: #181818;
    --color-bg-secondary: #1f1f1f;
    --color-bg-tertiary: #242424;

    --color-border: rgba(255, 255, 255, 0.08);
    --color-border-hover: rgba(255, 255, 255, 0.16);
  }
}

/* 减少动效 */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 二、组件写法模板

### 按钮（三态 + 禁用 + focus）

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  font-size: var(--font-size-base);
  font-weight: var(--font-semibold);
  line-height: var(--line-height-base);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  cursor: pointer;
  user-select: none;
  transition: background-color var(--duration-base) var(--ease-out),
              border-color var(--duration-base) var(--ease-out),
              color var(--duration-base) var(--ease-out);
}

/* 主按钮 */
.btn-primary {
  background: var(--color-brand);
  color: #fff;
}
.btn-primary:hover   { background: var(--color-brand-hover); }
.btn-primary:active  { background: var(--color-brand-active); transform: scale(0.98); }
.btn-primary:disabled{ background: var(--color-brand-disabled); cursor: not-allowed; }

/* 次级按钮 */
.btn-secondary {
  background: var(--color-bg);
  color: var(--text-primary);
  border-color: var(--color-border);
}
.btn-secondary:hover { border-color: var(--color-border-hover); background: var(--color-bg-secondary); }
.btn-secondary:active { background: var(--color-bg-tertiary); }

/* 文字按钮 */
.btn-text {
  background: transparent;
  color: var(--color-link);
  padding: var(--space-1) var(--space-2);
}
.btn-text:hover { text-decoration: underline; }

/* 键盘焦点环 — 必须有 */
.btn:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 2px;
}
```

### 卡片（hairline 边框 + hover 反馈）

```css
.card {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-5);
  transition: border-color var(--duration-base) var(--ease-out);
}
.card:hover { border-color: var(--color-border-hover); }
```

### 列表项（无边框无阴影，靠间距分组）

```css
.list-item {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  transition: background-color var(--duration-fast) var(--ease-out);
  cursor: pointer;
}
.list-item:hover { background: var(--color-bg-secondary); }
.list-item:active { background: var(--color-bg-tertiary); }
```

### 标签 / Tag

```css
.tag {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--space-2);
  font-size: var(--font-size-xs);
  line-height: 18px;
  color: var(--text-secondary);
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
  white-space: nowrap;
}
.tag-primary {
  color: var(--color-brand);
  background: var(--color-brand-bg);
}
```

### 输入框

```css
.input {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  font-size: var(--font-size-base);
  line-height: var(--line-height-base);
  color: var(--text-primary);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: border-color var(--duration-base) var(--ease-out);
}
.input::placeholder { color: var(--text-disabled); }
.input:hover { border-color: var(--color-border-hover); }
.input:focus {
  outline: none;
  border-color: var(--color-brand);
  box-shadow: 0 0 0 2px var(--color-brand-bg);
}
.input:disabled {
  background: var(--color-bg-secondary);
  cursor: not-allowed;
}
```

### 空状态

```css
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-7) var(--space-5);
  color: var(--text-tertiary);
  text-align: center;
}
.empty-state__icon {
  width: 64px;
  height: 64px;
  margin-bottom: var(--space-4);
  opacity: 0.3;
}
.empty-state__title {
  font-size: var(--font-size-md);
  font-weight: var(--font-semibold);
  color: var(--text-secondary);
  margin-bottom: var(--space-2);
}
.empty-state__desc {
  font-size: var(--font-size-sm);
  line-height: var(--line-height-sm);
  max-width: 320px;
}
```

### 骨架屏

```css
.skeleton {
  background: var(--color-bg-tertiary);
  border-radius: 4px;
  animation: skeleton-shimmer 1.4s ease-in-out infinite;
}

@keyframes skeleton-shimmer {
  0%   { opacity: 1; }
  50%  { opacity: 0.4; }
  100% { opacity: 1; }
}

/* 用法：宽度固定，防止布局跳动 */
.skeleton-title { width: 60%; height: 16px; margin-bottom: 8px; }
.skeleton-text  { width: 100%; height: 14px; margin-bottom: 6px; }
.skeleton-text.short { width: 40%; }
```

---

## 三、CSS Lint 规则建议

在 stylelint 里加这些自定义规则，可以在写代码时就拦住 AI 味：

```js
// stylelint 规则参考
module.exports = {
  rules: {
    // 禁止 transition: all
    'declaration-property-value-disallowed-list': {
      transition: ['/all/'],
    },
    // 禁止 font-weight: 700/800（中文 Windows 伪粗体）
    'declaration-property-value-disallowed-list': {
      'font-weight': ['700', '800', '900', 'bold', 'bolder'],
    },
    // 禁止纯黑正文
    'color-named': ['never', { ignore: ['white'] }],
    // 间距必须使用变量（禁止魔数 padding/margin）
    'declaration-property-value-disallowed-list': {
      'padding': ['/\d+px/'],
      'margin': ['/\d+px/'],
    },
    // 最多 2 种阴影
    'declaration-block-no-redundant-longhand-properties': true,
  },
};
```

---

## 四、快速检查脚本（Node.js）

扫描 CSS 文件，输出可能存在 AI 味的地方。

```js
// ai-style-check.js
// 用法: node ai-style-check.js <css-file-or-dir>

const fs = require('fs');
const path = require('path');

const checks = [
  { pattern: /transition:\s*all/gi, msg: '禁止 transition: all，应写具体属性名', level: 'error' },
  { pattern: /font-weight:\s*(700|800|900|bold|bolder)/gi, msg: '字重建议只用 400 和 600，700+ 在中文 Windows 下是伪粗体', level: 'warn' },
  { pattern: /color:\s*#000\b/gi, msg: '正文避免纯黑 #000，用 rgba(0,0,0,0.9) 或近黑色', level: 'warn' },
  { pattern: /box-shadow:.*rgba\(0,\s*0,\s*0,\s*0\.\d+\).*rgba\(0,\s*0,\s*0,\s*0\.\d+\)/gi, msg: '多重阴影层数过多，建议最多 2 层', level: 'warn' },
  { pattern: /backdrop-filter:\s*blur/gi, msg: '玻璃拟态慎用，大面积使用是典型 AI 味', level: 'warn' },
  { pattern: /border-image:\s*linear-gradient/gi, msg: '渐变边框是 AI 味重灾区', level: 'warn' },
  { pattern: /linear-gradient\(.*#\w{6}.*#\w{6}/gi, msg: '渐变使用次数需克制', level: 'info' },
  { pattern: /border-radius:\s*(16|20|24|32)px/gi, msg: '大圆角（>12px）建议统一用变量，且全站不超过 3 档', level: 'info' },
];

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const results = [];

  checks.forEach(check => {
    const re = new RegExp(check.pattern.source, 'gi');
    let match;
    while ((match = re.exec(content)) !== null) {
      const lineNum = content.slice(0, match.index).split('\n').length;
      results.push({ level: check.level, line: lineNum, msg: check.msg, file: filePath });
    }
  });

  return results;
}

function walk(dir) {
  let files = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory() && !item.name.startsWith('node_modules') && !item.name.startsWith('dist')) {
      files = files.concat(walk(full));
    } else if (/\.(css|scss|less)$/.test(item.name)) {
      files.push(full);
    }
  }
  return files;
}

const target = process.argv[2] || '.';
const stat = fs.statSync(target);
const files = stat.isDirectory() ? walk(target) : [target];

let allResults = [];
files.forEach(f => { allResults = allResults.concat(scanFile(f)); });

console.log(`扫描了 ${files.length} 个文件，发现 ${allResults.length} 个问题\n`);

const byLevel = { error: [], warn: [], info: [] };
allResults.forEach(r => byLevel[r.level].push(r));

['error', 'warn', 'info'].forEach(level => {
  if (byLevel[level].length) {
    console.log(`\n[${level.toUpperCase()}] ${byLevel[level].length} 个:`);
    byLevel[level].forEach(r => {
      console.log(`  ${path.relative('.', r.file)}:${r.line}  ${r.msg}`);
    });
  }
});
```
