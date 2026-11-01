---
name: "ui-deai"
description: "前端样式去 AI 味检查清单。在编写或 review 组件/页面样式时触发，用于把 AI 生成的 demo 级 UI 拉到真实产品的设计系统水平。"
---

# UI De-AI —— 前端样式去 AI 味

## 定位

本 skill 只提供**可验证的样式判据与修正规则**，不教 CSS 基础、不规定技术栈、不替代设计稿。
它回答一个问题：

> 我写的这段样式，像"有设计系统的真实产品"，还是"AI 生成的 demo"？

任何阶段都可以拿它自检，尤其是准备说"样式写完了"的时候。

数据来源：腾讯 TDesign 官方设计规范、字节跳动官网实测、B 站首页实测。

---

## 第一层：10 秒速判（命中即需纠正）

逐条扫一遍，命中 **3 条以上** = 典型 AI 味，必须改。

| # | 判据 | 检查方法 | AI 味特征 | 工业级特征 |
|---|---|---|---|---|
| 1 | **强调色占比** | 数页面上品牌色节点占比 | > 10%，渐变/发光/彩色标签到处是 | < 2%，只出现在可交互元素和关键标识上 |
| 2 | **阴影层级数** | 数有几种 `box-shadow` | 3 种以上，每张卡都有阴影 | 0~1 种，多数卡片无阴影 |
| 3 | **字重档数** | grep `font-weight` | 5 种以上（300/400/500/600/700/800） | 2 种（400 / 600），Windows 下中间档不生效 |
| 4 | **间距变量** | grep `padding`/`margin` 数值 | 16/20/24/28/32 混用，无规律 | 单一 scale（8 的倍数），同层级间距完全一致 |
| 5 | **`transition: all`** | 全局搜索 | 大量 `all .3s ease` | 只对 `transform/opacity/background-color` 等单个属性过渡 |
| 6 | **纯黑正文** | 检查 `color: #000` / `#111` | 正文纯黑，次文用 `#666`/`#999` | 正文用 `rgba(0,0,0,0.9)` 或近黑 `#1D2129`，次文/辅助/禁用各一档 |
| 7 | **玻璃拟态** | 搜 `backdrop-filter: blur` | 大面积毛玻璃 + 渐变 + 发光 | 极少用，仅在特定浮层上出现且极克制 |
| 8 | **Emoji 装饰** | 搜表情符号字符 | 标题、按钮、空状态里塞满 emoji | 几乎没有，emoji 只出现在用户生成内容里 |
| 9 | **渐变边框/背景** | 搜 `linear-gradient` + `border` | 渐变按钮 + 渐变边框 + 渐变分隔线三件套 | 渐变极少，按钮多为纯色 + hover 变深 |
| 10 | **状态完整性** | 看列表/表单组件 | 只有有数据的正常态 | 有 loading / empty / error / disabled / hover / active 六种状态 |

---

## 第二层：8 维度详解

### 1. 色彩系统

**核心原则：颜色越少，质感越强。**

- 主色 **1 个** + 功能色 **4 个**（成功/失败/告警/链接）= 最多 5 种彩色
- 中性色按透明度分级（TDesign 方式）：`rgba(0,0,0,0.9/0.6/0.4/0.26)`，深浅模式自动适配
- 强调色**只用于**：主按钮、链接、选中态、需要被看见的标识；绝不用作装饰
- 背景色：`#FFFFFF` / `#F7F8FA` / `#F1F2F3`，最多再加一个浮层底色
- 禁用 `transition: all .3s ease`（见第 5 条动效）

**反模式**：紫蓝渐变主按钮、彩色 tag 满天飞、每张卡片配不同主题色、用渐变色当文字色。

### 2. 排版字阶

**核心原则：字阶是固定步长，不是随手调。**

参考 TDesign 字阶（桌面端）：

```
基础阶（+2px 步长）： 12 → 14 → 16
展示阶（+4/+8/+12/+16）：20 → 24 → 28 → 36 → 48 → 64
```

