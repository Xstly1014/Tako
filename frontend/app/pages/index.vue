<template>
  <main class="landing">
    <nav class="topbar" aria-label="主导航">
      <NuxtLink to="/" class="brand">tako<span>✦</span></NuxtLink>
      <div class="landing-nav"><a href="#content-types">在 Tako 写什么</a><NuxtLink to="/workspace" class="nav-link">我的草稿 ↗</NuxtLink></div>
    </nav>
    <section class="hero">
      <div class="hero-copy">
        <span class="hero-badge"><span class="small-dot" />TAKO / 创作进行时</span>
        <h1>脑洞、日常、<br />新故事。<br /><em>都可以开写。</em></h1>
        <p>写个冒险故事，分享今天的离谱事，<br class="desktop-break" />或者认真吐槽一下。长短不限，题材由你。</p>
        <div class="hero-actions"><NuxtLink to="/workspace" class="primary link-button">打开我的草稿 <span>↗</span></NuxtLink><a href="#content-types" class="hero-more">看看创作方向 ↓</a></div>
        <p class="hero-note">现在可以：邮箱登录、私密草稿、自动保存。<br />公开发布与内容发现正在开发中。</p>
      </div>
      <div class="mascot-stage">
        <span class="stage-word" aria-hidden="true">HELLO,<br />TAKO!</span>
        <div class="stage-orbit" aria-hidden="true" />
        <img class="mascot-image" src="/images/tako-mascot-v1.png" width="1024" height="1536" fetchpriority="high" alt="Tako 原创看板娘概念：蓝白街头穿搭、章鱼发饰，以及同角色的 Q 版形象" />
        <span class="mascot-caption">看板娘初设 / 01</span>
      </div>
    </section>
    <section id="content-types" class="content-directions" aria-labelledby="directions-heading">
      <div class="directions-heading"><div><span class="eyebrow">MAKE IT YOURS</span><h2 id="directions-heading">想写什么，就从什么开始。</h2></div><p>三种内容方向，一个 Tako。<br />当前先把草稿写起来。</p></div>
      <div class="direction-grid">
        <article class="direction-card short"><span class="direction-index">01 / 短内容</span><span class="direction-symbol" aria-hidden="true">#</span><h3>今天也有话说</h3><p>新脑洞、游戏吐槽、创作进度，<br />几句话也能聊得起来。</p><div class="topic-tags"><span>日常</span><span>吐槽</span><span>灵感</span></div></article>
        <article class="direction-card medium"><span class="direction-index">02 / 中篇</span><span class="direction-symbol" aria-hidden="true">✳</span><h3>一口气讲个完整故事</h3><p>短篇小说、深夜情绪、生活经历，<br />写清楚你想讲的那件事。</p><div class="topic-tags"><span>短篇</span><span>情绪</span><span>经历</span></div></article>
        <article class="direction-card long"><span class="direction-index">03 / 长文</span><span class="direction-symbol" aria-hidden="true">↗</span><h3>这次，开一个大世界</h3><p>幻想、冒险、二次元，<br />让角色和剧情一章章展开。</p><div class="topic-tags"><span>幻想</span><span>冒险</span><span>连载</span></div></article>
      </div>
    </section>
    <footer><NuxtLink to="/" class="brand">tako<span>✦</span></NuxtLink><span>有脑洞，就开写。</span><NuxtLink to="/workspace">进入写作空间 ↗</NuxtLink></footer>
  </main>
</template>
