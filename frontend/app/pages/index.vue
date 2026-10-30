<script setup lang="ts">
const config = useRuntimeConfig()
const publishing = String(config.public.publicationEnabled) === 'true'
</script>
<template>
  <main class="landing">
    <nav class="topbar" aria-label="主导航">
      <NuxtLink to="/" aria-label="Tako 首页"><TakoLogo /></NuxtLink>
      <div class="landing-nav">
        <a href="#content-types">创作方向</a
        ><NuxtLink to="/workspace" class="secondary">我的草稿</NuxtLink>
      </div>
    </nav>
    <section class="hero">
      <div class="hero-copy">
        <p class="hero-kicker">Tako 创作社区</p>
        <h1>脑洞、日常、<br />新故事。<br /><em>都可以开写。</em></h1>
        <p class="hero-description">
          写个冒险故事，分享今天的离谱事，<br />或者认真吐槽一下。题材由你。
        </p>
        <div class="hero-actions">
          <NuxtLink to="/workspace" class="primary">打开我的草稿</NuxtLink
          ><a href="#content-types">看看创作方向</a>
        </div>
        <p class="hero-note">
          {{
            publishing
              ? '中篇发布与阅读已开放，短内容和长篇仍在开发。'
              : '先写下草稿。公开发布与内容发现正在开发中。'
          }}
        </p>
      </div>
      <div class="mascot-stage">
        <img
          src="/images/tako-hero-dynamic-v4.png"
          width="1254"
          height="1254"
          fetchpriority="high"
          alt="Tako 看板娘向读者伸手，蓝白外套与短发随动作扬起"
        />
      </div>
    </section>
    <section id="content-types" class="content-directions" aria-labelledby="directions-heading">
      <header>
        <h2 id="directions-heading">想写什么，就从什么开始。</h2>
        <p>不同篇幅，都有自己的表达方式。</p>
      </header>
      <div class="direction-grid">
        <article>
          <p class="direction-kind">短内容</p>
          <h3>今天也有话说</h3>
          <p>新脑洞、游戏吐槽、创作进度。<br />几句话也能聊得起来。</p>
        </article>
        <article>
          <p class="direction-kind">中篇</p>
          <h3>讲一个完整故事</h3>
          <p>短篇小说、深夜情绪、生活经历。<br />写清楚你想讲的那件事。</p>
        </article>
        <article>
          <p class="direction-kind">长篇</p>
          <h3>开一个大世界</h3>
          <p>幻想、冒险、二次元。<br />让角色和剧情一章章展开。</p>
        </article>
      </div>
    </section>
    <footer>
      <TakoLogo /><span>有脑洞，就开写。</span><NuxtLink to="/workspace">进入写作空间</NuxtLink>
    </footer>
  </main>
</template>
<style scoped>
.landing {
  max-width: 1200px;
  margin: auto;
  padding: 0 32px;
  color: var(--color-ink);
}
.landing .topbar {
  height: 80px;
  border-color: var(--color-line);
}
.landing-nav {
  display: flex;
  gap: 24px;
  align-items: center;
  font-size: 14px;
}
.hero {
  display: grid;
  grid-template-columns: 1fr 1.15fr;
  align-items: center;
  gap: 24px;
  padding: 32px 0;
}
.hero-kicker {
  font-size: 14px;
  color: var(--color-muted);
  margin: 0 0 24px;
}
.hero h1 {
  font-size: 64px;
  line-height: 1.2;
  font-weight: 600;
  letter-spacing: -1px;
  margin: 0 0 24px;
}
.hero-description {
  font-size: 16px;
  line-height: 1.8;
  color: var(--color-muted);
  margin: 0;
}
.hero-actions {
  display: flex;
  align-items: center;
  gap: 24px;
  margin: 32px 0 16px;
  font-size: 14px;
}
.hero-note {
  font-size: 12px;
  line-height: 1.8;
  color: var(--color-muted);
  margin: 0;
}
.mascot-stage {
  display: flex;
  justify-content: center;
  align-items: center;
}
.mascot-stage img {
  width: 100%;
  height: 580px;
  object-fit: contain;
  object-position: center;
}
.content-directions {
  padding: 48px 0;
}
.content-directions > header h2 {
  font-size: 28px;
  font-weight: 600;
  margin: 0 0 12px;
}
.content-directions > header p {
  font-size: 14px;
  color: var(--color-muted);
  margin: 0;
}
.direction-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 32px;
  margin-top: 32px;
}
.direction-grid article {
  background: #fff;
  padding: 24px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
}
.direction-kind {
  font-size: 12px;
  color: var(--color-muted);
  margin: 0 0 16px;
}
.direction-grid h3 {
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
  margin: 0 0 12px;
}
.direction-grid article > p:last-child {
  font-size: 14px;
  line-height: 1.8;
  color: var(--color-muted);
  margin: 0;
}
.landing footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 32px 0;
  gap: 24px;
  border-top: 1px solid var(--color-line);
  font-size: 12px;
  color: var(--color-muted);
}
@media (min-width: 768px) and (max-width: 1024px) {
  .hero {
    gap: 24px;
  }
  .hero h1 {
    font-size: 48px;
  }
  .mascot-stage img {
    height: 460px;
  }
  .direction-grid {
    gap: 16px;
  }
  .direction-grid article {
    padding: 16px;
  }
}
@media (max-width: 767px) {
  .landing {
    padding: 0 24px;
  }
  .landing-nav {
    gap: 16px;
    font-size: 12px;
  }
  .landing-nav > a:first-child {
    display: none;
  }
  .hero {
    grid-template-columns: 1fr;
    padding: 32px 0;
    gap: 24px;
  }
  .hero h1 {
    font-size: 40px;
  }
  .hero-description {
    font-size: 14px;
  }
  .hero-actions {
    gap: 24px;
    flex-wrap: wrap;
  }
  .mascot-stage img {
    height: 380px;
  }
  .content-directions {
    padding: 32px 0;
  }
  .content-directions > header h2 {
    font-size: 24px;
  }
  .direction-grid {
    grid-template-columns: 1fr;
    gap: 16px;
    margin-top: 24px;
  }
  .landing footer {
    flex-wrap: wrap;
    gap: 16px;
  }
  .landing footer > span {
    display: none;
  }
}
</style>

<style scoped>
.hero h1 {
  font-synthesis: weight;
  font-weight: 700;
  letter-spacing: -2px;
}
.hero h1 em {
  font-style: normal;
  color: var(--color-brand);
}
.hero-actions > .primary {
  font-weight: 600;
  padding: 16px 24px;
}
.direction-grid h3 {
  font-synthesis: weight;
}
.direction-kind {
  color: var(--color-brand);
  font-weight: 600;
}
@media (max-width: 767px) {
  .hero h1 {
    font-size: 44px;
    letter-spacing: -1px;
  }
}
</style>