行高公式：`line-height = font-size + 8px`（固定呼吸空间，不是固定倍数）

- 字重**只留 400 和 600 两档**：Windows 下 font-weight < 600 全渲染为 Regular，多了白加
- 数字用 `font-variant-numeric: tabular-nums`，表格里数字对齐
- 标题不要 `font-weight: 800`，中文 700 以上是伪粗体，发糊
- 字体栈：`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif`

**反模式**：字号 13/15/18/22/30 无规律跳变、行高一律 1.5、标题 800 字重、正文用 serif 字体。

### 3. 间距与栅格

**核心原则：同一个页面上，同级元素的间距是同一个数值。**

- 间距 scale：4 / 8 / 12 / 16 / 24 / 32 / 48（8 的倍数，4 是微调）
- 用变量而不是魔数：`--space-1` 到 `--space-7`
- 卡片列表的 gap 必须全局统一：要么全 16px，要么全 20px，不能有的 16 有的 24
- 内容区宽度：固定断点切换（如 1024 / 1280 / 1440），不是流式 `max-width: 90%`
- 用留白分组，不用画线分组

**反模式**：`padding: 17px 23px` 这种非 4 倍数、同一列表里卡片间距参差不齐、靠 `border-bottom` 而不是间距划分区块。

### 4. 卡片与层级

**核心原则：层级越少，越高级。**

- 阴影层级：全站 **0~2 种**。0 种 = 全靠留白和边框；1 种 = 只用于浮层/弹窗
- 卡片设计三档选一种，别混着用：
  - **无边框无阴影**（B站式）：纯靠图片+留白，信息密度高
  - **1px hairline 边框**（TDesign 式）：`border: 1px solid rgba(0,0,0,0.06)`，最通用
  - **浅阴影**（飞书式）：`box-shadow: 0 1px 2px rgba(0,0,0,0.04)`，只有一级
- 圆角分三档：`--radius-sm: 4px` / `--radius-md: 6px` / `--radius-lg: 8px`，够用
- 图片必须 `aspect-ratio` 固定比例，防止加载跳动（CLS）

**反模式**：`shadow-xl + rounded-2xl + border + gradient-border` 四件套、每张卡都有阴影且深浅不一、图片无宽高导致布局抖动。

### 5. 交互状态与动效

**核心原则：hover 只改一个属性，过渡 < 200ms。**

- hover 反馈只选一种：**变颜色** 或 **微微位移** 或 **下划线出现**，不要同时改三个
- 过渡时长：120ms ~ 200ms。超过 300ms 像慢动作，AI 味浓
- 过渡属性：写具体属性名（`transition: color .15s`），**禁止 `transition: all`**
- 动效曲线：`ease-out` 或 `cubic-bezier(.22,1,.36,1)`，不用 `ease`
- 必须有 `active` 态（按下）：`transform: scale(0.98)` 或颜色再深一档
- 必须有 `focus-visible`：键盘操作可见焦点环
- 尊重 `prefers-reduced-motion`：动效可关闭

**反模式**：`transition: all 0.3s ease` 一把梭、hover 同时放大 + 加深阴影 + 变色 + 上移、入场动画 600ms 以上还加弹性。

### 6. 状态完整性

**核心原则：只画了"有数据"的样子 = demo，不是产品。**

每个列表/表单/页面，必须交付这些状态：

| 状态 | 说明 |
|---|---|
| Loading / 骨架屏 | 首次加载，骨架屏要和真实内容尺寸对齐（不能差 20px） |
| Empty / 空状态 | 数据为 0 时的引导，不是写一句"暂无数据"就完事 |
| Error / 失败 | 网络错误、权限不足、加载失败，各有文案和重试按钮 |
| Disabled / 禁用 | 按钮禁用、表单禁用的视觉样式 |
| Hover / Active / Focus | 三种交互态缺一不可 |
| 超长文本 | 标题超长截断（`-webkit-line-clamp: 2`）+ tooltip 完整显示 |
| 部分加载 | 分页/加载更多的过渡态 |

AI 生成的页面 90% 缺这一层。

