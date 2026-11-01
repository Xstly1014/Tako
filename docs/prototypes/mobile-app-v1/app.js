/* Tako 移动端 App 原型 V1 · 独立样稿逻辑，全部合成数据，不发送任何请求 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var screens = { splash: $('scr-splash'), login: $('scr-login'), onboard: $('scr-onboard'), app: $('scr-app') };
  var state = { pref: null, guest: false, homeTab: null, page: 'home', query: '', followOnly: false, cate: null };
  var liked = {}, faved = {}, followed = {};

  function show(name) {
    Object.keys(screens).forEach(function (k) { screens[k].hidden = k !== name; });
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* ---------- 1→2 开屏进入登录 ---------- */
  $('splash-enter').addEventListener('click', function () { show('login'); });

  /* ---------- 2 登录 / 游客 ---------- */
  $('btn-guest').addEventListener('click', function () {
    state.guest = true;
    $('me-name').textContent = '游客';
    $('me-role').textContent = '游客模式 · 可浏览公开内容';
    enterOnboard();
  });
  $('btn-open-auth').addEventListener('click', function () { $('auth-sheet').hidden = false; });
  $('auth-close').addEventListener('click', function () { $('auth-sheet').hidden = true; });
  $('tab-login').addEventListener('click', function () { switchAuth('login'); });
  $('tab-reg').addEventListener('click', function () { switchAuth('reg'); });
  function switchAuth(which) {
    $('tab-login').classList.toggle('on', which === 'login');
    $('tab-reg').classList.toggle('on', which === 'reg');
    $('form-login').hidden = which !== 'login';
    $('form-reg').hidden = which !== 'reg';
  }
  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  $('form-login').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('auth-msg');
    if (!validEmail($('li-email').value)) { msg.textContent = '请填写完整邮箱地址。'; return; }
    if ($('li-pass').value.length < 8) { msg.textContent = '密码至少 8 位。'; return; }
    state.guest = false;
    enterOnboard();
  });
  $('form-reg').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('auth-msg');
    if (!validEmail($('rg-email').value)) { msg.textContent = '请填写完整邮箱地址。'; return; }
    if ($('rg-name').value.trim().length < 2) { msg.textContent = '笔名至少 2 个字符。'; return; }
    if ($('rg-pass').value.length < 8) { msg.textContent = '密码至少 8 位。'; return; }
    state.guest = false;
    $('me-name').textContent = $('rg-name').value.trim();
    enterOnboard();
  });

  /* ---------- 3 引导：选择形态 ---------- */
  function enterOnboard() { show('onboard'); }
  var prefBtns = Array.prototype.slice.call(document.querySelectorAll('.pref-opt'));
  prefBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      prefBtns.forEach(function (b) { b.setAttribute('aria-checked', String(b === btn)); });
      state.pref = btn.getAttribute('data-pref');
      $('pref-next').disabled = false;
    });
  });
  $('pref-next').addEventListener('click', function () {
    applyPref();
    show('app');
    goPage('home');
  });

  /* ---------- 4-5 顶部标签与发现页 ---------- */
  var PREF_LABEL = { short: '短内容', mid: '中篇', long: '长文' };
  /* 三标签=长文/中篇/短内容；引导页选中的形态居中，另两个分列两侧 */
  function buildTabs() {
    var order = ['short', 'mid', 'long'].filter(function (k) { return k !== state.pref; });
    order.splice(1, 0, state.pref);
    $('top-tabs').innerHTML = order.map(function (k) {
      return '<button type="button" data-tab="' + k + '"' + (k === state.homeTab ? ' class="on"' : '') + '>' + PREF_LABEL[k] + '</button>';
    }).join('');
  }
  function applyPref() {
    $('me-pref-val').textContent = PREF_LABEL[state.pref];
    buildTabs();
    setHomeTab(state.pref);
  }
  function setHomeTab(tab) {
    state.homeTab = tab;
    var tabs = $('top-tabs').children;
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].getAttribute('data-tab') === tab);
    $('view-short').hidden = tab !== 'short';
    $('view-mid').hidden = tab !== 'mid';
    $('view-novel').hidden = tab !== 'long';
    rerenderCurrent();
  }
  function rerenderCurrent() {
    if (state.homeTab === 'short') renderShort();
    else if (state.homeTab === 'mid') renderMid();
    else renderNovel();
  }
  $('top-tabs').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-tab]');
    if (btn) setHomeTab(btn.getAttribute('data-tab'));
  });

  /* 合成内容池：短内容=几秒扫一眼；中篇=十分钟阅读，带摘要/字数/时长 */
  var POOL = [
    { id: 's1', kind: 'short', t: '秋招不知道第几天', g: 'g-blue', tall: true, a: '蒸馒头', genre: '吐槽', likes: 2, favs: 1, hrs: 3, body: '秋招不知道第几天。\n投出去的简历像扔进海里的漂流瓶，偶尔有回音，大多是系统自动回复。\n今天面完最后一场，我在楼下便利店坐了半小时，关东煮的汤比面试官的话暖和。' },
    { id: 's2', kind: 'short', t: '不理解闲鱼封禁 gpt 的理由', g: 'g-pink', tall: true, a: '沙糖桔', genre: '吐槽', likes: 37, favs: 6, hrs: 5, body: '有时候不理解闲鱼封禁 gpt 的理由，完全不理解。\n我要客户啊。\n申诉写了三遍，每一遍都比上一遍更礼貌，也更绝望。' },
    { id: 'm1', kind: 'mid', t: '末班车开往星期八', cv: 'cv-1', a: '墨洗章鱼', genre: '幻想', likes: 312, favs: 88, hrs: 2, words: 12000, minutes: 10, excerpt: '末班车发车的时间是 23:47，车票上的日期印着星期八。售票员说，只有真的不想面对明天的人，才看得见这班车。', body: '末班车发车的时间是 23:47，车票上的日期印着星期八。\n售票员说，只有真的不想面对明天的人，才看得见这班车。\n我捏着那张票，想起被裁那天 HR 的表情，忽然觉得星期八也没什么不好。\n车厢里坐着七个人，每个人都抱着一件不肯放手的东西：一把小号、一沓试卷、一个没送出去的戒指盒。\n列车启动的时候，广播说：本次列车开往星期八，途中不停靠任何一天你讨厌的日子。' },
    { id: 's3', kind: 'short', t: 'codex 明天会重置吗', g: 'g-photo2', tall: false, a: '无双奇术', genre: '工作', likes: 22, favs: 3, hrs: 8, body: 'codex 明天会重置吗？不然只能躺尸了。\n今天的额度用得比工资还快，我盯着进度条，像盯着一班迟迟不来的地铁。' },
    { id: 'm2', kind: 'mid', t: '外婆的裁缝铺关门那天', cv: 'cv-5', a: '旧巷口', genre: '非虚构', likes: 208, favs: 64, hrs: 26, words: 9000, minutes: 8, excerpt: '卷帘门拉下来的声音很闷，像一句没说完的话。外婆把最后一把锁匙挂在门框钉子上，说留给需要的人。', body: '卷帘门拉下来的声音很闷，像一句没说完的话。\n外婆把最后一把锁匙挂在门框钉子上，说留给需要的人。\n铺子里四十年的粉笔画线、顶针和纽扣盒，装满了三个纸箱。我搬最重的那箱，里面全是给别人改小的校服——她说孩子长得快，衣服不能先认输。\n关门那天没有仪式，巷口卖糖水的阿婆多送了我们一碗红豆沙，就算送行了。' },
    { id: 's4', kind: 'short', t: '地铁晚高峰的爽感谁懂', g: 'g-mint', tall: true, a: '夜航西飞', genre: '日常', likes: 138, favs: 12, hrs: 11, body: '地铁下班高峰期看到这个身材的爽感谁懂……\n说的是我自己。挤进车厢的那一刻，我感谢了每一个练深蹲的日子。' },
    { id: 'm3', kind: 'mid', t: '我在漫展修了三天相机', cv: 'cv-3', a: '快门声', genre: '经历', likes: 156, favs: 41, hrs: 50, words: 15000, minutes: 13, excerpt: '第一天我以为只是快门线松了，第二天我发现进的是海水，第三天摊主姑娘递给我一杯姜茶，说修不好也没关系。', body: '第一天我以为只是快门线松了，第二天我发现进的是海水，第三天摊主姑娘递给我一杯姜茶，说修不好也没关系。\n那台相机陪她拍完了整个高中，她想在毕业前再拍一次社团的大家。\n我在展位角落拆了它六次，第七次装回去的时候，快门声清脆得像开场铃。\n她举起相机对着我按了一张，说这是修好后的第一张，送给你。' },
    { id: 's5', kind: 'short', t: '凌晨三点的关东煮是止痛药', g: 'g-sand', tall: false, a: '夜航西飞', genre: '日常', likes: 64, favs: 9, hrs: 30, body: '凌晨三点的便利店，关东煮是成年人的止痛药。\n萝卜要煮到透明，魔芋丝要最后下，这些规矩没人教，都是熬夜熬出来的。' },
    { id: 'm4', kind: 'mid', t: '合租屋的第七个室友是猫', cv: 'cv-6', a: '猫薄荷', genre: '日常', likes: 264, favs: 73, hrs: 74, words: 8000, minutes: 7, excerpt: '签合同的时候中介没说屋里已经有住户。它蹲在窗台上，尾巴扫过我的行李箱，像盖章接收。', body: '签合同的时候中介没说屋里已经有住户。\n它蹲在窗台上，尾巴扫过我的行李箱，像盖章接收。\n六个室友为它排了值日表，它从不遵守，但没人敢有异议。谁让它会在加班夜门口放一只拖鞋，像怕你冷。\n第七个月，值日表上多了一行：猫粮，轮流买，不许买便宜的。' },
    { id: 's6', kind: 'short', t: '第三十一封退稿信后编辑加了我', g: 'g-lilac', tall: true, a: '墨洗章鱼', genre: '灵感', likes: 51, favs: 15, hrs: 96, body: '把退稿信贴满墙，第三十一封的时候编辑加了我微信。\n她说：不是写得好才加你，是你第三十封里那句“我还会再投”太嚣张了，我想看看你能嚣张多久。' },
    { id: 's7', kind: 'short', t: '今天的风适合写告别', g: 'g-lilac', tall: false, a: '青柠汽水', genre: '灵感', likes: 18, favs: 4, hrs: 120, body: '今天的风适合写一个关于告别的故事。\n不哭的那种，吹完就散，散完就轻的那种。' }
  ];
  function footHtml(d) {
    return '<div class="wf-foot"><i></i><span>' + esc(d.a) + '</span>' +
      '<button type="button" class="act like' + (liked[d.id] ? ' on' : '') + '" data-act="like" data-id="' + d.id + '">' + (liked[d.id] ? '♥' : '♡') + ' ' + (d.likes + (liked[d.id] ? 1 : 0)) + '</button>' +
      '<button type="button" class="act fav' + (faved[d.id] ? ' on' : '') + '" data-act="fav" data-id="' + d.id + '">' + (faved[d.id] ? '★' : '☆') + '</button></div>';
  }
  /* 短内容图文卡：封面=创作者配图（photo 系）或标题自动文字配图（带角注）；标题置底 */
  function shortCard(d) {
    var size = d.tall ? 'tall' : 'short';
    var photo = d.g === 'g-photo' || d.g === 'g-photo2';
    var cover = photo
      ? '<div class="wf-media photo ' + d.g + ' ' + size + '"><span class="cv-auto">创作者配图</span></div>'
      : '<div class="wf-media ' + d.g + ' ' + size + '"><span class="cv-text">' + esc(d.t) + '</span><span class="cv-auto">自动配图</span></div>';
    return '<article class="wf-card" data-open="' + d.id + '">' + cover +
      '<strong class="wf-title">' + esc(d.t) + '</strong>' + footHtml(d) + '</article>';
  }
  /* 中篇行：知乎式。作者行（仅笔名，不给作者定位）→标题→摘要(introduction 正式字段)→互动行 */
  function midRow(d) {
    return '<article class="mid-row" data-open="' + d.id + '">' +
      '<div class="m-auth"><i></i><strong>' + esc(d.a) + '</strong></div>' +
      '<strong>' + esc(d.t) + '</strong>' +
      '<p class="mid-excerpt">' + esc(d.excerpt) + '</p>' +
      '<div class="mid-meta"><span class="m-meta"><span class="genre">' + esc(d.genre) + '</span> ' + (d.words / 1000) + ' 千字 · 约 ' + d.minutes + ' 分钟 · ' + d.hrs + ' 小时前</span>' +
      '<button type="button" class="act like' + (liked[d.id] ? ' on' : '') + '" data-act="like" data-id="' + d.id + '">' + (liked[d.id] ? '♥' : '♡') + ' ' + (d.likes + (liked[d.id] ? 1 : 0)) + '</button>' +
      '<button type="button" class="act cmt">💬 ' + commentCount(d.id) + '</button>' +
      '<button type="button" class="act fav' + (faved[d.id] ? ' on' : '') + '" data-act="fav" data-id="' + d.id + '">' + (faved[d.id] ? '★' : '☆') + '</button>' +
      '</div></article>';
  }
  function filteredPool(kind) {
    var q = state.query.trim().toLowerCase();
    return POOL.filter(function (d) {
      if (d.kind !== kind) return false;
      if (state.followOnly && !followed[d.a]) return false;
      if (!q) return true;
      return (d.t + d.a + d.genre).toLowerCase().indexOf(q) >= 0;
    });
  }
  /* 短内容页：纯错落双列瀑布块，独立视图，不混中篇 */
  function renderShort() {
    var list = filteredPool('short');
    var a = [], b = [];
    list.forEach(function (d, i) { (i % 2 === 0 ? a : b).push(shortCard(d)); });
    $('wf-feed').innerHTML = list.length
      ? '<div class="waterfall"><div class="wf-col">' + a.join('') + '</div><div class="wf-col">' + b.join('') + '</div></div>'
      : '<p class="wf-empty">' + emptyMsg('短内容') + '</p>';
  }
  /* 中篇页：纯知乎式全宽文字行，独立视图，不混短内容 */
  function renderMid() {
    var list = filteredPool('mid');
    $('mid-feed').innerHTML = list.length
      ? list.map(midRow).join('')
      : '<p class="wf-empty">' + emptyMsg('中篇') + '</p>';
  }
  /* 共享搜索栏：单一输入，按当前形态过滤；搜索框在视图外，切换形态不重建不抖动 */
  $('app-input').addEventListener('input', function () {
    state.query = $('app-input').value;
    $('app-search-clear').hidden = !state.query;
    rerenderCurrent();
  });
  $('app-search-clear').addEventListener('click', function () {
    $('app-input').value = '';
    state.query = '';
    $('app-search-clear').hidden = true;
    rerenderCurrent();
  });
  /* 仅关注过滤：与搜索无语义关联，独立开关，三形态共用 */
  $('follow-only').addEventListener('click', function () {
    state.followOnly = !state.followOnly;
    $('follow-only').classList.toggle('on', state.followOnly);
    $('follow-only').setAttribute('aria-pressed', String(state.followOnly));
    rerenderCurrent();
  });
  function emptyMsg(kindLabel) {
    return state.followOnly && !state.query
      ? '还没有已关注作者的' + kindLabel + '，去详情页关注几位作者吧。'
      : '没有匹配的' + kindLabel + '，换个关键词试试。';
  }
  /* 卡片快捷动作 + 点开阅读 */
  function feedClick(e) {
    var act = e.target.closest('.act');
    if (act && act.getAttribute('data-act')) {
      var id = act.getAttribute('data-id');
      if (act.getAttribute('data-act') === 'like') liked[id] = !liked[id]; else faved[id] = !faved[id];
      rerenderCurrent();
      return;
    }
    var card = e.target.closest('[data-open]');
    if (!card) return;
    var oid = card.getAttribute('data-open');
    var item = POOL.filter(function (x) { return x.id === oid; })[0];
    if (item && (item.kind === 'short' || item.kind === 'mid')) {
      openDetail(oid);
      if (act && act.classList.contains('cmt')) $('dt-comments').scrollIntoView();
      return;
    }
    openReader(oid);
  }
  $('view-short').addEventListener('click', feedClick);
  $('view-mid').addEventListener('click', feedClick);

  /* ---------- 轻量阅读半屏 ---------- */
  var readerItem = null;
  function openReader(id) {
    var d = POOL.filter(function (x) { return x.id === id; })[0] || NOVELS.filter(function (x) { return x.id === id; })[0];
    if (!d) return;
    readerItem = d;
    $('reader-title').textContent = d.t.replace(/\n/g, ' ');
    $('reader-meta').textContent = d.a + ' · ' + d.genre + (d.words ? ' · ' + (d.words / 1000) + ' 千字 · 约 ' + d.minutes + ' 分钟' : ' · 短内容');
    $('reader-body').textContent = d.body;
    syncReaderBtns();
    $('reader-sheet').hidden = false;
  }
  function syncReaderBtns() {
    if (!readerItem) return;
    $('reader-like').textContent = (liked[readerItem.id] ? '♥' : '♡') + ' 赞';
    $('reader-like').classList.toggle('on', !!liked[readerItem.id]);
    $('reader-fav').textContent = (faved[readerItem.id] ? '★' : '☆') + ' 收藏';
    $('reader-fav').classList.toggle('on', !!faved[readerItem.id]);
    $('reader-follow').textContent = followed[readerItem.a] ? '✓ 已关注' : '+ 关注作者';
    $('reader-follow').classList.toggle('on', !!followed[readerItem.a]);
  }
  $('reader-close').addEventListener('click', function () { $('reader-sheet').hidden = true; });
  $('reader-like').addEventListener('click', function () { if (!readerItem) return; liked[readerItem.id] = !liked[readerItem.id]; syncReaderBtns(); rerenderCurrent(); });
  $('reader-fav').addEventListener('click', function () { if (!readerItem) return; faved[readerItem.id] = !faved[readerItem.id]; syncReaderBtns(); rerenderCurrent(); });
  $('reader-follow').addEventListener('click', function () { if (!readerItem) return; followed[readerItem.a] = !followed[readerItem.a]; syncReaderBtns(); renderNovel(); });

  /* ---------- 短内容详情页：整页推入 + 两级评论 ---------- */
  /* 评论为业务提案（后端未实现）：两级=楼主评论→回复；回复的回复平铺并 @被回复人 */
  var COMMENTS = {
    s1: [
      { id: 'c1', name: '夜航西飞', mine: false, text: '同秋招，一起熬。关东煮那段的比喻我抄走了。', hrs: 2, likes: 5, liked: false, replies: [
        { id: 'c1r1', name: '蒸馒头', mine: true, text: '抄吧，记得请我喝汤。', hrs: 1, likes: 2, liked: false, replyTo: '夜航西飞' },
        { id: 'c1r2', name: '青柠汽水', mine: false, text: '汤比面试官暖和，真实。', hrs: 1, likes: 1, liked: false, replyTo: '蒸馒头' },
        { id: 'c1r3', name: '猫薄荷', mine: false, text: '看到「漂流瓶」那句愣了三秒，秋招人懂。', hrs: 0, likes: 0, liked: false, replyTo: '蒸馒头' }
      ] },
      { id: 'c2', name: '沙糖桔', mine: false, text: '第几天不重要，重要的是你还在投。', hrs: 5, likes: 3, liked: false, replies: [] }
    ],
    s2: [
      { id: 'c3', name: '无双奇术', mine: false, text: '申诉模板发我一份，我也被封了。', hrs: 3, likes: 8, liked: false, replies: [
        { id: 'c3r1', name: '沙糖桔', mine: false, text: '私你了，第三版，语气最卑微那版。', hrs: 2, likes: 4, liked: false, replyTo: '无双奇术' }
      ] }
    ],
    m1: [
      { id: 'c4', name: '青柠汽水', mine: false, text: '「途中不停靠任何一天你讨厌的日子」，这句我要抄进签名档。', hrs: 1, likes: 12, liked: false, replies: [
        { id: 'c4r1', name: '墨洗章鱼', mine: false, text: '抄吧，签名档记得带出处，我查岗的。', hrs: 1, likes: 6, liked: false, replyTo: '青柠汽水' }
      ] }
    ]
  };
  var detailItem = null, replyTo = null, expanded = {};
  /* 版本链数据（业务提案展示）：每条目若干已发布版本，displayed=读者正在看 */
  var VERSIONS = {
    s1: [{ v: 1, at: '3 小时前' }, { v: 2, at: '1 小时前' }],
    s2: [{ v: 1, at: '5 小时前' }, { v: 2, at: '4 小时前' }, { v: 3, at: '2 小时前' }],
    m1: [{ v: 1, at: '2 天前' }, { v: 2, at: '2 小时前' }],
    m2: [{ v: 1, at: '26 小时前' }]
  };
  var selVer = {};
  function renderVersions() {
    var list = VERSIONS[detailItem.id] || [{ v: 1, at: detailItem.hrs + ' 小时前' }];
    var sel = selVer[detailItem.id] || list[list.length - 1].v;
    $('vr-row').innerHTML = list.map(function (x) {
      return '<button type="button" class="vr-node' + (x.v === sel ? ' is-selected' : '') + (x.v === list[list.length - 1].v ? ' is-displayed' : '') +
        '" data-ver="' + x.v + '" aria-label="版本 ' + x.v + '，' + x.at + (x.v === list[list.length - 1].v ? '，读者正在看' : '') + '" aria-pressed="' + (x.v === sel) + '"><span class="vr-dot"></span></button>';
    }).join('');
    var cur = list.filter(function (x) { return x.v === sel; })[0] || list[list.length - 1];
    $('vr-legend').textContent = 'V' + cur.v + ' · ' + cur.at + (cur.v === list[list.length - 1].v ? ' · 读者正在看' : ' · 历史版本');
  }
  $('vr-row').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ver]');
    if (!b) return;
    selVer[detailItem.id] = Number(b.getAttribute('data-ver'));
    renderVersions();
  });
  function commentCount(id) {
    var list = COMMENTS[id] || [];
    return list.reduce(function (n, c) { return n + 1 + c.replies.length; }, 0);
  }
  function cmtHtml(c, isReply) {
    var at = isReply && c.replyTo ? '<span class="cmt-at">回复 @' + esc(c.replyTo) + '</span>' : '';
    var del = c.mine ? '<button type="button" class="cmt-del" data-cdel="' + c.id + '">删除</button>' : '';
    return '<div class="cmt' + (isReply ? ' cmt-sub' : '') + '"><i></i><div class="cmt-main">' +
      '<div class="cmt-head">' + del + '<strong>' + esc(c.name) + '</strong>' + at + '<span class="cmt-time">' + c.hrs + ' 小时前</span></div>' +
      '<p class="cmt-text">' + esc(c.text) + '</p>' +
      '<div class="cmt-foot"><button type="button" class="cmt-like' + (c.liked ? ' on' : '') + '" data-clike="' + c.id + '">' + (c.liked ? '♥' : '♡') + ' ' + (c.likes + (c.liked ? 1 : 0)) + '</button>' +
      '<button type="button" data-creply="' + c.id + '" data-cname="' + esc(c.name) + '">回复</button></div>' +
      '</div></div>';
  }
  function renderComments() {
    var list = COMMENTS[detailItem.id] || [];
    $('dt-cmt-title').textContent = '评论 ' + commentCount(detailItem.id);
    $('dt-cmt').textContent = '💬 ' + commentCount(detailItem.id);
    $('dt-cmt-empty').hidden = list.length > 0;
    $('dt-cmt-list').innerHTML = list.map(function (c) {
      var shown = expanded[c.id] ? c.replies : c.replies.slice(0, 2);
      var replies = shown.length
        ? '<div class="cmt-replies">' + shown.map(function (r) { return cmtHtml(r, true); }).join('') + '</div>' : '';
      var more = c.replies.length > 2 && !expanded[c.id]
        ? '<button type="button" class="cmt-expand" data-cexpand="' + c.id + '">展开 ' + (c.replies.length - 2) + ' 条回复</button>' : '';
      return cmtHtml(c, false) + replies + more;
    }).join('');
  }
  function syncDetailBar() {
    if (!detailItem) return;
    $('dt-like').textContent = liked[detailItem.id] ? '♥' : '♡';
    $('dt-like').classList.toggle('on', !!liked[detailItem.id]);
    $('dt-fav').textContent = faved[detailItem.id] ? '★' : '☆';
    $('dt-fav').classList.toggle('on', !!faved[detailItem.id]);
    $('dt-fav').classList.add('fav');
    $('dt-follow').textContent = followed[detailItem.a] ? '已关注' : '关注';
    $('dt-follow').classList.toggle('on', !!followed[detailItem.a]);
  }
  function openDetail(id) {
    detailItem = POOL.filter(function (x) { return x.id === id; })[0];
    if (!detailItem) return;
    replyTo = null;
    $('dt-input').placeholder = '说点友好的…';
    $('dt-send').hidden = true;
    $('dt-author').textContent = detailItem.a;
    $('dt-author-sub').textContent = detailItem.kind === 'mid' ? '' : '短内容作者';
    $('dt-title').textContent = detailItem.t.replace(/\n/g, '');
    $('dt-body').textContent = detailItem.body;
    var meta = '<span class="genre">' + esc(detailItem.genre) + '</span><span>' + detailItem.hrs + ' 小时前</span>';
    if (detailItem.kind === 'mid') meta = '<span class="genre">' + esc(detailItem.genre) + '</span><span>' + (detailItem.words / 1000) + ' 千字 · 约 ' + detailItem.minutes + ' 分钟</span><span>' + detailItem.hrs + ' 小时前</span>';
    $('dt-meta').innerHTML = meta;
    renderVersions();
    renderComments();
    syncDetailBar();
    $('dt-scroll').scrollTop = 0;
    $('page-detail').hidden = false;
  }
  $('dt-back').addEventListener('click', function () { $('page-detail').hidden = true; rerenderCurrent(); });
  $('dt-like').addEventListener('click', function () { liked[detailItem.id] = !liked[detailItem.id]; syncDetailBar(); });
  $('dt-fav').addEventListener('click', function () { faved[detailItem.id] = !faved[detailItem.id]; syncDetailBar(); });
  $('dt-follow').addEventListener('click', function () { followed[detailItem.a] = !followed[detailItem.a]; syncDetailBar(); });
  $('dt-cmt').addEventListener('click', function () {
    $('dt-comments').scrollIntoView({ behavior: 'smooth' });
    $('dt-input').focus();
  });
  $('dt-input').addEventListener('input', function () { $('dt-send').hidden = !$('dt-input').value.trim(); });
  $('dt-send').addEventListener('click', function () {
    var text = $('dt-input').value.trim();
    if (!text || !detailItem) return;
    var me = state.guest ? '游客' : ($('me-name').textContent || '我');
    var list = COMMENTS[detailItem.id] || (COMMENTS[detailItem.id] = []);
    if (replyTo) {
      var host = list.filter(function (c) { return c.id === replyTo.cmtId; })[0];
      if (host) host.replies.push({ id: 'r' + Date.now(), name: me, mine: true, text: text, hrs: 0, likes: 0, liked: false, replyTo: replyTo.name });
    } else {
      list.push({ id: 'c' + Date.now(), name: me, mine: true, text: text, hrs: 0, likes: 0, liked: false, replies: [] });
    }
    $('dt-input').value = '';
    $('dt-send').hidden = true;
    replyTo = null;
    $('dt-input').placeholder = '说点友好的…';
    renderComments();
    $('dt-comments').scrollIntoView({ behavior: 'smooth' });
  });
  $('dt-cmt-list').addEventListener('click', function (e) {
    var lk = e.target.closest('[data-clike]');
    if (lk) {
      var cid = lk.getAttribute('data-clike');
      (COMMENTS[detailItem.id] || []).forEach(function (c) {
        if (c.id === cid) c.liked = !c.liked;
        c.replies.forEach(function (r) { if (r.id === cid) r.liked = !r.liked; });
      });
      renderComments();
      return;
    }
    var rp = e.target.closest('[data-creply]');
    if (rp) {
      var rid = rp.getAttribute('data-creply');
      var isTop = (COMMENTS[detailItem.id] || []).some(function (c) { return c.id === rid; });
      replyTo = { cmtId: isTop ? rid : topIdOf(rid), name: rp.getAttribute('data-cname') };
      $('dt-input').placeholder = '回复 @' + replyTo.name + '：';
      $('dt-input').focus();
      return;
    }
    var dl = e.target.closest('[data-cdel]');
    if (dl) {
      var did = dl.getAttribute('data-cdel');
      var arr = COMMENTS[detailItem.id] || [];
      COMMENTS[detailItem.id] = arr.filter(function (c) {
        if (c.id === did) return false;
        c.replies = c.replies.filter(function (r) { return r.id !== did; });
        return true;
      });
      renderComments();
      return;
    }
    var ex = e.target.closest('[data-cexpand]');
    if (ex) {
      expanded[ex.getAttribute('data-cexpand')] = true;
      renderComments();
    }
  });
  function topIdOf(replyId) {
    var found = null;
    (COMMENTS[detailItem.id] || []).forEach(function (c) {
      c.replies.forEach(function (r) { if (r.id === replyId) found = c.id; });
    });
    return found;
  }
  $('dt-more').addEventListener('click', function () { $('dt-more-msg').textContent = ''; $('dt-more-sheet').hidden = false; });
  $('dt-more-cancel').addEventListener('click', function () { $('dt-more-sheet').hidden = true; });
  $('dt-more-sheet').addEventListener('click', function (e) {
    var b = e.target.closest('[data-dmore]');
    if (!b) return;
    $('dt-more-msg').textContent = b.getAttribute('data-dmore') === 'report'
      ? '原型演示：举报为 C 期业务提案，未接通。'
      : '原型演示：链接已复制（模拟）。';
  });

  /* ---------- 7 长文页：社区连载频道 ---------- */
  var NOVELS = [
    { id: 'n1', t: '穿越龙族的日常生活', a: '龙鳞笔', genre: '幻想', status: 'serial', words: 460000, chapters: 214, upd: '2 小时前', praise: 8.9, cv: 'cv-1', excerpt: '本以为穿越平行霓虹能躺平，直到龙族的面纱渐渐揭开，他发现龙也要交房租。', body: '第一章 龙也要交房租\n醒来的时候，我趴在东京某条小巷的屋檐上，尾巴扫翻了三盆花。\n房东太太举着扫帚追出来，看清我的脸后愣住了：「小林君？你怎么……长鳞了？」\n我说我也不知道，昨天加班到十一点，回家路上只想变成不用上班的东西。\n她沉默了很久，说：「龙族的话，房租可以涨三成。」' },
    { id: 'n2', t: '东京：我的问题来自身边的少女', a: '清水莲', genre: '幻想', status: 'serial', words: 310000, chapters: 156, upd: '6 小时前', praise: 9.1, cv: 'cv-3', excerpt: '系统提示：您身边的少女携带世界级问题。清水莲原本以为糟糕的日子会一直继续，直到问题开始排队找他。', body: '第一章 问题排队找我\n系统弹窗出现在视网膜上的那天，我正在便利店打工。\n【检测到 S 级问题源：距离 3 米，方向：收银台前。】\n我抬头，看见转学生把一枚硬币拍在柜台上：「找我。」\n那枚硬币是方的。' },
    { id: 'n3', t: '踩着魔门的台阶上山', a: '逆风翻盘', genre: '幻想', status: 'serial', words: 280000, chapters: 132, upd: '1 天前', praise: 8.6, cv: 'cv-4', excerpt: '妖女说降妖除魔也要讲规矩，第一万级台阶上刻着：上山者，先学会下山。', body: '第一章 先学会下山\n魔门的台阶一共一万级，我数到第三千的时候，妖女坐在石栏上啃桃子。\n「新来的？」她问。\n「新来的。」\n「知道第一万级刻着什么吗？」\n我摇头。她把桃核扔下悬崖：「上山者，先学会下山。想清楚再爬。」' },
    { id: 'n4', t: '末班车开往星期八', a: '墨洗章鱼', genre: '幻想', status: 'fresh', words: 30000, chapters: 12, upd: '本周开坑', praise: 9.0, cv: 'cv-2', excerpt: '新连载：只有真的不想面对明天的人，才看得见 23:47 的那班车。', body: '见发现页中篇《末班车开往星期八》，连载版每周三、周六更新。' },
    { id: 'n5', t: '我成了天灾文里的路人', a: '饭碗铁', genre: '非虚构', status: 'fresh', words: 21000, chapters: 9, upd: '本周开坑', praise: 8.4, cv: 'cv-2', excerpt: '新连载：末世降临，路人甲只想好好吃饭，但主角团总在我的饭点出现。', body: '第一章 我的饭点\n天灾降临第七天，我在废墟里找到半袋米。\n刚支起锅，主角团从天而降：「同志，跟我们一起拯救世界吧！」\n我说米刚泡上。他们等了，我也救了，但米泡烂了，这件事我记了很久。' },
    { id: 'n6', t: '拳无敌', a: '选拔赛裁判', genre: '经历', status: 'done', words: 2010000, chapters: 812, upd: '已完结', praise: 9.3, cv: 'cv-5', excerpt: '选拔赛一拳 KO 全国冠军，他扭头对国家队教练说：「你的训练方法，是错的。」', body: '完本感言：写了三年，拳台上下的人都教我一件事——赢不是目的，是副产品。\n谢谢每一位追更到凌晨的读者。' },
    { id: 'n7', t: '姐姐是魔教教主', a: '下山走走', genre: '日常', status: 'done', words: 860000, chapters: 401, upd: '已完结', praise: 8.8, cv: 'cv-6', excerpt: '我很慌，因为她刚刚问我，要不要一起下山走走。', body: '完本感言：姐弟俩最终没有统治江湖，只是开了一家面馆。\n江湖很大，面馆很小，但汤是热的。' }
  ];
  /* 长文页：纵向独立分区流（下滑浏览全部维度，不做切换） */
  var NSEC = [
    { title: '连载中 · 最近更新', filter: function (d) { return d.status === 'serial'; } },
    { title: '新开坑 · 本周', filter: function (d) { return d.status === 'fresh'; } },
    { title: '已完结 · 可放心追', filter: function (d) { return d.status === 'done'; } },
    { title: '社区口碑榜 · 按评分', filter: function () { return true; }, sort: true }
  ];
  function renderNovel() {
    var q = state.query.trim().toLowerCase();
    function base(d) {
      if (state.cate && d.genre !== state.cate) return false;
      if (state.followOnly && !followed[d.a]) return false;
      if (!q) return true;
      return (d.t + d.a + d.genre).toLowerCase().indexOf(q) >= 0;
    }
    function rowHtml(d) {
      return '<article data-open="' + d.id + '"><i class="cover ' + d.cv + '"></i><div><strong>' + esc(d.t) +
        '<button type="button" class="n-follow' + (followed[d.a] ? ' on' : '') + '" data-follow="' + esc(d.a) + '">' + (followed[d.a] ? '已追更' : '追更') + '</button></strong>' +
        '<p>' + esc(d.excerpt) + '</p>' +
        '<span class="n-meta">' + esc(d.genre) + ' · ' + (d.words / 10000).toFixed(0) + ' 万字 · ' + d.chapters + ' 章 · ' + d.upd + '<em>口碑 ' + d.praise.toFixed(1) + '</em></span></div></article>';
    }
    var html = NSEC.map(function (s) {
      var list = NOVELS.filter(function (d) { return s.filter(d) && base(d); });
      if (s.sort) list = list.slice().sort(function (a, b) { return b.praise - a.praise; });
      if (!list.length) return '';
      return '<section class="novel-sec"><h3>' + s.title + '</h3><div class="novel-list">' + list.map(rowHtml).join('') + '</div></section>';
    }).join('');
    /* 畅销精选：口碑 top3，编辑视角出口 */
    var hot = NOVELS.filter(base).slice().sort(function (a, b) { return b.praise - a.praise; }).slice(0, 3);
    if (hot.length) html += '<section class="novel-sec"><h3>畅销精选</h3><div class="novel-list">' + hot.map(rowHtml).join('') + '</div></section>';
    $('novel-body').innerHTML = html;
    $('novel-empty').hidden = html !== '';
    $('novel-empty').textContent = emptyMsg('长文');
  }
  /* 分类子页面：分组 + 两列分类卡（封面+名+作品数）；点卡进组内列表 */
  var CATE_GROUPS = [
    { name: '通俗向', cats: ['日常', '经历', '吐槽', '灵感'] },
    { name: '幻想向', cats: ['幻想', '非虚构'] },
    { name: '工作向', cats: ['工作'] }
  ];
  var CATE_CV = { '日常': 'cv-6', '经历': 'cv-5', '吐槽': 'cv-2', '灵感': 'cv-3', '幻想': 'cv-1', '非虚构': 'cv-4', '工作': 'cv-2' };
  var cateGroup = null;
  function renderCate() {
    if (!cateGroup) {
      $('cate-list').hidden = true;
      $('cate-groups').hidden = false;
      $('cate-groups').innerHTML = (state.cate ? '<div class="cate-head"><h3>当前筛选：' + state.cate + '</h3><button type="button" class="cate-all" id="cate-clear">清除</button></div>' : '') +
        CATE_GROUPS.map(function (g) {
        return '<section class="cate-group"><h3>' + g.name + '</h3><div class="cate-grid">' + g.cats.map(function (c) {
          var n = NOVELS.filter(function (d) { return d.genre === c; }).length;
          return '<button type="button" class="cate-card" data-cate="' + c + '"><i class="cover ' + (CATE_CV[c] || 'cv-1') + '"></i><div><strong>' + c + '</strong><span>' + n + ' 部</span></div></button>';
        }).join('') + '</div></section>';
      }).join('');
      return;
    }
    $('cate-groups').hidden = true;
    $('cate-list').hidden = false;
    var list = NOVELS.filter(function (d) { return d.genre === cateGroup; });
    $('cate-list').innerHTML = '<div class="cate-head"><h3>' + cateGroup + ' · ' + list.length + ' 部</h3><button type="button" class="cate-all" id="cate-all">全部作品</button></div>' +
      '<div class="novel-list">' + list.map(function (d) {
        return '<article data-open="' + d.id + '"><i class="cover ' + d.cv + '"></i><div><strong>' + esc(d.t) + '</strong><p>' + esc(d.excerpt) + '</p>' +
          '<span class="n-meta">' + esc(d.genre) + ' · ' + (d.words / 10000).toFixed(0) + ' 万字 · ' + d.chapters + ' 章 · ' + d.upd + '<em>口碑 ' + d.praise.toFixed(1) + '</em></span></div></article>';
      }).join('') + '</div>';
  }
  function openCate(group) {
    cateGroup = group || null;
    renderCate();
    $('page-cate').hidden = false;
  }
  $('cate-back').addEventListener('click', function () {
    if (cateGroup) { cateGroup = null; renderCate(); }
    else $('page-cate').hidden = true;
  });
  $('cate-groups').addEventListener('click', function (e) {
    if (e.target.id === 'cate-clear') { state.cate = null; renderNovel(); renderCate(); return; }
    var b = e.target.closest('[data-cate]');
    if (b) openCate(b.getAttribute('data-cate'));
  });
  $('cate-list').addEventListener('click', function (e) {
    if (e.target.id === 'cate-all') { state.cate = cateGroup; renderNovel(); $('page-cate').hidden = true; return; }
    var row = e.target.closest('article[data-open]');
    if (row) openReader(row.getAttribute('data-open'));
  });
  $('view-novel').querySelector('.novel-tiles').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-nentry]');
    if (!b) return;
    var which = b.getAttribute('data-nentry');
    if (which === 'genre') {
      openCate(null);
    } else if (which === 'daily') {
      openDemoSheet('每日推荐', '每天一换 · 按你的阅读历史编辑', '原型演示：推荐策略页不在本样稿范围。\n\n今日推荐方向：2 部连载更新 + 1 部你还没开读的完本。');
    } else if (which === 'tako') {
      openDemoSheet('Tako精选', '编辑部每周精选', '原型演示：精选页不在本样稿范围。\n\n本周精选主题：「值得写下来的小瞬间」。');
    } else {
      openTopic();
    }
  });
  $('view-novel').addEventListener('click', function (e) {
    var f = e.target.closest('.n-follow');
    if (f) {
      var name = f.getAttribute('data-follow');
      followed[name] = !followed[name];
      renderNovel();
      return;
    }
    var row = e.target.closest('article[data-open]');
    if (row) openReader(row.getAttribute('data-open'));
  });
  function openDemoSheet(title, meta, body) {
    readerItem = null;
    $('reader-title').textContent = title;
    $('reader-meta').textContent = meta;
    $('reader-body').textContent = body;
    $('reader-like').textContent = '♡ 赞';
    $('reader-fav').textContent = '☆ 收藏';
    $('reader-follow').textContent = '+ 关注作者';
    $('reader-sheet').hidden = false;
  }
  function openTopic() {
    openDemoSheet('本周话题 · 通勤观察', '社区话题 · 32 篇短内容参与', '话题说明：写下你在通勤路上看到、听到、忍住没说的。\n\n参与精选：\n· 夜航西飞《地铁下班高峰期看到这个身材的爽感谁懂…》\n· 蒸馒头《秋招不知道第几天》\n· 青柠汽水《今天的风适合写一个关于告别的故事》\n\n原型演示：话题聚合页不在本样稿范围。');
  }

  /* ---------- 6 底部导航 ---------- */
  var NAV = { home: 'nav-home', merch: 'nav-merch', msg: 'nav-msg', me: 'nav-me' };
  function goPage(page) {
    state.page = page;
    Object.keys(NAV).forEach(function (k) { $(NAV[k]).classList.toggle('on', k === page); });
    $('topbar').hidden = page !== 'home';
    $('app-search').hidden = page !== 'home';
    $('view-short').hidden = page !== 'home' || state.homeTab !== 'short';
    $('view-mid').hidden = page !== 'home' || state.homeTab !== 'mid';
    $('view-novel').hidden = page !== 'home' || state.homeTab !== 'long';
    $('page-merch').hidden = page !== 'merch';
    $('page-shelf').hidden = true;
    $('page-msg').hidden = page !== 'msg';
    $('page-me').hidden = page !== 'me';
    if (page === 'home') rerenderCurrent();
  }
  $('nav-home').addEventListener('click', function () { goPage('home'); });
  $('nav-merch').addEventListener('click', function () { goPage('merch'); });
  $('nav-msg').addEventListener('click', function () { goPage('msg'); });
  $('nav-me').addEventListener('click', function () { goPage('me'); });
  /* 书架：我的页子页面 */
  $('me-shelf').addEventListener('click', function () { $('page-me').hidden = true; $('page-shelf').hidden = false; });
  $('shelf-back').addEventListener('click', function () { $('page-shelf').hidden = true; $('page-me').hidden = false; });
  $('shelf-to-novel').addEventListener('click', function () { $('page-shelf').hidden = true; goPage('home'); setHomeTab('long'); });
  $('me-pref').addEventListener('click', function () { show('onboard'); });
  /* 周边：业务提案演示 */
  $('merch-q').addEventListener('input', function () {
    var q = this.value.trim().toLowerCase();
    Array.prototype.forEach.call(document.querySelectorAll('.merch-card'), function (c) {
      c.hidden = !!q && c.getAttribute('data-merch').toLowerCase().indexOf(q) < 0;
    });
  });
  $('page-merch').addEventListener('click', function (e) {
    var form = e.target.closest('[data-merch-form]');
    if (form) {
      var label = { novel: '实体小说', mag: '杂志薄本', memo: '纪念手册' }[form.getAttribute('data-merch-form')];
      openDemoSheet(label + ' · 形态说明', '创作者作品实体化（业务提案）', '原型演示：' + label + '的装帧、定价与履约流程不在本样稿范围。\n\n读者可为喜爱的作品购买实体纪念；创作者可发起定制展示价值。');
      return;
    }
    var card = e.target.closest('[data-merch]');
    if (card) openDemoSheet(card.getAttribute('data-merch'), '实体纪念 · 限量编号', '原型演示：商品详情与购买流程不在本样稿范围。');
  });
  $('merch-make').addEventListener('click', function () {
    openDemoSheet('发起定制', '创作者实体化入口（业务提案）', '原型演示：定制流程（选作品、装帧、定价、限量编号）不在本样稿范围。');
  });

  /* 发帖面板 */
  $('nav-post').addEventListener('click', function () { $('post-sheet').hidden = false; $('post-msg').textContent = ''; });
  $('post-cancel').addEventListener('click', function () { $('post-sheet').hidden = true; });
  Array.prototype.forEach.call(document.querySelectorAll('[data-post]'), function (btn) {
    btn.addEventListener('click', function () {
      $('post-msg').textContent = '原型演示：' + PREF_LABEL[btn.getAttribute('data-post')] + '编辑器不在本样稿范围内。';
    });
  });

  show('splash');
})();
