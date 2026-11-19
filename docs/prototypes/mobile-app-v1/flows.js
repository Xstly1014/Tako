/* Extends V1. All records are synthetic, kept in memory, and reset on refresh. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const art = '../../../frontend/public/images/tako-login-chibi-open-v3.png';
  const pages = {}, forms = {}, history = [];
  let current = '', focusBefore, dialogReturn, confirmAction, toastTimer;
  const demo = {
    work: { title:'末班车开往星期八', hidden:false, display:2, history:false, comments:12, favorites:3, genre:'幻想' },
    kind:'mid', frozen:null, published:false, favorite:true, shelf:true,
    photos:[], selectedReport:null, novel:null, author:null, feedback:['这个结尾让我想起了回家的路。'], reports:[], appeals:[],
    source:null, product:'穿越龙族的日常生活 · 精装纪念版', price:128, cover:'cv-1', sku:'精装纪念版', quantity:1,
    address:null, orders:[], selectedOrder:null, custom:null,
  };
  const row = (title, meta, target, index) => `<button type="button" class="flow-row" data-flow="${target}" ${index===undefined?'':'data-index="'+index+'"'}><span><strong>${esc(title)}</strong><small>${esc(meta)}</small></span><span class="arrow" aria-hidden="true">›</span></button>`;
  const button = (label, target, cls='btn-primary') => `<button type="button" class="${cls}" data-flow="${target}">${label}</button>`;
  const act = (label, key, cls='btn-primary') => `<button type="button" class="${cls}" data-do="${key}">${label}</button>`;
  const info = text => `<div class="flow-status">${esc(text)}</div>`;
  const field = (label,key,placeholder='',type='text') => `<label class="flow-label">${label}${type==='textarea'?`<textarea data-input="${key}" placeholder="${esc(placeholder)}">${esc(forms[current]?.[key]||'')}</textarea>`:`<input type="${type}" data-input="${key}" value="${esc(forms[current]?.[key]||'')}" placeholder="${esc(placeholder)}" ${type==='number'?'min="1" max="99"':''}>`}</label>`;
  const empty = (title,desc,target,label) => `<div class="flow-empty"><img src="${art}" alt=""><h3>${title}</h3><p>${desc}</p>${target?button(label,target,'btn-ghost'):''}</div>`;
  const choices = items => `<div class="flow-actions">${items.map(([label,id])=>`<button type="button" data-flow="${id}" class="${current===id?'on':''}">${label}</button>`).join('')}</div>`;
  const book = (title=demo.product,cv=demo.cover) => `<div class="book3d"><i class="book ${cv}"><b class="bk-title">${esc(title.split(' · ')[0])}</b></i></div>`;
  const excerpt = '末班车发车的时间是 23:47，车票上的日期印着星期八。\n\n售票员说，只有真的不想面对明天的人，才看得见这班车。\n\n我捏着那张票，想起被裁那天 HR 的表情，忽然觉得星期八也没什么不好。';
  const article = (title=demo.work.title,body=excerpt) => `<h2>${esc(title)}</h2><p class="flow-caption">墨洗章鱼 · 合成样稿</p><div class="flow-article">${esc(body)}</div>`;
  function page(group,id,title,body,opts={}) { pages[id]={group,id,title,body,...opts}; }
  function photos(items=demo.photos, editable=true) {return `<div class="flow-photos">${items.map((p,i)=>`<figure><img src="${p.url}" alt="所选配图 ${i+1}">${editable?`<button type="button" data-remove-photo="${i}" aria-label="移除第 ${i+1} 张配图">×</button>`:''}</figure>`).join('')}</div>`;}
  function draftBody(kind) {
    return `${field('标题','title',kind==='chapter'?'第 43 章 · 星期八':'给这段文字起个名字')}${field('正文','body','从一句话开始…','textarea')}${kind==='short'?`${photos()}<label class="flow-label">添加配图（最多 4 张）<input id="flow-photo-input" type="file" accept="image/png,image/jpeg" multiple></label>${row('关联长文','可选 · 本人公开作品','attach-novel')}`:''}<p class="flow-caption">仅在当前原型会话保留，刷新会清除。</p>${act('保存草稿','save-draft','btn-ghost')}${act('核对发布','prepare')}`;
  }
  page('创作','drafts','中篇草稿',()=>`${button('新建中篇','edit-mid')}${row(forms['edit-mid']?.title||'末班车开往星期八','本机草稿 · 继续写作','edit-mid')}${row('同步状态','1 份待同步示例','sync')}`);
  page('创作','edit-mid','写中篇',()=>draftBody('mid'),{edit:true});
  page('创作','edit-short','写短内容',()=>draftBody('short'),{edit:true});
  page('创作','edit-chapter','写章节',()=>draftBody('chapter'),{edit:true});
  page('创作','attach-novel','关联我的长文',()=>`${act('不关联长文','detach-novel','btn-ghost')}${row('穿越龙族的日常生活','本人公开长文','attach-confirm')}`);
  page('创作','attach-confirm','确认关联',()=>`${book('穿越龙族的日常生活')}<h2>穿越龙族的日常生活</h2>${act('关联这本书','attach-novel')}`);
  page('创作','sync','草稿同步',()=>`${row('末班车开往星期八','本机修订 R2 · 服务端 R1','sync-conflict')}${info('离线或未确认时，保留本机内容，不用旧稿覆盖。')}${act('演示重试同步','sync-retry','btn-ghost')}`);
  page('创作','sync-conflict','核对两份稿件',()=>`${choices([['本机保留稿','sync-conflict'],['服务端稿件','sync-server']])}${article()}${act('分别保留两份稿件','copy-conflict')}`);
  page('创作','sync-server','服务端稿件',()=>`${info('服务端已确认 R1；本机内容不被覆盖。')}${article()}${button('返回核对','sync-conflict','btn-ghost')}`);
  page('创作','prepublish','发行前核对',()=>`${info(demo.kind==='mid'?'正式版 R1 · 服务端工作稿 R2。保存工作稿不会更新正式版。':'请核对准备提交的文字和配图。')}${article(forms['edit-'+demo.kind]?.title||demo.work.title,forms['edit-'+demo.kind]?.body||excerpt)}${demo.kind==='short'?photos():`${field('简介','intro','用一两句话介绍作品')}${act('选择题材','tags','btn-ghost')}`}${act('固定预览','freeze')}`);
  page('创作','preview','固定预览',()=>`${info('预览固定后，修改草稿不会改变本次提交内容。')}${article(demo.frozen?.title||demo.work.title,demo.frozen?.body||excerpt)}${demo.kind==='short'?photos(demo.frozen?.photos||[],false):''}<label class="flow-check"><input id="flow-rights" type="checkbox">我确认拥有文字及配图的发布权利</label>${act('提交这份内容','publish')}${button('返回修改','edit-'+demo.kind,'btn-ghost')}`);
  page('创作','publish-result','提交结果',()=>`${empty(demo.published?'演示：已正式发布':'演示：等待审核','原型不会创建真实作品。',demo.kind==='chapter'?'book-manage':demo.kind==='short'?'short-manage':'work','管理作品')}${row('查看原提交','核对原始内容与处理结果','submission-detail')}${button('继续创作',demo.kind==='chapter'?'book-drafts':'drafts','btn-ghost')}`);
  page('创作','publish-unknown','发布结果未确认',()=>`${empty('先确认原发布','离开不会撤销服务端已受理的请求。')}${act('读取原提交结果','recover')}${button('稍后确认','submissions','btn-ghost')}`);
  page('创作','submissions','提交记录',()=>`${row('修订提交','已发布 · 原稿 R2','submission-detail')}${row('首发提交','已发布 · 原稿 R1','submission-detail')}${row('未确认请求示例','只回查原请求','publish-unknown')}`);
  page('创作','submission-detail','原提交内容',()=>`${info('原请求：已确认。当前公开状态可能已经变化。')}${article(demo.frozen?.title||demo.work.title,demo.frozen?.body||excerpt)}${button('返回作品管理',demo.kind==='short'?'short-manage':'work','btn-ghost')}`);

  const catalog = [
    demo.work,
    { title:'外婆的裁缝铺关门那天', hidden:false, display:2, history:false, comments:8, favorites:2, genre:'非虚构', body:'卷帘门拉下来的声音很闷，像一句没说完的话。外婆把最后一把锁匙挂在门框钉子上，说留给需要的人。' },
    { title:'我在漫展修了三天相机', hidden:true, display:2, history:false, comments:2, favorites:1, genre:'经历', body:'第一天我以为只是快门线松了，第二天我发现进的是海水。' },
    { title:'合租屋的第七个室友是猫', hidden:false, limited:true, display:2, history:false, comments:0, favorites:0, genre:'日常', body:'签合同的时候中介没说屋里已经有住户。它蹲在窗台上，尾巴扫过我的行李箱。' },
  ];
  const workQuery = { text:'', author:'all', platform:'all' };
  let candidateVersion = 1, comparisonPane = 'candidate';
  const authorLabels = { all:'全部', yes:'已隐藏', no:'未隐藏' };
  const platformLabels = { all:'全部', yes:'受限', no:'未受限' };
  function workStatus(work) {
    if (work.hidden && work.limited) return '已隐藏 · 平台受限';
    if (work.hidden) return '已隐藏';
    if (work.limited) return '平台受限';
    return '公开中';
  }
  const workStats = work => `<span class="work-count"><b>${work.comments}</b> 评论</span><span class="work-count"><b>${work.favorites}</b> 收藏</span>`;
  const workBadge = work => `<span class="work-badge ${work.limited?'is-limited':work.hidden?'is-hidden':'is-public'}">${workStatus(work)}</span>`;
  const workTabs = () => choices([['中篇','works'],['短帖','short-works'],['长文','work-books']]);
  function renderWorkCatalog() {
    const filtered = catalog.filter(work =>
      work.title.toLowerCase().includes(workQuery.text.toLowerCase()) &&
      (workQuery.author==='all'||work.hidden===(workQuery.author==='yes')) &&
      (workQuery.platform==='all'||!!work.limited===(workQuery.platform==='yes')));
    const filters = [
      ['author',workQuery.author,authorLabels],
      ['platform',workQuery.platform,platformLabels],
    ].filter(([,value])=>value!=='all');
    return `<div class="work-tabs">${workTabs()}</div>
      <form id="work-search" class="work-search" role="search">
        <input type="search" name="query" aria-label="搜索作品标题" value="${esc(workQuery.text)}" placeholder="搜索作品标题">
        <button type="submit">搜索</button><button type="button" data-do="work-filter">筛选${filters.length?' · '+filters.length:''}</button>
      </form>
      ${filters.length?`<div class="work-filter-tags">${filters.map(([key,value,labels])=>`<button type="button" data-clear-work="${key}" aria-label="清除${labels[value]}筛选">${labels[value]} ×</button>`).join('')}</div>`:''}
      <div class="work-list-head"><strong>${workQuery.text||filters.length?'匹配作品':'已发布作品'} <small>${filtered.length}</small></strong><button type="button" data-flow="feedback">读者反馈 ›</button></div>
      ${filtered.length?filtered.map(work=>`<button type="button" class="work-item" data-work="${catalog.indexOf(work)}">
        <span class="work-item-main"><strong>${esc(work.title)}</strong>
        <span class="work-item-meta"><span>${esc(work.genre)}</span>${workStats(work)}</span></span>
        <span class="work-item-end">${workBadge(work)}<span class="work-chevron" aria-hidden="true">›</span></span>
      </button>`).join(''):`<div class="flow-empty"><img src="${art}" alt=""><h3>没有符合条件的作品</h3><button type="button" data-clear-work="all" class="work-text-action">清除搜索和筛选</button></div>`}`;
  }
  const group = (title,content) => `<section class="work-group"><h3>${title}</h3>${content}</section>`;
  page('作品管理','works','我的作品',renderWorkCatalog);
  page('作品管理','work','作品管理',()=>{
    const work=demo.work;
    return `<header class="work-summary"><div class="work-kicker">中篇 · ${esc(work.genre)}</div>
      <h2>${esc(work.title)}</h2><div class="work-item-meta">${workBadge(work)}${workStats(work)}</div></header>
      ${group('编辑与发布',`<button type="button" class="flow-row work-revise" data-do="revise-selected"><span><strong>修订发行</strong><small>继续编辑工作稿</small></span><span class="arrow" aria-hidden="true">›</span></button>`+row('正式版本',`当前展示 V${work.display} · 查看和切换`,'versions'))}
      ${group('读者与记录',row('作品反馈',work.hidden||work.limited?'当前不可访问':work.comments+' 条评论','work-feedback-entry')+row('提交记录','首发与修订结果','submissions')+row('管理记录','公开状态与展示变更','history'))}
      ${group('公开设置',row('处置与复核',work.limited?'平台限制中':'查看处置记录','work-moderation'))}
      <div class="work-visibility"><span>${work.hidden?'读者无法访问':'作者公开设置'}</span>${work.hidden&&work.limited?'<small>平台限制解除后才可恢复公开</small>':act(work.hidden?'恢复公开':'隐藏作品','toggle-hidden','work-text-action'+(work.hidden?'':' work-danger'))}</div>`;
  });
  page('作品管理','work-feedback-entry','作品反馈',()=>{
    const work=demo.work;
    if(work.hidden||work.limited)return empty('暂不可查看反馈','作品隐藏或受限期间，讨论入口关闭。');
    if(!work.comments)return empty('还没有评论','有读者留言后会显示在这里。');
    return pages['feedback-thread'].body();
  });
  page('作品管理','work-moderation','处置与复核',()=>demo.work.limited
    ?row(demo.work.title,'平台限制中','case')
    :empty('没有处置记录','平台作出处置后，可在这里核对原因及复核资格。'));
  page('作品管理','versions','正式版本',()=>{
    const work=demo.work;
    return `<div class="work-summary work-summary-compact"><div class="work-kicker">${esc(work.title)}</div><h2>当前展示 V${work.display}</h2></div>
      ${group('版本记录',[2,1].map(version=>`<button type="button" class="flow-row" data-version-choice="${version}"><span><strong>V${version}<span class="version-label">${version===work.display?'当前展示':version===2?'最新正式版':'初版'}</span></strong><small>${version===work.display?'阅读正式正文':'对照后可切换展示'}</small></span><span class="work-chevron" aria-hidden="true">›</span></button>`).join(''))}
      <div class="work-visibility"><span>读者可查看历史版本</span>${act(work.history?'已开放':'未开放','history-access','work-text-action')}</div>`;
  });
  function versionArticle(version) {
    const work=demo.work;
    const full=work.body||excerpt;
    const initial=full.split(/\n\n|(?<=。)/).filter(Boolean).slice(0,2).join('\n\n');
    return `<div class="version-reading"><h2>${esc(work.title)}</h2><div class="flow-article">${esc(version===1?initial:full)}</div></div>`;
  }
  page('作品管理','compare-current','当前展示全文',()=>`${info('当前展示 V'+demo.work.display)}${versionArticle(demo.work.display)}`);
  page('作品管理','compare-candidate','核对展示版本',()=>{
    const work=demo.work;
    const version=comparisonPane==='current'?work.display:candidateVersion;
    return `<div class="version-tabs" role="group" aria-label="对照版本">
      <button type="button" data-compare="current" aria-pressed="${comparisonPane==='current'}">当前展示 <b>V${work.display}</b></button>
      <button type="button" data-compare="candidate" aria-pressed="${comparisonPane==='candidate'}">候选版本 <b>V${candidateVersion}</b></button>
      </div>${versionArticle(version)}
      <div class="version-footer">${work.limited||work.hidden?info('当前作品不可切换公开展示。'):act('将 V'+candidateVersion+' 设为展示版','switch-version')}</div>`;
  });
  page('作品管理','history','管理记录',()=>`${(demo.work.events||[]).length?demo.work.events.map(text=>`<div class="flow-row"><span><strong>${esc(text)}</strong><small>本次预览会话</small></span></div>`).join(''):empty('还没有管理记录','切换展示或修改公开状态后，记录会出现在这里。')}`);
  page('作品管理','feedback','读者反馈',()=>`${choices([['待回应','feedback'],['全部','feedback-all']])}${row('青禾：这个结尾让我想起了回家的路','末班车开往星期八','feedback-thread',0)}`);
  page('作品管理','feedback-all','全部反馈',()=>`${row('青禾','末班车开往星期八 · 1 条讨论','feedback-thread',0)}${row('旧巷口','外婆的裁缝铺 · 2 条讨论','feedback-thread',1)}`);
  const workReplies = () => demo.work.replies ??= [demo.work===catalog[0]?demo.feedback[0]:'读完了，最喜欢这一篇的结尾。'];
  page('作品管理','feedback-thread','作品讨论',()=>`<h3>${esc(demo.work.title)}</h3>${workReplies().map((text,i)=>`<div class="cmt"><i></i><div class="cmt-main"><div class="cmt-head"><strong>${i?'我 · 作者':'青禾'}</strong></div><p class="cmt-text">${esc(text)}</p>${i?`<button class="cmt-del" data-delete-reply="${i}">删除</button>`:''}</div></div>`).join('')}${field('回复青禾','reply','写下回复…','textarea')}${act('发表演示回复','reply')}`);
  page('作品管理','short-works','我的短帖',()=>`<div class="work-tabs">${workTabs()}</div>${row(forms['edit-short']?.title||'秋招不知道第几天','公开中','short-manage')}`);
  page('作品管理','work-books','我的长文',()=>`<div class="work-tabs">${workTabs()}</div>${row('穿越龙族的日常生活','连载中 · 42 章','book-manage')}${row('私密新书','尚未发行 · 章节草稿','book-drafts')}`);
  page('作品管理','short-manage','短帖管理',()=>`<h2>${esc(forms['edit-short']?.title||'秋招不知道第几天')}</h2>${photos()}${row('修订图文','固定原文字与图片顺序','edit-short')}${row('正式版本','核对原图文后切换','short-versions')}${row('提交记录','首发与历次修订','submissions')}${row('处置与复核','原处置和申请','moderation')}${act('隐藏短帖','hide-short','flow-danger')}`);
  page('作品管理','short-versions','正式图文版本',()=>`${row('当前展示 V2','最新图文','short-version')}${row('正式版 V1','原始图文','short-version')}`);
  page('作品管理','short-version','核对原图文',()=>`${article('秋招不知道第几天','投出去的简历像扔进海里的漂流瓶。\n\n偶尔有回音，大多是系统自动回复。')}${photos()}${act('设为展示版本','switch-short')}`);

  page('长文','books','我的长文',()=>`${button('新建书籍','book-new')}${row('穿越龙族的日常生活','连载中 · 42 章','book-drafts')}${row('私密新书','尚未发行','book-drafts')}`);
  page('长文','book-new','新建书籍',()=>`${field('书名','title','让世界有个名字')}${field('简介','intro','故事从哪里开始？','textarea')}${act('创建演示书籍','new-book')}`,{edit:true});
  page('长文','book-drafts','章节草稿',()=>`<h2>${esc(forms['book-new']?.title||'穿越龙族的日常生活')}</h2>${button('新建章节','edit-chapter')}${row('第 43 章 · 星期八','本机草稿','edit-chapter')}${row('正式管理','公开章节、书籍资料与复核','book-manage')}${row('修改书籍资料','','book-profile')}`);
  page('长文','book-profile','书籍资料',()=>`${field('书名','title','穿越龙族的日常生活')}${field('简介','intro','填写作品简介','textarea')}${act('保存资料','save-book')}`,{edit:true});
  page('长文','book-manage','正式管理',()=>`<h2>穿越龙族的日常生活</h2>${choices([['章节','book-manage'],['书籍资料','book-settings'],['处置与复核','moderation']])}${row('第 43 章 · 星期八','待审核','chapter-submission')}${row('第 42 章 · 龙族的早餐','公开中','chapter-manage')}`);
  page('长文','chapter-submission','章节提交详情',()=>`${info('当前申请待审核，原正式内容保持不变。')}${article('第 43 章 · 星期八')}${act('撤回待审提交','withdraw','flow-danger')}`);
  page('长文','chapter-manage','章节管理',()=>`${article('第 42 章 · 龙族的早餐')}${row('正式版本','核对和切换','chapter-versions')}${row('章节评论','查看读者讨论','feedback-thread')}${act('隐藏章节','hide-chapter','flow-danger')}`);
  page('长文','chapter-versions','章节版本',()=>`${row('V2 · 当前展示','完整正文','chapter-version')}${row('V1 · 正式版','完整正文','chapter-version')}`);
  page('长文','chapter-version','章节版本全文',()=>`${article('第 42 章 · 龙族的早餐')}${act('切换章节展示版','switch-chapter')}`);
  page('长文','book-settings','正式书籍资料',()=>`${row('基础资料','书名、简介','book-profile')}${row('作品公告','发布和管理公告','author-notices')}${row('完结核对','待处理事项','completion')}${act('隐藏整本书','hide-book','flow-danger')}`);
  page('长文','author-notices','作品公告',()=>`${button('写公告','notice-compose')}${row('本周更新安排','已发布','notice-manage')}`);
  page('长文','notice-compose','写公告',()=>`${field('标题','title')}${field('正文','body','告诉读者接下来的安排…','textarea')}${act('预览公告','notice-preview')}`,{edit:true});
  page('长文','notice-preview','公告预览',()=>`${article(forms['notice-compose']?.title||'本周更新安排',forms['notice-compose']?.body||'本周继续更新新的章节。')}${act('发布演示公告','notice-publish')}`);
  page('长文','notice-manage','公告管理',()=>`${article(forms['notice-compose']?.title||'本周更新安排',forms['notice-compose']?.body||'本周继续更新新的章节。')}${act('撤回公告','notice-withdraw','flow-danger')}`);
  page('长文','completion','完结前核对',()=>`${info('还有 1 项章节提交待审核，处理后再确认完结。')}${row('第 43 章','待审核','chapter-submission')}${button('返回章节管理','book-manage','btn-ghost')}`);
  page('长文','book','作品详情',()=>`${book(demo.novel?.t||'穿越龙族的日常生活',demo.novel?.cv||'cv-1')}<h2>${esc(demo.novel?.t||'穿越龙族的日常生活')}</h2><p>${esc(demo.novel?.genre||'幻想')} · ${demo.novel?.chapters||42} 章</p>${row(demo.novel?.a||'墨洗章鱼','查看作者','author')}${button('继续阅读','chapter-reader')}${row('目录','42 章','directory')}${row('作品公告','本周更新安排','notice-detail')}${act(demo.shelf?'管理书架':'加入书架','shelf')}`);
  page('长文','directory','章节目录',()=>Array.from({length:12},(_,i)=>row(`第 ${i+1} 章 · ${i?'星期八':'龙族的早餐'}`,i===5?'暂不可读':'已公开',i===5?'unavailable':'chapter-reader')).join(''));
  page('长文','chapter-reader','章节阅读',()=>`${article('第 42 章 · 龙族的早餐')}${choices([['上一章','chapter-reader'],['目录','directory'],['下一章','chapter-reader']])}${act('阅读设置','reading-settings','btn-ghost')}${row('本章评论','查看和回复','feedback-thread')}`);
  page('长文','daily','每日推荐',()=>`${row('穿越龙族的日常生活','今日推荐 · 幻想','book')}${row('拳无敌','已完结 · 口碑精选','book')}${info('仅展示推荐版式，不声称使用真实阅读历史。')}`);
  page('长文','curated','Tako 精选',()=>`${article('值得写下来的小瞬间','有的故事很短，有的故事能陪你走很远。')}${row('末班车开往星期八','本周中篇精选','read-mid')}${row('穿越龙族的日常生活','本周长文精选','book')}`);
  page('长文','topic','话题广场',()=>`${row('通勤观察','32 篇合成内容','topic-detail')}${row('今天也写了一点','12 篇合成内容','topic-detail')}`);
  page('长文','topic-detail','通勤观察',()=>`<h2>在路上，也在故事里</h2><p>记录一段路，一次相遇。</p>${row('地铁晚高峰的爽感谁懂','夜航西飞','read-short')}${button('写下我的观察','edit-short')}`);
  page('长文','read-mid','中篇全文',()=>`${article()}${act(demo.favorite?'已收藏':'收藏作品','favorite','btn-ghost')}${row('读者讨论','','feedback-thread')}${row('公开历史版本','','public-versions')}${button('举报这份内容','report','btn-ghost')}`);
  page('长文','read-short','短内容全文',()=>`${article('秋招不知道第几天','今天面完最后一场，我在楼下便利店坐了半小时。')}${row('作者主页','墨洗章鱼','author')}${row('讨论','','feedback-thread')}${button('举报当前图文','report','btn-ghost')}`);
  page('长文','public-versions','公开历史版本',()=>`${info('仅列出作者开放且当前可读的正式版。')}${row('当前展示版','V2','read-mid')}${row('较早正式版','V1','read-mid')}`);

  const authors = window.TakoDemoAuthors;
  const chosenAuthor = () => demo.author || demo.novel?.a || '墨洗章鱼';
  function authorFollow(name) {
    const following = authors.has(name);
    confirm(following ? '取消关注这位作者？' : '关注这位作者？',
      following ? '这位作者的作品将移出你的关注动态。' : '作者可以在粉丝名单中看到你的昵称。',
      following ? '取消关注' : '关注', () => { authors.set(name, !following); if (current) draw(); });
  }
  document.addEventListener('tako:follow-request', e => authorFollow(e.detail));
  page('账号与互动','following','我的关注',()=>{
    const names = authors.following();
    return names.length ? names.map(name=>`<button class="flow-row" data-author="${esc(name)}"><strong>${esc(name)}</strong><small>已关注 ›</small></button>`).join('') : empty('还没有关注作者','在阅读页关注作者后，可以在这里找到对方。');
  });
  page('账号与互动','followers','我的粉丝',()=>`<h2>2 位读者</h2><div class="flow-row"><strong>沙糖桔</strong><small>今天关注</small></div><div class="flow-row"><strong>无双奇术</strong><small>昨天关注</small></div>`);
  page('账号与互动','author','作者主页',()=>`<div class="flow-avatar"><img src="${art}" alt="作者头像示意"><div><strong>${esc(chosenAuthor())}</strong><p>把脑洞留在文字里。</p></div></div>${act(authors.has(chosenAuthor())?'已关注 · 管理':'关注作者','follow','btn-ghost')}${authors.works(chosenAuthor()).map((w,i)=>`<button class="flow-row" data-author-work="${i}"><strong>${esc(w.t)}</strong><small>${w.kind==='short'?'短帖':w.kind==='mid'?'中篇':'长文'} ›</small></button>`).join('')}`);
  page('账号与互动','favorite-list','我的收藏',()=>demo.favorite?`${row('末班车开往星期八','墨洗章鱼','read-mid')}${act('取消收藏','favorite','btn-ghost')}`:empty('还没有收藏','遇到喜欢的作品，可以先收藏。','read-mid','去看看'));
  page('账号与互动','my-comments','我的评论',()=>`${row('这个结尾让我想起了回家的路','末班车开往星期八','feedback-thread')}${row('期待下一章','穿越龙族的日常生活','feedback-thread')}`);
  page('账号与互动','notice-detail','作品公告',()=>article('本周更新安排','本周继续更新新的章节，谢谢大家的耐心阅读。'));
  page('账号与互动','notification-detail','通知详情',()=>`${info('你的中篇已通过人工后审。')}${row('末班车开往星期八','查看原提交','submission-detail')}${button('管理作品','work','btn-ghost')}`);
  page('账号与互动','settings','设置',()=>`${row('编辑资料','笔名','profile')}${row('账号与安全','退出与草稿保护','security')}${row('关于 Tako','','about')}`);
  page('账号与互动','profile','编辑资料',()=>`<div class="flow-avatar"><img src="${art}" alt="当前头像示意"><div><strong>墨洗章鱼</strong><p>保持你熟悉的名字</p></div></div>${field('笔名','nickname','墨洗章鱼')}${act('保存演示笔名','nickname')}`,{edit:true});
  page('账号与互动','security','账号与安全',()=>`${info('原型不登录真实账号，请勿填写真实密码。')}${act('退出演示登录','logout','flow-danger')}`);
  page('账号与互动','about','关于 Tako',()=>`<div class="flow-empty"><img src="${art}" alt=""><h2>tako</h2><p>读点喜欢的，写点自己的。</p></div>${row('协议与隐私说明','文本待定稿','legal')}${row('问题反馈','前端表单','help')}`);
  page('账号与互动','legal','协议与隐私',()=>info('正式文本尚未定稿。原型不请求同意法律协议，也不向服务端发送数据。'));
  page('账号与互动','help','问题反馈',()=>`${field('问题描述','reason','请勿输入敏感信息','textarea')}${act('预览反馈结果','help')}`);

  function reportRows(kind) {
    const rows=demo.reports.flatMap((r,i)=>r.kind===kind?[row(r.title,'V'+r.version+' · 核查中 · 举报 #'+(i+1),'report-detail',i)]:[]);
    return choices([['中篇','reports'],['短帖','short-reports']])+ (rows.join('')||empty('还没有举报记录','在阅读页的“更多”中可以举报内容。'));
  }
  page('举报与复核','reports','我的举报',()=>reportRows('mid'));
  page('举报与复核','short-reports','短帖举报',()=>reportRows('short'));
  page('举报与复核','report','举报内容',()=>`<h3>${esc(demo.source?.title||demo.work.title)} · V${demo.source?.version||1}</h3>${info('针对当前读取的正式版提交说明。举报不会自动下架内容。')}${field('具体问题','reason','说明需要核查的内容','textarea')}${act('提交演示举报','report')}`,{edit:true});
  page('举报与复核','report-detail','举报进度',()=>{
    const report=demo.reports[demo.selectedReport];
    return `<h3>${esc(report?.title||demo.work.title)} · V${report?.version||1}</h3>${info('核查中。处理完成后可在这里查看回执。')}<h3>我的说明</h3><p>${esc(report?.reason||'请核查这份内容中的具体问题。')}</p>${button('返回我的举报',report?.kind==='short'?'short-reports':'reports','btn-ghost')}`;
  });
  page('举报与复核','moderation','处置与复核',()=>`${row(demo.work.title,'当前展示版本受限','case')}${row('整改授权','章节整改示例','rectification')}`);
  page('举报与复核','case','处置详情',()=>`<h2>展示版本受限</h2><h3>处置原因</h3><p>请核对原正式内容中的具体问题。</p>${row('原处置内容','固定正式版本','case-content')}${button('申请复核','appeal')}${row('复核进度',demo.appeals.length?'已受理':'尚未提交','appeal-status')}`);
  page('举报与复核','case-content','原处置内容',()=>`${info('这里展示被处置的正式版，不读取本机草稿。')}${article()}`);
  page('举报与复核','appeal','申请复核',()=>`${field('复核说明','reason','说明需要重新核查的问题','textarea')}${act('提交演示申请','appeal')}`,{edit:true});
  page('举报与复核','appeal-status','复核进度',()=>demo.appeals.length?`${info('申请已受理，等待核查。')}<p>${esc(demo.appeals.at(-1))}</p>${row('原处置','','case')}`:empty('尚未提交复核','核对原处置内容后填写说明。','appeal','申请复核'));
  page('举报与复核','rectification','授权整改',()=>`${info('只针对授权范围提交整改，原限制不会自动解除。')}${field('整改后的正文','body','核对并修改被授权的章节内容','textarea')}${act('预览整改稿','rectification')}`,{edit:true});
  page('举报与复核','rectification-preview','整改稿核对',()=>`${article('整改后的章节',forms.rectification?.body||excerpt)}${act('提交演示整改','rectify-submit')}`);
  page('举报与复核','unavailable','内容暂不可读',()=>empty('这份内容暂不可读','可能未开放、已隐藏或受到限制。','book','返回书籍'));

  page('周边','products','作品实体纪念',()=>`${info('延续原周边展示；商品、价格与库存均为示意。')}${['穿越龙族的日常生活 · 精装纪念版','末班车开往星期八 · 杂志刊','秋招不知道第几天 · 随想手册'].map((t,i)=>`<button class="merch-card flow-product-choice" data-product="${i}">${book(t,'cv-'+(i+1))}<strong>${t}</strong><em>示意 ¥${[128,45,32][i]}</em></button>`).join('')}`,{merch:true});
  page('周边','product','作品周边',()=>`<div class="flow-hero">${book()}</div><h2>${esc(demo.product)}</h2><p>让喜欢的故事，有一本可以留下的纪念。</p><div class="flow-price">¥${demo.price}<small>　示意价格</small></div>${row('装帧与规格',demo.sku,'specification')}${row('配送与售后','规则待确认','shipping')}${act('选择规格','sku')}`,{merch:true});
  page('周边','specification','装帧与规格',()=>`${book()}<h2>${esc(demo.sku)}</h2><p>封面、开本、纸张及限量编号在正式定制时确认。</p>${act('选择规格','sku')}`,{merch:true});
  page('周边','checkout','核对订单',()=>`${row('收货信息',demo.address?demo.address.name+' · '+demo.address.region:'选择演示地址','addresses')}${book()}<h3>${esc(demo.product)}</h3><p>${esc(demo.sku)} × ${demo.quantity}</p><div class="flow-price">示意金额 ¥${demo.price*demo.quantity}</div>${info('运费、库存与交易规则待确认，不会实际扣款。')}${act('创建演示订单','order')}`,{merch:true});
  page('周边','addresses','收货地址',()=>`${demo.address?row(demo.address.name,demo.address.region+' '+demo.address.detail,'checkout'):empty('还没有演示地址','仅填写虚构信息，不发送或保存到服务器。')}${button('新增演示地址','address-edit')}`,{merch:true});
  page('周边','address-edit','演示收货信息',()=>`${info('请勿填写真实姓名、电话和地址。')}${field('演示收件人','name','例如：小章鱼')}${field('演示地区','region','例如：故事市')}${field('演示详细地址','detail','例如：星期八街 1 号')}${act('保存演示地址','address')}`,{edit:true,merch:true});
  page('周边','orders','我的周边订单',()=>demo.orders.length?demo.orders.map((o,i)=>`<button class="flow-row" data-order="${i}"><span><strong>${esc(o.product)}</strong><small>${esc(o.status)} · 示例订单 ${i+1}</small></span><span class="arrow">›</span></button>`).join(''):empty('还没有订单','去看看喜欢的作品纪念。','products','浏览周边'),{merch:true});
  page('周边','order','订单详情',()=>{const o=demo.orders[demo.selectedOrder];return o?`${info('示例订单 · '+o.status)}${book(o.product)}<h2>${esc(o.product)}</h2><p>${esc(o.sku)} × ${o.quantity}</p><p class="flow-price">示意 ¥${o.price*o.quantity}</p>${o.status==='待付款'?`${act('付款面板预览','payment')}${act('取消演示订单','cancel-order','btn-ghost')}`:o.status==='已取消'?button('返回订单','orders','btn-ghost'):`${row('物流进度','示例物流轨迹','logistics')}${act('确认收货预览','receive')}${button('申请售后','after-sale','btn-ghost')}`}`:empty('尚未创建订单','先核对商品和演示地址。','products','浏览周边');},{merch:true});
  page('周边','logistics','物流详情',()=>`${info('示例物流，无真实运单。')}<div class="flow-timeline"><h3>运输中</h3><p>包裹正在前往下一个站点。</p><h3>已揽收</h3><p>示例仓库已交付包裹。</p></div>`,{merch:true});
  page('周边','after-sale','售后申请',()=>`${info('退换条件与时限待确认；这里只演示填写和查看进度。')}${field('问题说明','reason','使用虚构内容演示','textarea')}${act('提交演示申请','after-sale')}`,{merch:true,edit:true});
  page('周边','after-sale-status','售后进度',()=>`${info('示例：申请待受理，未发起退款。')}<p>${esc(forms['after-sale']?.reason||'')}</p>${button('返回订单','order','btn-ghost')}`,{merch:true});
  page('周边','shipping','配送与售后',()=>`${book()}<h3>配送说明</h3><p>配送地区、运费、发货时限待确认。</p><h3>售后说明</h3><p>退换货和退款规则未确定，原型不作交易承诺。</p>`,{merch:true});
  page('创作者定制','custom-work','把作品做成实体',()=>`${info('选择本人作品，核对出版内容与装帧。这里只保存演示方案。')}${row('穿越龙族的日常生活','长文 · 精装成册','custom-format')}${row('末班车开往星期八','中篇 · 杂志薄本','custom-format')}${row('秋招不知道第几天','短内容 · 纪念手册','custom-format')}`,{merch:true});
  page('创作者定制','custom-format','装帧方案',()=>`${book()}<label class="flow-label">装帧<select data-input="format"><option>精装纪念版</option><option>杂志薄本</option><option>随想手册</option></select></label>${field('演示限量数量','limit','例如：100','number')}${button('核对方案','custom-review')}`,{merch:true});
  page('创作者定制','custom-review','核对定制方案',()=>`${book()}<h2>${esc(demo.custom?.title||demo.product)}</h2><p>装帧：${esc(forms['custom-format']?.format||'精装纪念版')}</p><p>演示限量：${esc(forms['custom-format']?.limit||'待确定')}</p>${info('印制成本、定价、授权及履约规则待确认，不实际提交生产。')}${act('保存演示方案','custom-save')}`,{merch:true});
  page('创作者定制','custom-status','我的定制方案',()=>`${info('方案已在本次原型会话中保存。')}${row(demo.custom?.title||demo.product,'未进入生产 · 不向读者售卖','custom-review')}${button('返回周边订单','orders','btn-ghost')}`,{merch:true});

  function toast(text) {clearTimeout(toastTimer);$('flow-toast').textContent=text;$('flow-toast').hidden=false;toastTimer=setTimeout(()=>$('flow-toast').hidden=true,2600);}
  function draw(){const p=pages[current];$('flow-title').textContent=p.title;$('flow-page').classList.toggle('flow-product',!!p.merch);$('flow-body').innerHTML=p.body()+'<p id="flow-error" class="flow-error" role="alert"></p>';$('flow-body').scrollTop=0;$('flow-page').hidden=false;$('scr-app').inert=true;$('flow-review-page').value=current;}
  function open(id,reset=false){if(!pages[id])return;closeDialog();if(reset){history.length=0;focusBefore=document.activeElement}else if(current && current!==id)history.push(current);current=id;if(id==='edit-short')demo.kind='short';if(id==='edit-mid')demo.kind='mid';if(id==='edit-chapter')demo.kind='chapter';draw();$('flow-back').focus();}
  function back(){const run=()=>{if(history.length){current=history.pop();draw();$('flow-back').focus()}else{current='';$('flow-page').hidden=true;$('scr-app').inert=false;focusBefore?.focus()}};if(pages[current]?.edit&&Object.values(forms[current]||{}).some(Boolean)){confirm('离开编辑？','输入仍保留在本次原型会话，刷新页面后清除。','离开',run)}else run();}
  function dialog(title,html){dialogReturn=document.activeElement;$('flow-dialog-title').textContent=title;$('flow-dialog-body').innerHTML=html;$('flow-overlay').hidden=false;$('flow-page').inert=true;$('flow-dialog-close').focus();}
  function closeDialog(){$('flow-overlay').hidden=true;$('flow-page').inert=false;confirmAction=null;if(dialogReturn?.isConnected)dialogReturn.focus();}
  function confirm(title,text,label,fn){dialog(title,`<p>${esc(text)}</p><button class="btn-primary" data-confirm>${esc(label)}</button><button class="sheet-cancel" data-close-flow-dialog>取消</button>`);confirmAction=fn;}
  function required(keys){if(keys.some(k=>!String(forms[current]?.[k]||'').trim())){$('flow-error').textContent='请填写必填内容。';return false}return true;}
  function perform(key){
    if(key==='revise-selected'){
      if(!demo.work.draft)demo.work.draft={title:demo.work.title,body:demo.work.body||excerpt};
      forms['edit-mid']=demo.work.draft;
      open('edit-mid');
      return;
    }
    if(key==='save-draft'){toast('草稿已保留在本次原型会话');return}
    if(key==='prepare'){if(required(['title','body']))open('prepublish');return}
    if(key==='freeze'){const form=forms['edit-'+demo.kind]||{};demo.frozen={title:form.title||demo.work.title,body:form.body||excerpt,photos:[...demo.photos]};open('preview');return}
    if(key==='publish'){if(!$('flow-rights').checked){$('flow-error').textContent='请先核对并确认发布权利。';return}demo.published=demo.kind!=='chapter';open('publish-result');return}
    if(key==='recover'){demo.published=true;open('publish-result');toast('演示：原请求已确认，未补发新请求');return}
    if(key==='tags'){dialog('作品题材','<div class="flow-actions"><button data-tag="幻想">幻想</button><button data-tag="日常">日常</button><button data-tag="非虚构">非虚构</button></div>');return}
    if(key==='work-filter'){
      const select=(id,label,labels,currentValue)=>`<label class="flow-label">${label}<select id="${id}">${Object.entries(labels).map(([value,title])=>`<option value="${value}" ${value===currentValue?'selected':''}>${title}</option>`).join('')}</select></label>`;
      dialog('筛选中篇作品',select('flow-hidden','作者状态',authorLabels,workQuery.author)+select('flow-limited','平台状态',platformLabels,workQuery.platform)+'<button type="button" class="btn-primary" data-apply-filter>应用筛选</button>');
      return;
    }
    if(key==='toggle-hidden'){
      const work=demo.work;
      const label=work.hidden?'恢复公开':'隐藏作品';
      if(work.hidden&&work.limited)return;
      confirm(label+'？',work.hidden?'恢复后，读者将打开最新正式版。':'隐藏后，读者将无法打开作品。你仍可查看和修订。',label,()=>{
        work.hidden=!work.hidden;
        if(!work.hidden)work.display=2;
        (work.events??=[]).unshift(label);
        draw();
      });
      return;
    }
    if(key==='switch-version'){
      const work=demo.work;
      const target=candidateVersion;
      if(work.hidden||work.limited||target===work.display)return;
      confirm('将 V'+target+' 设为展示版？','切换后，读者打开作品时会看到 V'+target+'。工作稿保持原样。','切换展示',()=>{
        work.display=target;
        (work.events??=[]).unshift('切换展示为 V'+target);
        const parent=history.lastIndexOf('versions');
        if(parent>=0)history.splice(parent);
        current='versions';
        draw();
        $('flow-back').focus();
      });
      return;
    }
    if(key==='history-access'){
      const work=demo.work;
      const label=work.history?'关闭历史正文':'开放历史正文';
      confirm(label+'？','仅影响符合公开条件的正式历史版本。',label,()=>{
        work.history=!work.history;
        (work.events??=[]).unshift(label);
        draw();
      });
      return;
    }
    if(key==='reply'){if(required(['reply'])){workReplies().push(forms[current].reply);forms[current].reply='';draw()}return}
    if(key==='new-book'){if(required(['title']))open('book-drafts');return}
    if(key==='save-book'){if(required(['title'])){open('book-drafts');toast('演示资料已保存')}return}
    if(key==='notice-preview'){if(required(['title','body']))open('notice-preview');return}
    if(key==='notice-publish'){confirm('发布公告？','原型不会向读者发送通知。','预览发布结果',()=>open('notice-manage'));return}
    if(key==='favorite'){demo.favorite=!demo.favorite;draw();toast(demo.favorite?'演示收藏已添加':'演示收藏已取消');return}
    if(key==='follow'){authorFollow(chosenAuthor());return}
    if(key==='shelf'){if(demo.shelf)confirm('移出书架？','会同时停止追更，已有消息和续读位置保留。','移出',()=>{demo.shelf=false;draw()});else{demo.shelf=true;draw()}return}
    if(key==='nickname'){if(required(['nickname'])){$('me-name').textContent=forms.profile.nickname;toast('演示笔名已更新')}return}
    if(key==='logout'){confirm('退出登录？','未同步的本机草稿需要原账号登录后恢复。','演示退出',()=>{current='';$('flow-page').hidden=true;$('scr-app').inert=false;document.dispatchEvent(new CustomEvent('tako:base',{detail:{page:'login'}}))});return}
    if(key==='help'){if(required(['reason']))toast('表单演示完成，未发送反馈');return}
    if(key==='report'){
      if(!required(['reason']))return;
      const source=demo.source||{id:'m1',title:demo.work.title,kind:'mid',version:1};
      let index=demo.reports.findIndex(r=>r.source===source.id&&r.version===source.version);
      if(index<0)index=demo.reports.push({source:source.id,title:source.title,kind:source.kind,version:source.version,reason:forms.report.reason})-1;
      demo.selectedReport=index;
      open('report-detail');
      return;
    }
    if(key==='appeal'){if(required(['reason'])){demo.appeals.push(forms.appeal.reason);open('appeal-status')}return}
    if(key==='rectification'){if(required(['body']))open('rectification-preview');return}
    if(key==='rectify-submit'){confirm('提交整改？','原处置不会自动解除。','演示提交',()=>{demo.appeals.push('整改稿已提交，等待审核。');open('appeal-status')});return}
    if(key==='sku'){dialog('选择装帧',`<div>${book()}</div><label class="flow-label">规格<select id="flow-sku"><option>精装纪念版</option><option>平装阅读版</option></select></label><label class="flow-label">数量<input type="number" id="flow-qty" min="1" max="9" value="${demo.quantity}"></label><button class="btn-primary" data-select-sku>核对订单</button><p class="flow-error" id="flow-sku-error"></p>`);return}
    if(key==='address'){if(required(['name','region','detail'])){demo.address={...forms[current]};open('addresses')}return}
    if(key==='order'){if(!demo.address){$('flow-error').textContent='请先选择演示收货信息。';return}demo.orders.push({product:demo.product,sku:demo.sku,price:demo.price,quantity:demo.quantity,status:'待付款'});demo.selectedOrder=demo.orders.length-1;open('order');return}
    if(key==='payment'){dialog('付款面板预览',`${info('未接入任何支付渠道，不会扣款。')}<button class="btn-primary" data-demo-paid>查看演示付款后状态</button>`);return}
    if(key==='cancel-order'){confirm('取消演示订单？','不会改变任何真实交易。','取消订单',()=>{demo.orders[demo.selectedOrder].status='已取消';draw()});return}
    if(key==='receive'){confirm('确认收货预览','真实结算与售后规则尚未确定。','结束演示',()=>{demo.orders[demo.selectedOrder].status='已完成';draw()});return}
    if(key==='after-sale'){if(required(['reason']))open('after-sale-status');return}
    if(key==='custom-save'){demo.custom={title:demo.custom?.title||demo.product};open('custom-status');return}
    if(key==='reading-settings'){dialog('阅读设置','<label class="flow-label">字号<select id="flow-font"><option value="15">标准</option><option value="18">大</option><option value="20">更大</option></select></label><button class="btn-primary" data-apply-font>完成</button>');return}
    if(key==='attach-novel'||key==='detach-novel'){open('edit-short');toast(key==='attach-novel'?'演示已关联长文':'已取消关联');return}
    if(key==='sync-retry'||key==='copy-conflict'){confirm(key==='sync-retry'?'演示同步？':'保留两份稿件？','不覆盖任何真实稿件。','完成演示',()=>open('drafts'));return}
    const changes={'hide-short':['隐藏短帖？','短帖文字和配图停止公开访问。','short-manage'],'hide-chapter':['隐藏章节？','目录保留不可读占位。','chapter-manage'],'hide-book':['隐藏整本书？','读者不能继续打开本书及章节。','book-settings'],'switch-short':['切换正式图文？','文字与图片一起切换。','short-manage'],'switch-chapter':['切换章节展示？','后续读者打开所选正式版。','chapter-manage'],'withdraw':['撤回待审提交？','原提交记录保留，已发行版本不受影响。','book-manage'],'notice-withdraw':['撤回公告？','读者不能继续查看公告正文。','author-notices']};
    if(changes[key]){const [title,text,target]=changes[key];confirm(title,text,'完成演示',()=>{open(target);toast('仅演示流程，未修改真实内容')});}
  }

  const host=document.createElement('section');host.id='flow-page';host.className='flow-page';host.hidden=true;host.innerHTML='<header class="sub-top"><button id="flow-back" type="button" aria-label="返回上一页">‹</button><h2 id="flow-title"></h2></header><div class="flow-body" id="flow-body"></div>';
  document.querySelector('.phone').append(host);
  const overlay=document.createElement('div');overlay.id='flow-overlay';overlay.className='flow-overlay';overlay.hidden=true;overlay.innerHTML='<section class="sheet" role="dialog" aria-modal="true" aria-labelledby="flow-dialog-title"><div class="flow-dialog-head"><h2 id="flow-dialog-title"></h2><button id="flow-dialog-close" type="button" aria-label="关闭弹窗">×</button></div><div id="flow-dialog-body"></div></section>';
  document.querySelector('.phone').append(overlay);
  const toastNode=document.createElement('div');toastNode.id='flow-toast';toastNode.className='flow-toast';toastNode.hidden=true;toastNode.setAttribute('role','status');document.querySelector('.phone').append(toastNode);
  const review=document.createElement('details');review.className='flow-review';review.innerHTML='<summary>查看新增子页面（前端原型）</summary><select id="flow-review-page" aria-label="新增页面"><option value="">选择页面</option>'+Object.values(pages).map(p=>`<option value="${p.id}">${p.group} · ${p.title}</option>`).join('')+'</select><small>新增页面沿用原型组件；原首页与素材不变。全部为合成数据，刷新清除。</small><button type="button" data-review-state="empty">空状态</button><button type="button" data-review-state="error">失败状态</button><button type="button" data-review-state="unknown">未确认</button><button type="button" data-review-state="normal">正常</button>';
  document.querySelector('.stage-note').append(review);
  $('flow-review-page').addEventListener('change',e=>{if(e.target.value)open(e.target.value,true)});
  $('flow-back').addEventListener('click',back);$('flow-dialog-close').addEventListener('click',closeDialog);
  document.addEventListener('tako:flow',e=>{const d=e.detail||{};if(d.product){demo.product=d.product;demo.price=d.price||128;demo.cover=d.cover||'cv-1'}if(d.custom)demo.custom={title:d.custom};if(d.source){if((d.source.id!==demo.source?.id||d.source.version!==demo.source?.version))forms.report={};demo.source=d.source;}if(d.novel)demo.novel=d.novel;if(d.author)demo.author=d.author;open(d.page,true)});
  document.addEventListener('submit',e=>{
    if(e.target.id!=='work-search')return;
    e.preventDefault();
    workQuery.text=e.target.elements.query.value.trim();
    draw();
    $('flow-body').querySelector('input[type=search]').focus();
  });
  document.addEventListener('input',e=>{if(e.target.dataset.input)(forms[current]??={})[e.target.dataset.input]=e.target.value});
  document.addEventListener('change',e=>{if(e.target.dataset.input)(forms[current]??={})[e.target.dataset.input]=e.target.value;if(e.target.id==='flow-photo-input'){
    const files=[...e.target.files];if(demo.photos.length+files.length>4||files.some(f=>!['image/png','image/jpeg'].includes(f.type)||f.size>8*1024*1024)){ $('flow-error').textContent='最多 4 张 JPEG/PNG，每张不超过 8 MiB。';e.target.value='';return }
    demo.photos.push(...files.map(f=>({url:URL.createObjectURL(f)})));draw();
  }});
  document.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b){if(e.target===overlay)closeDialog();return}
    if(b.dataset.author){demo.author=b.dataset.author;open('author');return}
    if(b.dataset.authorWork!==undefined){
      const work=authors.works(chosenAuthor())[Number(b.dataset.authorWork)];
      if(!work)return;
      if(work.kind==='mid'||work.kind==='short'){dialog(work.t,`<p class="flow-article">${esc(work.body||work.excerpt)}</p>`)}
      else{demo.novel=work;open('book')}
      return
    }
    if(b.dataset.flow==='author' && current==='book')demo.author=demo.novel?.a||'墨洗章鱼';
    if(b.dataset.flow){if(b.dataset.flow==='report'&&['read-mid','read-short'].includes(current))demo.source=current==='read-mid'?{id:'m1',title:demo.work.title,kind:'mid',version:demo.work.display}:{id:'s1',title:'秋招不知道第几天',kind:'short',version:2};if(b.dataset.index!==undefined){if(b.dataset.flow==='feedback-thread')demo.work=catalog[Number(b.dataset.index)];else demo.selectedReport=Number(b.dataset.index);}if(current==='custom-work')demo.custom={title:b.querySelector('strong').textContent};open(b.dataset.flow,!current);return}
    if(b.dataset.do){perform(b.dataset.do);return}
    if(b.hasAttribute('data-confirm')){const fn=confirmAction;closeDialog();fn?.();return}
    if(b.hasAttribute('data-close-flow-dialog')){closeDialog();return}
    if(b.dataset.tag){forms.prepublish??={};forms.prepublish.tag=b.dataset.tag;closeDialog();toast('已选择 '+b.dataset.tag);return}
    if(b.hasAttribute('data-remove-photo')){const i=Number(b.dataset.removePhoto);demo.photos.splice(i,1);draw();return}
    if(b.hasAttribute('data-delete-reply')){const i=Number(b.dataset.deleteReply);confirm('删除这条回复？','原型中删除的示例回复将消失。','删除',()=>{workReplies().splice(i,1);draw()});return}
    if(b.hasAttribute('data-select-sku')){const n=Number($('flow-qty').value);if(!Number.isInteger(n)||n<1||n>9){$('flow-sku-error').textContent='演示数量为 1 至 9 件。';return}demo.quantity=n;demo.sku=$('flow-sku').value;open('checkout');return}
    if(b.hasAttribute('data-demo-paid')){demo.orders[demo.selectedOrder].status='演示已付款';closeDialog();draw();return}
    if(b.hasAttribute('data-order')){demo.selectedOrder=Number(b.dataset.order);open('order');return}
    if(b.hasAttribute('data-product')){const i=Number(b.dataset.product);demo.product=['穿越龙族的日常生活 · 精装纪念版','末班车开往星期八 · 杂志刊','秋招不知道第几天 · 随想手册'][i];demo.price=[128,45,32][i];demo.cover='cv-'+(i+1);open('product');return}
    if(b.hasAttribute('data-apply-filter')){
      workQuery.author=$('flow-hidden').value;
      workQuery.platform=$('flow-limited').value;
      closeDialog();
      draw();
      $('flow-back').focus();
      return;
    }
    if(b.hasAttribute('data-clear-work')){
      const key=b.dataset.clearWork;
      if(key==='all')Object.assign(workQuery,{text:'',author:'all',platform:'all'});
      else workQuery[key]='all';
      draw();
      return;
    }
    if(b.hasAttribute('data-work')){
      demo.work=catalog[Number(b.dataset.work)];
      open('work');
      return;
    }
    if(b.dataset.compare){
      comparisonPane=b.dataset.compare;
      draw();
      document.querySelector('[data-compare="'+comparisonPane+'"]').focus();
      return;
    }
    if(b.hasAttribute('data-version-choice')){
      comparisonPane='candidate';
      candidateVersion=Number(b.dataset.versionChoice);
      open(candidateVersion===demo.work.display?'compare-current':'compare-candidate');
      return;
    }
    if(b.hasAttribute('data-apply-font')){const size=$('flow-font').value;closeDialog();document.querySelector('#flow-body .flow-article').style.fontSize=size+'px';return}
    if(b.dataset.reviewState){if(!current)open('works',true);const mode=b.dataset.reviewState;if(mode==='normal')draw();else if(mode==='unknown')open('publish-unknown');else $('flow-body').innerHTML=empty(mode==='empty'?'这里还没有内容':'暂时没能加载',mode==='empty'?'从一个新的故事开始。':'检查连接后重试。',current,mode==='empty'?'查看正常示例':'重试示例');}
  });
  document.addEventListener('keydown',e=>{if(overlay.hidden)return;if(e.key==='Escape'){closeDialog();return}if(e.key==='Tab'){const nodes=[...overlay.querySelectorAll('button,input,select,textarea')].filter(x=>!x.disabled),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}});
})();