### 7. 响应式与无障碍

**核心原则：不是"能看"就行，是"能用"。**

- 断点：至少 3 个（移动端 < 768px / 平板 768~1024 / 桌面 > 1024）
- 移动端导航必须折叠为汉堡菜单，不能出现横向滚动条
- 图片必须有 `alt`，装饰图用空 alt
- 按钮 `<button>`，链接 `<a>`，不要用 div 冒充
- 颜色对比度：正文 ≥ 4.5:1（AA），大文字 ≥ 3:1
- `focus-visible` 样式不能去掉，键盘用户全靠它
- 表单 label 必须和 input 关联（`<label for>` 或 aria-label）

**反模式**：`min-width: 1100px` 写死、小屏横向滚动、所有交互元素都是 div + onClick、无焦点样式。

### 8. 文案

**核心原则：具体、短、动词开头。**

- 按钮文案：动词开头（"保存"、"发送验证码"），不要"确认"、"好的"这种模糊词
- 错误提示：说清**什么错了 + 怎么改**（"密码需 8-20 位，含字母和数字"），不是"输入有误"
- 空状态文案：说清**为什么空 + 可以做什么**，不是"暂无数据"
- 同一概念在所有页面叫法一致：不要这页叫"工作台"那页叫"首页"
- 标题不用夸张形容词（"智能"、"赋能"、"革命性"）
- 不用 emoji 当装饰

**反模式**："Welcome to our platform"、"操作成功"、"请输入正确的格式"、满屏 emoji。

---

## 第三层：即用代码片段

完整 CSS 变量模板、组件写法模板、检查脚本，见 [`references/tokens.md`](references/tokens.md)。

### 最常用的 5 个片段

#### ① 安全的主按钮（无渐变）

```css
.btn-primary {
  background: var(--color-brand);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-4);
  font-weight: 600;
  transition: background-color .15s ease-out;
}
.btn-primary:hover { background: var(--color-brand-hover); }
.btn-primary:active { background: var(--color-brand-active); }
.btn-primary:disabled { background: var(--color-brand-disabled); cursor: not-allowed; }
```

#### ② 两档字重 + tabular-nums

```css
:root {
  --font-regular: 400;
  --font-semibold: 600;
}
.numbers { font-variant-numeric: tabular-nums; }
```

#### ③ 文本截断 + hover 全显

```css
.text-ellipsis-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

#### ④ 1px hairline 卡片（最通用）

```css
.card {
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: var(--radius-md);
  transition: border-color .15s ease-out;
}
.card:hover { border-color: rgba(0, 0, 0, 0.12); }
```

#### ⑤ 骨架屏占位（防布局跳动）

```css
.skeleton {
  background: var(--color-gray-1);
  border-radius: 4px;
  animation: shimmer 1.4s ease-in-out infinite;
}
@keyframes shimmer {
  0%   { opacity: 1; }
  50%  { opacity: 0.4; }
  100% { opacity: 1; }
}
```

---

## 自检流程

写完一个组件/页面后，按这个顺序过一遍：

1. **速判 10 条** → 命中几条？3 条以上必须改
2. **色彩 + 排版** → 颜色数量、字重档数、字阶步长
3. **间距 + 卡片** → 间距是否统一、阴影有几层
4. **状态完整性** → loading / empty / error / disabled 有没有
5. **动效 + 交互** → 有没有 `transition: all`、有没有 focus-visible
6. **文案** → 按钮是不是动词开头、错误说不说人话

## 反常识提醒

- "不能用纯黑"不是铁律——字节官网正文就是纯黑 `#000`，关键是必须配明确的二级灰，而不是乱凑 `#333/#666/#999`
- 大厂首页信息密度可以极低（字节官网整页 1666px 高），叙事型页面和工具型页面密度标准相反
- 大厂也有烂的地方（B站首页 `min-width: 1100px` 写死），别照抄

---

## 与其他 Skill 的关系

- **business-first**：关注业务完整性（失败、并发、兼容），本 skill 关注视觉与交互完整性，两者互补
