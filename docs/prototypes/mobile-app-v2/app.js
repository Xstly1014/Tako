'use strict';
// Review-only frontend. No fetch, credentials, payments, or persistence outside this tab.
const pages = {}, values = {}, trail = [];
let current = 'community', state = 'ready', lastFocus, toastTimer;
let demoPhoto = false;
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const action = (text,target,kind='secondary') => `<button class="${kind}" data-go="${target}">${text}</button>`;
const modal = (text,id,kind='secondary') => `<button class="${kind}" data-modal="${id}">${text}</button>`;
const row = (title,sub,target,cover=false) => `<button class="row" data-go="${target}">${cover?'<span class="cover" aria-hidden="true"></span>':''}<span class="body"><strong>${title}</strong><small>${sub}</small></span><span class="chevron" aria-hidden="true">›</span></button>`;
const field = (label,key,type='text',placeholder='') => `<label class="field">${label}${type==='textarea'?`<textarea data-field="${key}" placeholder="${placeholder}">${esc(values[current]?.[key])}</textarea>`:`<input data-field="${key}" type="${type}" value="${esc(values[current]?.[key])}" placeholder="${placeholder}">`}</label>`;
const tabs = entries => `<div class="tabs">${entries.map(([name,id])=>`<button data-go="${id}" class="${current===id?'on':''}">${name}</button>`).join('')}</div>`;
const channels = () => tabs([['长文','novel-community'],['中篇','community'],['短内容','short-community'],['关注','following-feed']]);
const authorTabs=()=>tabs([['中篇','my-works'],['短帖','my-short-posts'],['长文','novels']]);
const notice = text => `<div class="notice">${text}</div>`;
const submit = (label,target,required='') => `<button class="primary" data-submit="${target}" data-required="${required}">${label}</button><p class="error" role="alert" id="form-error"></p>`;
const article = (title='没有名字的车站') => `<h2>${title}</h2><p class="meta">林间 · 本页合成内容</p><div class="article"><p>末班列车离开以后，站台只剩下一盏灯。林间把写到一半的故事收进口袋，沿着铁轨旁的小路往回走。</p><p>远处的窗户亮了起来。她忽然想起，故事里的那个旅人，也是这样找到回家的方向。</p><p>“明天继续。”她在本子最后写下这句话。</p></div>`;
const contentRows = target => row('没有名字的车站','林间 · 日常　评论 12 · 收藏 3',target)+row('雨停之前','南风 · 生活　评论 8 · 收藏 2',target)+row('我们总会在某处重逢','青禾 · 幻想　评论 6 · 收藏 1',target)+row('第七次重启','木白 · 幻想　评论 2 · 收藏 0',target);
const reviewResult = () => `<h2>提交结果待确认</h2><p>先查询原请求，确认是否已经受理。</p>${action('查询原结果','publish-result','primary')}${action('稍后再查','my-works')}`;
function page(group,id,title,route,body,extra={}) {pages[id]={group,id,title,route,body,...extra};}

page('开始与账号','splash','Tako','/',()=>`<div class="profile"><h2>tako</h2><p>有脑洞，就开写。</p></div>${action('轻触进入','welcome','primary')}`);
page('开始与账号','welcome','欢迎','/welcome',()=>`<div class="profile"><div class="avatar">t</div><h2>读点喜欢的，写点自己的。</h2></div>${modal('登录 / 注册','login','primary')}${action('先逛逛','preferences')}`);
page('开始与账号','preferences','阅读偏好','/preferences',()=>`<h2>从喜欢的文字开始</h2>${row('短内容','日常、脑洞和图文分享','short-community')}${row('中篇','读完一个完整故事','community')}${row('长文','陪一个故事慢慢生长','novel-community')}`);
page('开始与账号','account','我的','/account',()=>`<div class="profile"><div class="avatar">林</div><h2>林间</h2><p class="meta">今天也写一点。</p><div class="stat"><button data-go="following">关注 18</button><button data-go="followers">关注者 26</button></div></div>${row('我的作品','中篇、短帖与长文','my-works')}${row('草稿箱','继续上次创作','drafts')}${row('我的书架','续读、追更与收藏','shelf')}${row('读者反馈','查看评论与回复','author-feedback')}${row('我的举报','查看处理进度','reports')}${row('周边订单','仅前端演示','orders')}${row('设置','','settings')}`);
page('开始与账号','settings','设置','规划子页',()=>`${row('编辑资料','笔名与个人介绍','profile-edit')}${row('阅读偏好','内容形态','preferences')}${row('账号与安全','账号信息、退出登录','security')}${row('关于 Tako','版本与反馈','about')}`);
page('开始与账号','profile-edit','编辑资料','account 内编辑态',()=>`${field('笔名','nickname','text','林间')}${notice('个人介绍、头像修改为设计提案，暂未接入。')}${submit('保存笔名','account','nickname')}`,{editable:true});
page('开始与账号','security','账号与安全','规划子页',()=>`${row('当前账号','demo@example.test','account')}${notice('这里只展示虚构账号，不提供真实密码输入。')}${modal('退出登录','logout','danger')}`);
page('开始与账号','about','关于 Tako','规划子页',()=>`<div class="profile"><div class="avatar">t</div><h2>Tako</h2><p>读点喜欢的，写点自己的。</p></div>${row('用户协议与隐私说明','内容待定稿','legal')}${row('问题反馈','仅预览反馈表单','help')}`);
page('开始与账号','legal','协议与隐私说明','规划子页',()=>notice('法律文本尚未定稿。本原型不请求同意协议、不收集个人数据。'));
page('开始与账号','help','问题反馈','规划子页',()=>`${field('遇到了什么问题','reason','textarea','请勿填写密码或个人信息')}${submit('预览提交结果','help-result','reason')}`);
page('开始与账号','help-result','反馈结果','规划子页',()=>`${notice('表单演示完成，未实际发送。')}${action('返回设置','settings')}`);

page('发现与阅读','community','社区','/community',()=>`${channels()}${action('搜索中篇','search')}${tabs([['最新','community'],['精选','featured']])}${contentRows('reader')}`,{bottom:'community'});
page('发现与阅读','featured','精选中篇','community 筛选态',()=>`${channels()}${contentRows('reader')}`,{bottom:'community'});
page('发现与阅读','search','搜索中篇','/search',()=>`${field('作品标题','query','search','搜索你想读的故事')}${submit('搜索','search-results','query')}${row('最近阅读','没有名字的车站','reader')}`);
page('发现与阅读','search-results','搜索结果','search 结果态',()=>`${action('修改关键词','search')}${contentRows('reader')}${modal('筛选','search-filter')}`);
page('发现与阅读','reader','中篇阅读','/works/[id]',()=>`${row('林间','查看作者','author-profile')}${article()}${tabs([['评论 12','comments'],['收藏','favorites'],['历史版本','reader-versions']])}${modal('更多','reader-more')}`);
page('发现与阅读','reader-versions','公开历史版本','works/[id] 内版本态',()=>`${notice('只显示作者已开放且当前可读的版本。')}${row('当前展示版','2026-11-16','reader')}${row('较早版本','2026-11-12','reader')}`);
page('发现与阅读','comments','评论','阅读页评论面板',()=>`${row('青禾','这个结尾让我想起了老家的车站。 · 2 条回复','thread')}${row('南风','明天也继续写吧。','thread')}${modal('写评论','comment','primary')}${action('我的评论','my-comments')}`);
page('发现与阅读','thread','评论与回复','评论线程面板',()=>`<h3>青禾</h3><p>这个结尾让我想起了老家的车站。</p><hr>${row('林间 · 作者','谢谢，故事的起点就是那座车站。','author-profile')}${modal('回复青禾','reply','primary')}${modal('删除我的回复','delete-comment','danger')}`);
page('发现与阅读','my-comments','我的评论','/my-comments',()=>`${tabs([['中篇','my-comments'],['长文章节','chapter-comments']])}${row('明天也继续写吧','没有名字的车站 · 2 小时前','thread')}${modal('删除评论','delete-comment','danger')}`);
page('发现与阅读','favorites','我的收藏','/favorites',()=>`${contentRows('reader')}${modal('取消收藏','unfavorite')}`);
page('发现与阅读','short-community','短内容','/short-community',()=>`${channels()}<div class="grid">${['雨后的街角','今天读到的句子','周末小记','窗外有风'].map(t=>`<div>${row(`<div class="photo">图文预览</div>${t}`,'林间 · 日常','short-reader')}</div>`).join('')}</div>`,{bottom:'community'});
page('发现与阅读','short-reader','短帖详情','/short-posts/[id]',()=>`${row('林间','查看作者','author-profile')}<div class="photo">原图预览</div><h2>雨后的街角</h2><p>拐过路口时，雨刚刚停。花店门前多了一只躲雨的小猫。</p>${modal('查看原图','image')}${action('公开版本','short-reader-versions')}${modal('更多','short-more')}`);
page('发现与阅读','short-reader-versions','短帖公开版本','short-posts/[id] 内版本态',()=>`${row('当前图文','版本 2','short-reader')}${row('早期图文','版本 1 · 已开放','short-reader')}`);
page('发现与阅读','novel-community','长文','/novel-community',()=>`${channels()}${action('搜索长文','novel-search')}${row('第七次重启','幻想 · 连载中 · 32 章','novel',true)}${row('星光之外','生活 · 已完结 · 18 章','novel',true)}`,{bottom:'community'});
page('发现与阅读','novel-search','搜索长文','/novel-search',()=>`${field('书名','query','search','搜索书名')}${submit('搜索','novel-search-results','query')}`);
page('发现与阅读','novel-search-results','长文搜索结果','novel-search 结果态',()=>`${action('修改关键词','novel-search')}${row('第七次重启','幻想 · 连载中','novel',true)}`);
page('发现与阅读','novel','书籍详情','/novel/[id]',()=>`<h2>第七次重启</h2>${row('林间','作者主页','author-profile')}<p>每次醒来，窗外的城市都不一样。</p>${action('开始阅读','chapter-reader','primary')}${modal('加入书架并追更','follow-book')}${row('目录','32 章 · 更新于今天','directory')}${row('作品公告','近期更新安排','notice')}`);
page('发现与阅读','directory','章节目录','novel/[id] 内目录态',()=>`${tabs([['正序','directory'],['续读','chapter-reader']])}${Array.from({length:8},(_,i)=>row(`第 ${i+1} 章 · ${i?'窗外的城市':'醒来'}`,i===3?'暂不可读':'已公开',i===3?'unavailable-content':'chapter-reader')).join('')}`);
page('发现与阅读','chapter-reader','章节阅读','/novel-chapter',()=>`${article('第一章 · 醒来')}${tabs([['目录','directory'],['下一章','chapter-reader'],['评论','chapter-comments']])}${modal('阅读设置','reader-settings')}${modal('保存阅读位置','reading-position')}`);
page('发现与阅读','chapter-comments','章节评论','/novel-comments；my-comments 长文态',()=>`${notice('第一章 · 醒来')}${row('南风','这个开头很吸引人。','thread')}${modal('写评论','comment','primary')}`);
page('发现与阅读','shelf','书架','/shelf',()=>`${tabs([['追更','shelf'],['中篇收藏','favorites']])}${row('第七次重启','读至第 3 章 · 最近更新第 32 章','chapter-reader',true)}${modal('书架管理','shelf-actions')}`,{bottom:'shelf'});

page('关注与消息','author-profile','作者主页','前端提案',()=>`<div class="profile"><div class="avatar">林</div><h2>林间</h2><p>把平凡的日子写成故事。</p></div>${modal('关注作者','follow-author','primary')}${tabs([['中篇','author-profile'],['长文','novel'],['短帖','short-reader']])}${contentRows('reader')}`);
page('关注与消息','following','我的关注','前端提案',()=>`${row('林间','最近更新：没有名字的车站','author-profile')}${row('南风','记录生活，也记录想象','author-profile')}${modal('管理关注','unfollow')}`);
page('关注与消息','followers','关注者','前端提案',()=>`${row('青禾','写点喜欢的故事','author-profile')}${row('木白','喜欢幻想和日常','author-profile')}`);
page('关注与消息','following-feed','关注动态','前端提案',()=>`${channels()}${row('林间发布了中篇','没有名字的车站 · 2 小时前','reader')}${row('南风更新了长文','第七次重启 · 第 32 章','chapter-reader')}`,{bottom:'community'});
page('关注与消息','notices','消息','/notices',()=>`${tabs([['作品公告','notices'],['互动','interaction-notices']])}${row('第七次重启','本周更新安排 · 今天','notice')}${row('举报处理结果','到我的举报查看原回执','report-detail')}`,{bottom:'notices'});
page('关注与消息','interaction-notices','互动消息','前端提案',()=>`${notice('互动通知尚未接入，以下仅展示版式。')}${row('青禾回复了你','“也期待你的下一篇。”','thread')}`,{bottom:'notices'});
page('关注与消息','notice','公告详情','/notice/[id]',()=>`<h2>本周更新安排</h2><p class="meta">第七次重启 · 林间</p><p>本周会继续更新新的章节，感谢大家的耐心阅读。</p>${action('返回书籍','novel')}`);

page('创作与草稿','create','开始创作','全局创作面板',()=>`${row('短内容','分享文字和图片','short-compose')}${row('中篇','写一个完整故事','drafts')}${row('长文','新建书籍、继续章节','novels')}`);
page('创作与草稿','drafts','中篇草稿','/drafts',()=>`${action('新建草稿','draft-editor','primary')}${row('没有名字的车站','已保存在本机 · 今天','draft-editor')}${row('窗边的旅人','等待同步 · 昨天','draft-editor')}${action('查看同步问题','sync')}`);
page('创作与草稿','draft-editor','写中篇','/drafts/[id]',()=>`${field('标题','title','text','没有名字的车站')}<label class="field">正文<textarea class="editor" data-field="content" placeholder="从一句话开始…">${esc(values[current]?.content||'末班列车离开以后，站台只剩下一盏灯。')}</textarea></label><p class="meta">演示草稿 · 当前页面内保留</p>${submit('保存并核对发布','publish','title')}${action('同步状态','sync')}`,{editable:true});
page('创作与草稿','sync','草稿同步','草稿列表/编辑状态',()=>`${row('窗边的旅人','本机修订尚未同步','sync-detail')}${row('没有名字的车站','同步完成','draft-editor')}`);
page('创作与草稿','sync-detail','同步详情','草稿冲突与锁定态',()=>`${notice('本机内容与服务端均有更新，请分别核对。')}${row('本机保留稿','当前设备的文字','draft-editor')}${row('服务端确认稿','已同步的文字','draft-editor')}${modal('保留为副本','conflict-copy','primary')}`);
page('创作与草稿','publish','核对发布','/publish',()=>`${tabs([['将发布的稿件','publish'],['当前正式版','publish-compare']])}${article()}${field('作品简介','intro','textarea','用一两句话介绍故事')}${modal('选择题材','tags')}${modal('固定预览','freeze-preview','primary')}`);
page('创作与草稿','publish-compare','修订核对','publish 对照态',()=>`${notice('当前正式版：R1　服务端工作稿：R2')}${article()}${action('返回将发布的稿件','publish')}`);
page('创作与草稿','publish-preview','固定预览','publish 固定预览态',()=>`${notice('核对这份固定内容后提交。')}${article()}<label class="check"><input type="checkbox" id="rights">我确认具有发布这份内容的权利</label><button class="primary" data-publish="publish-result">发布这份内容</button><p id="form-error" class="error" role="alert"></p>${action('返回修改','publish')}`);
page('创作与草稿','publish-result','发布结果','publish 结果态',()=>`${notice('演示：这份内容已正式发布。实际结果以服务端回执为准。')}${action('查看作品','reader','primary')}${action('管理作品','work-manage')}${action('返回草稿','drafts')}`);
page('创作与草稿','publish-recovery','确认原发布','publish 恢复态',reviewResult);
page('创作与草稿','short-compose','写短内容','/short-compose',()=>`${field('标题','title','text','给这次分享起个名字')}${field('正文','content','textarea','记录此刻的想法')}${modal('选择图片（最多 4 张）','photos')}${row('关联长文','可选','novel-picker')}${submit('核对图文','short-preview','title,content')}`,{editable:true});
page('创作与草稿','novel-picker','关联我的长文','short-compose 选择态',()=>`${row('不关联长文','','short-compose')}${row('第七次重启','本人当前可公开长文','short-compose',true)}`);
page('创作与草稿','short-preview','短帖固定预览','short-compose 预览态',()=>`${demoPhoto?'<div class="photo">所选图片预览</div>':''}<h2>${esc(values['short-compose']?.title||'雨后的街角')}</h2><p>${esc(values['short-compose']?.content||'雨停了，街角的花店亮起了灯。')}</p><label class="check"><input type="checkbox" id="rights">确认文字和图片发布权利</label><button class="primary" data-publish="short-result">提交发布</button><p class="error" id="form-error" role="alert"></p>${action('返回编辑','short-compose')}`);
page('创作与草稿','short-result','短帖提交结果','short-compose 结果态',()=>`${notice('演示结果：提交已确认。观察期作者的实际结果可能为待审核。')}${action('查看原提交','short-submissions','primary')}${action('管理短帖','short-manage')}`);

page('作者作品管理','my-works','我的中篇','/my-works',()=>`${authorTabs()}${field('搜索标题','query','search','查找本人作品')}${modal('筛选作品','work-filter')}${row('读者反馈','查看跨作品讨论','author-feedback')}${row('没有名字的车站','公开中　评论 12 · 收藏 3','work-manage')}${row('窗边的旅人','已隐藏　评论 2 · 收藏 1','work-manage')}`,{approved:true});
page('作者作品管理','work-manage','作品管理','/my-works/[id]',()=>`<h2>没有名字的车站</h2><p class="meta">公开中 · 评论 12 · 收藏 3</p>${row('修订发行','核对服务端工作稿','publish')}${row('内容与版本','核对和切换展示','work-versions')}${row('读者反馈','阅读和回复评论','work-feedback')}${row('提交记录','核对先审与发行结果','work-submissions')}${row('管理记录','查看历史操作','work-history')}${row('处置与复核','核对处置和复核进度','my-moderation')}${modal('隐藏作品','hide-work','danger')}`);
page('作者作品管理','work-versions','正式版本','作品详情内版本态',()=>`${row('当前展示 V2','2026-11-16 · 公开','version-compare')}${row('正式版 V1','2026-11-12 · 历史未开放','version-compare')}${modal('历史公开设置','history-public')}`);
page('作者作品管理','version-compare','核对展示版本','作品详情内对照态',()=>`${tabs([['当前展示 V2','version-compare'],['候选 V1','version-candidate']])}${article()}${action('核对候选版','version-candidate')}`);
page('作者作品管理','version-candidate','候选版本全文','作品详情内对照态',()=>`${notice('当前展示 V2 → 候选 V1')}${article()}${modal('设为展示版本','switch-version','primary')}`);
page('作者作品管理','work-history','管理记录','作品详情内记录态',()=>`${row('切换展示为 V2','2026-11-16 · 已确认','work-manage')}${row('恢复公开','2026-11-15 · 已确认','work-manage')}`);
page('作者作品管理','work-submissions','提交记录','/work-submissions',()=>`${row('修订 · 已通过','稿件 R2 · 原提交记录','submission-detail')}${row('首发 · 已发布','稿件 R1 · 原提交记录','submission-detail')}`);
page('作者作品管理','submission-detail','原提交内容','work-submissions 详情态',()=>`${notice('原提交结果：已通过。当前公开状态需另外核对。')}${article()}${action('管理当前作品','work-manage')}`);
page('作者作品管理','author-feedback','读者反馈','/author-feedback',()=>`${tabs([['待回应','author-feedback'],['全部','all-feedback']])}${row('青禾：这个结尾很温柔','没有名字的车站 · 2 条回复','work-feedback')}${row('南风：期待后续','雨停之前 · 0 条回复','work-feedback')}`);
page('作者作品管理','all-feedback','全部反馈','author-feedback 筛选态',()=>contentRows('work-feedback'));
page('作者作品管理','work-feedback','作品讨论','/my-work-feedback/[id]',()=>`${notice('没有名字的车站')}${row('青禾','这个结尾很温柔 · 2 条回复','thread')}${modal('回复读者','reply','primary')}`);
page('作者作品管理','my-short-posts','我的短帖','/my-short-posts',()=>`${authorTabs()}${row('雨后的街角','公开中','short-manage')}${row('今天读到的句子','待审核','short-manage')}`);
page('作者作品管理','short-manage','短帖管理','/my-short-posts/[id]',()=>`<h2>雨后的街角</h2><div class="photo">当前图文</div>${row('修改图文','准备同帖修订','short-compose')}${row('正式版本','核对并切换展示','short-versions')}${row('提交记录','首发与历次修订','short-submissions')}${row('处置与复核','','short-appeals')}${modal('隐藏短帖','hide-short','danger')}`);
page('作者作品管理','short-versions','短帖正式版本','短帖详情内版本态',()=>`${row('展示版 V2','原图文','short-version-detail')}${row('正式版 V1','历史未开放','short-version-detail')}`);
page('作者作品管理','short-version-detail','短帖版本核对','短帖详情内版本态',()=>`<div class="photo">所选版本原图</div><h2>雨后的街角</h2><p>这是所选正式版的原始文字。</p>${modal('切换为这份图文','switch-short','primary')}`);
page('作者作品管理','short-submissions','短帖提交记录','/my-short-posts/[id]/submissions',()=>`${row('修订已发布','原请求 V2','short-submission-detail')}${row('首发已发布','原请求 V1','short-submission-detail')}`);
page('作者作品管理','short-submission-detail','提交图文','短帖提交详情态',()=>`${notice('原回执：已发布') }<div class="photo">原提交图片</div><h2>雨后的街角</h2><p>原提交内容保留在此，不随之后的修订替换。</p>${action('继续修订','short-compose')}`);

page('长文创作管理','novels','我的长文','/novels',()=>`${authorTabs()}${modal('新建书籍','new-book','primary')}${row('第七次重启','32 章 · 连载中','novel-drafts',true)}${row('窗边的旅人','私密书籍 · 尚未发行','novel-drafts',true)}`);
page('长文创作管理','novel-drafts','章节草稿','/novel-drafts',()=>`<h2>第七次重启</h2>${action('新建章节','chapter-edit','primary')}${row('第 33 章 · 雨停之前','本机已保存','chapter-edit')}${row('正式管理','章节、资料与处置','novel-manage')}${row('编辑书籍资料','','book-edit')}`);
page('长文创作管理','book-edit','书籍资料','novels 资料编辑态',()=>`${field('书名','title','text','第七次重启')}${field('简介','intro','textarea','一句话介绍你的故事')}${submit('保存资料','novel-drafts','title')}`,{editable:true});
page('长文创作管理','chapter-edit','写章节','/chapter-edit',()=>`${field('章节标题','title','text','第三十三章 · 雨停之前')}${field('正文','content','textarea','开始写这一章…')}${submit('保存并核对','chapter-publish','title,content')}${action('同步状态','sync')}`,{editable:true});
page('长文创作管理','chapter-publish','核对章节发布','/chapter-publish',()=>`${notice('第七次重启 · 第 33 章 · 服务端已确认修订')}${article('第三十三章 · 雨停之前')}<label class="check"><input type="checkbox" id="rights">确认有权发布本章内容</label><button class="primary" data-publish="chapter-result">提交发布</button><p id="form-error" class="error" role="alert"></p>`,{approved:true});
page('长文创作管理','chapter-result','章节发布结果','chapter-publish 结果态',()=>`${notice('演示：提交已受理，正在等待审核。')}${action('查看原提交','chapter-submission','primary')}${action('继续写下一章','chapter-edit')}`);
page('长文创作管理','chapter-submission','章节提交记录','正式管理提交详情',()=>`${notice('当前原提交：待审核')}${article('第三十三章 · 雨停之前')}${modal('撤回待审提交','withdraw-chapter','danger')}`);
page('长文创作管理','novel-manage','长文正式管理','/novel-manage',()=>`<h2>第七次重启</h2>${tabs([['章节','novel-manage'],['书籍资料','novel-settings'],['处置与复核','novel-appeals']])}${row('第 33 章 · 雨停之前','待审','chapter-submission')}${row('第 32 章 · 城市之外','公开中','chapter-manage')}`,{approved:true});
page('长文创作管理','chapter-manage','正式章节管理','novel-manage 章节详情',()=>`${article('第三十二章 · 城市之外')}${row('正式版本','核对原内容和展示版','chapter-versions')}${row('章节评论','','chapter-comments')}${modal('隐藏章节','hide-chapter','danger')}`);
page('长文创作管理','chapter-versions','章节版本','novel-manage 版本态',()=>`${row('展示版 V2','当前公开','chapter-version-detail')}${row('正式版 V1','已归档','chapter-version-detail')}`);
page('长文创作管理','chapter-version-detail','章节版本核对','novel-manage 对照态',()=>`${article('第三十二章 · 城市之外')}${modal('切换章节展示版','switch-chapter','primary')}`);
page('长文创作管理','novel-settings','正式书籍资料','novel-manage 资料态',()=>`${row('基础资料','书名、简介','book-edit')}${row('作品公告','发布、查看、撤回','author-notices')}${row('完结核对','核对章节与待审事项','completion')}${modal('隐藏整本书','hide-book','danger')}`);
page('长文创作管理','author-notices','我的作品公告','novel-manage 公告态',()=>`${action('写公告','notice-compose','primary')}${row('本周更新安排','已发布','author-notice-detail')}`);
page('长文创作管理','notice-compose','写作品公告','novel-manage 公告编辑态',()=>`${field('标题','title')}${field('公告正文','content','textarea')}${submit('预览公告','notice-preview','title,content')}`,{editable:true});
page('长文创作管理','notice-preview','核对公告','novel-manage 公告预览态',()=>`<h2>${esc(values['notice-compose']?.title||'本周更新安排')}</h2><p>${esc(values['notice-compose']?.content||'本周继续更新新的章节。')}</p>${modal('发布公告','publish-notice','primary')}`);
page('长文创作管理','author-notice-detail','公告管理','novel-manage 公告详情态',()=>`<h2>本周更新安排</h2><p>本周继续更新新的章节。</p>${modal('撤回公告','withdraw-notice','danger')}`);
page('长文创作管理','completion','完结前核对','novel-manage 完结态',()=>`${row('公开章节','32 章','novel-manage')}${row('待审内容','1 项，先处理','chapter-submission')}${notice('待办未解决前不能完成完结操作。')}${action('返回章节处理','novel-manage','primary')}`);

page('举报与复核','reports','我的举报','/content-reports',()=>`${tabs([['中篇','reports'],['短帖','short-reports']])}${row('没有名字的车站','核查中 · 今天','report-detail')}${row('雨停之前','已结案 · 昨天','report-detail')}`);
page('举报与复核','short-reports','短帖举报记录','content-reports kind=short-post',()=>`${tabs([['中篇','reports'],['短帖','short-reports']])}${row('雨后的街角','已结案','report-detail')}`);
page('举报与复核','report-compose','举报内容','content-reports 提交态',()=>`${notice('举报：当前读取的正式版本')}${field('举报说明','reason','textarea','具体哪里存在问题')}${submit('提交举报','report-submitted','reason')}`,{editable:true});
page('举报与复核','report-submitted','举报已提交','content-reports 提交结果',()=>`${notice('演示：举报已受理，不代表内容会被限制。')}${action('查看处理进度','report-detail','primary')}${action('返回阅读','reader')}`);
page('举报与复核','report-detail','举报详情','content-reports 详情态',()=>`<h2>已核查</h2><p class="meta">举报 #1 · 原正式版本</p><h3>我的说明</h3><p>请核查这份内容中的具体问题。</p><h3>处理回执</h3><p>已核查并按治理规则处理。</p>${action('查看当前公开内容','unavailable-content')}${action('返回举报记录','reports')}`);
page('举报与复核','unavailable-content','内容不可用','阅读权限态',()=>`<div class="empty"><h2>这份内容暂时无法阅读</h2><p>可能已隐藏、限制或未开放。</p>${action('返回社区','community')}</div>`);
page('举报与复核','my-moderation','中篇处置与复核','/my-moderation',()=>`${row('没有名字的车站','当前展示版本受限','appeal-detail')}`);
page('举报与复核','short-appeals','短帖处置与复核','/my-short-posts/[id]/appeals',()=>`${row('雨后的街角','原版本受限','appeal-detail')}`);
page('举报与复核','novel-appeals','长文处置与复核','novel-manage 复核态',()=>`${row('第 32 章','正式章节受限','appeal-detail')}${row('整改授权','允许提交的整改范围','rectification')}`);
page('举报与复核','appeal-detail','处置详情','三类内容处置详情态',()=>`<h2>版本受限</h2><h3>处置原因</h3><p>请核对原正式内容中的具体问题。</p>${row('原内容','查看被处置的版本','appeal-evidence')}${action('申请复核','appeal-compose','primary')}${row('复核记录','已受理、维持或撤销','appeal-history')}`);
page('举报与复核','appeal-evidence','原处置内容','处置证据态',()=>`${notice('仅核对原正式版，不读取本机草稿。')}${article()}`);
page('举报与复核','appeal-compose','申请复核','复核填写态',()=>`${field('复核说明','reason','textarea','说明你希望重新核查的具体问题')}${submit('提交复核','appeal-history','reason')}`,{editable:true});
page('举报与复核','appeal-history','复核进度','复核结果/历史态',()=>`${notice('演示：申请已受理，等待核查。')}${row('原申请','查看提交说明','appeal-detail')}${action('刷新原结果','appeal-history')}`);
page('举报与复核','rectification','授权整改','长文章节整改态',()=>`${notice('原处置仍有效，仅可在已授权范围内提交整改。')}${field('整改正文','content','textarea','填写整改后的章节内容')}${submit('核对整改稿','rectification-preview','content')}`,{editable:true});
page('举报与复核','rectification-preview','整改稿核对','长文章节整改预览态',()=>`${article('整改后的章节')}${modal('提交授权整改','rectification-submit','primary')}`);

page('周边（前端提案）','merch','周边','前端提案',()=>`${notice('周边为前端提案，品类、价格、库存、运费及售后规则待确认。')}${tabs([['全部','merch'],['我的订单','orders']])}<div class="grid">${['Tako 故事手册','角色明信片'].map(t=>`<div>${row(`<div class="photo">商品示意</div>${t}`,'示意商品 · 未定价','product')}</div>`).join('')}</div>`,{bottom:'merch'});
page('周边（前端提案）','product','商品详情','前端提案',()=>`<div class="photo">Tako 故事手册 · 商品示意</div><h2>Tako 故事手册</h2><p>把脑洞留在纸上。</p><p class="meta">价格、规格与库存待定</p>${modal('选择规格','sku','primary')}${row('配送和售后','规则待确认','shipping-rules')}`);
page('周边（前端提案）','checkout','核对订单','前端提案',()=>`${row('收货地址','仅示例地址，请勿输入真实信息','addresses')}${row('Tako 故事手册','示例规格 × 1','product')}${notice('商品金额、运费与总计尚未定价。')}${action('预览下单结果','order-pending','primary')}`);
page('周边（前端提案）','addresses','收货地址','前端提案',()=>`${row('示例收件人','演示地区 · 非真实地址','checkout')}${action('新增演示地址','address-edit')}`);
page('周边（前端提案）','address-edit','编辑演示地址','前端提案',()=>`${notice('只填写虚构信息，关闭原型即清除。')}${field('演示收件人','name')}${field('演示地区','region')}${field('演示详细地址','address')}${submit('保存示例','addresses','name,region,address')}`,{editable:true});
page('周边（前端提案）','orders','我的订单','前端提案',()=>`${tabs([['全部','orders'],['待处理','order-pending'],['售后','after-sale']])}${row('Tako 故事手册','演示订单 · 待付款','order-pending')}${row('角色明信片','演示订单 · 已发货','order-shipped')}`);
page('周边（前端提案）','order-pending','订单待付款','前端提案',()=>`${notice('示例订单，尚未创建交易。')}${row('Tako 故事手册','数量 1 · 金额待定','product')}${modal('预览付款面板','payment','primary')}${modal('取消演示订单','cancel-order')}`);
page('周边（前端提案）','order-shipped','订单详情','前端提案',()=>`<h2>示例：已发货</h2>${row('物流进度','查看示例轨迹','logistics')}${row('角色明信片','演示商品','product')}${modal('预览确认收货','received','primary')}${action('售后申请','after-sale')}`);
page('周边（前端提案）','logistics','物流详情','前端提案',()=>`${notice('以下轨迹为示例，未查询物流公司。')}<h3>运输中</h3><p>示例：包裹已发出。</p><h3>已揽收</h3><p>示例：仓库完成交接。</p>`);
page('周边（前端提案）','after-sale','申请售后','前端提案',()=>`${notice('售后资格、时限与退款规则待确认。')}${field('问题说明','reason','textarea','请用虚构内容演示')}${submit('预览申请结果','after-sale-detail','reason')}`);
page('周边（前端提案）','after-sale-detail','售后进度','前端提案',()=>`${notice('示例：申请待受理。未实际发起退款。')}${action('返回订单','orders')}`);
page('周边（前端提案）','shipping-rules','配送与售后','前端提案',()=>notice('配送范围、运费、退换条件均待业务确认。原型不作购买承诺。'));

const dialogs = {
  login:['登录 Tako',()=>`${field('演示邮箱','email','email','demo@example.test')}${field('演示口令（勿用真实密码）','demo','text','任意演示文字')}${submit('演示登录','account','email,demo')}${modal('去注册','register')}`],
  register:['创建演示账号',()=>`${field('演示笔名','name')}${field('演示邮箱','email','email')}${submit('预览注册完成','account','name,email')}`],
  create:['开始创作',()=>pages.create.body()],
  'work-filter':['筛选作品',()=>`<label class="field">作者状态<select><option>全部</option><option>未隐藏</option><option>已隐藏</option></select></label><label class="field">平台状态<select><option>全部</option><option>未受限</option><option>受限</option></select></label>${action('应用筛选','my-works','primary')}`],
  'search-filter':['题材筛选',()=>`<label class="field">题材<select><option>全部</option><option>日常</option><option>幻想</option></select></label>${action('应用','search-results','primary')}`],
  'reader-more':['阅读选项',()=>`${action('举报当前内容','report-compose')}${action('公开历史版本','reader-versions')}${modal('分享','share')}`],
  'short-more':['短帖选项',()=>`${action('举报当前图文','report-compose')}${action('公开版本','short-reader-versions')}${modal('分享','share')}`],
  share:['分享内容',()=>`<p>分享展示为本地预览，不生成真实链接。</p>${action('返回阅读','reader')}`],
  comment:['写评论',()=>`${field('评论','comment','textarea','分享你的想法')}${submit('发表演示评论','thread','comment')}`],
  reply:['回复青禾',()=>`${field('回复','comment','textarea','写下回复')}${submit('发表演示回复','thread','comment')}`],
  image:['查看原图',()=>'<div class="photo" style="height:320px">原图示意 · 1 / 1</div>'],
  photos:['选择配图',()=>`<p>最多 4 张，原型使用示意图，不读取你的相册。</p><div class="photo">演示图片</div><button class="primary" data-photo>使用演示图</button>`],
  tags:['选择题材',()=>`<label class="field">作品题材<select><option>日常</option><option>幻想</option><option>生活</option></select></label>${action('完成选择','publish','primary')}`],
  'new-book':['新建书籍',()=>`${field('书名','book')}${submit('创建演示书籍','novel-drafts','book')}`],
  'reader-settings':['阅读设置',()=>`<label class="field">字号<select id="font-setting"><option value="18">标准</option><option value="20">大</option><option value="22">更大</option></select></label>${action('完成','chapter-reader','primary')}`],
  'reading-position':['续读位置',()=>`<p>第三章 · 当前段落</p>${action('返回书架','shelf','primary')}`],
  'shelf-actions':['管理书架',()=>`${modal('停止追更','unfollow-book')}${modal('移出书架','remove-book')}`],
  sku:['商品规格',()=>`<label class="field">示例规格<select><option>基础款（示例）</option><option>纪念款（示例）</option></select></label><label class="field">数量<input type="number" min="1" max="9" value="1"></label>${action('核对演示订单','checkout','primary')}`],
  payment:['付款面板预览',()=>`${notice('没有支付通道，不扣款、不创建订单。')}${action('返回订单','order-pending')}`],
};
const confirmations = [
 ['logout','退出登录？','未同步的草稿会锁定，使用原账号登录后才能继续。','退出演示账号','welcome'],
 ['leave','离开编辑？','未提交的内容只在这次原型会话内保留。','离开','account'],
 ['delete-comment','删除这条评论？','实际业务中删除不可恢复。原型不删除真实内容。','删除演示评论','comments'],
 ['unfavorite','取消收藏？','之后仍可重新收藏。','取消收藏','favorites'],
 ['follow-author','关注林间？','关注关系和动态通知尚未接入，本次只演示。','演示关注','following'],
 ['unfollow','取消关注？','原型不会修改真实关注关系。','演示取消关注','following'],
 ['follow-book','加入书架并追更？','保留续读位置，接收作品更新。','演示加入','shelf'],
 ['unfollow-book','停止追更？','作品继续留在书架，已有消息保留。','停止追更','shelf'],
 ['remove-book','移出书架？','同时关闭追更，续读位置和已有消息保留。','移出书架','shelf'],
 ['conflict-copy','保留冲突副本？','分别保留本机文字和服务端内容，后续自行核对。','保留副本','drafts'],
 ['freeze-preview','固定这份预览？','预览绑定服务端已确认修订，之后改稿不会改动这份预览。','查看固定预览','publish-preview'],
 ['hide-work','隐藏作品？','停止新读者访问，之后可恢复。平台限制不会因此解除。','隐藏作品','work-manage'],
 ['hide-short','隐藏短帖？','短帖文字和图片停止公开访问。','隐藏短帖','short-manage'],
 ['hide-chapter','隐藏章节？','目录保留不可读状态，之后可恢复。','隐藏章节','chapter-manage'],
 ['hide-book','隐藏整本书？','目录及章节入口不可公开读取，之后可恢复。','隐藏书籍','novel-settings'],
 ['switch-version','切换展示版本？','后续读者打开候选 V1；不会改写草稿。','切换为 V1','work-manage'],
 ['switch-short','切换展示图文？','文字与配图一起切换至核对的正式版。','切换图文','short-manage'],
 ['switch-chapter','切换章节展示版？','后续读者读取所选正式版本。','切换章节','chapter-manage'],
 ['history-public','开放历史版本？','仅开放符合当前公开条件的正式版本。','演示开放','work-versions'],
 ['withdraw-chapter','撤回待审提交？','保留原提交记录，不撤回已经发布的章节。','撤回提交','novel-manage'],
 ['publish-notice','发布作品公告？','关注这本书的读者可查看。原型不会发送消息。','预览发布结果','author-notice-detail'],
 ['withdraw-notice','撤回公告？','读者将无法继续查看公告正文。','演示撤回','author-notices'],
 ['rectification-submit','提交这份整改稿？','原处置不会自动解除，等待审核结果。','提交演示稿','appeal-history'],
 ['cancel-order','取消演示订单？','没有真实交易会被取消。','演示取消','orders'],
 ['received','确认收货预览','真实业务中的结算及售后影响尚待确定。','结束演示','orders'],
];
for(const [id,title,desc,label,target] of confirmations)dialogs[id]=[title,()=>`<p>${desc}</p>${action(label,target,id.startsWith('hide')||id==='delete-comment'?'danger':'primary')}`];

function catalog(){const query=document.querySelector('#catalog-search').value.trim();let group='';document.querySelector('#catalog').innerHTML=Object.values(pages).filter(p=>!query||p.title.includes(query)||p.route.includes(query)).map(p=>{const h=p.group!==group?`<h2>${esc(p.group)}</h2>`:'';group=p.group;return h+`<button data-go="${p.id}" class="${p.id===current?'selected':''}">${p.title}</button>`}).join('')+`<h2>弹窗与确认（${Object.keys(dialogs).length}）</h2>`+Object.entries(dialogs).filter(([,v])=>!query||v[0].includes(query)).map(([id,v])=>`<button data-modal="${id}">${v[0]}</button>`).join('');}
function stateView(){
 const variants={empty:['这里还没有内容','从相关入口开始，或清除筛选条件。'],error:['暂时没能加载','请检查网络后重试。'],guest:['登录后继续','你的草稿和记录仅对自己可见。'],denied:['暂时无法访问','内容可能未开放、已隐藏或受到限制。'],offline:['当前处于离线状态','已保存的本机稿件可按原账号授权继续编辑。']};
 if(state==='ready')return pages[current].body();
 if(state==='loading')return '<div aria-label="正在加载"><div class="skeleton large"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton large"></div></div>';
 if(state==='uncertain'){const target=current.includes('short')?'short-submissions':current.includes('chapter')?'chapter-submission':current.includes('report')?'report-detail':current.includes('appeal')?'appeal-history':'publish-recovery';return `<h2>结果待确认</h2><p>保留原操作，先查询是否已受理。</p>${action('查看原记录',target,'primary')}`;}
 const [title,body]=variants[state];return `<div class="empty"><h2>${title}</h2><p>${body}</p>${state==='guest'?modal('演示登录','login','primary'):`<button class="primary" data-ready>${state==='empty'?'返回正常示例':'重新加载示例'}</button>`}</div>`;
}
function render(){const p=pages[current];document.querySelector('#bottom').hidden=!(p.bottom||['account','shelf'].includes(current));document.querySelector('#header').innerHTML=`<button data-back aria-label="返回">‹ 返回</button><h1>${p.title}</h1><button data-modal="create" aria-label="开始创作">＋</button>`;document.querySelector('#page').innerHTML=stateView();document.querySelector('#bottom').innerHTML=[['community','社区'],['merch','周边'],['create','＋'],['notices','消息'],['account','我的']].map(([id,title])=>`<button ${id==='create'?'data-modal':'data-go'}="${id}" class="${id==='create'?'create':p.bottom===id||current===id?'on':''}">${title}</button>`).join('');document.querySelector('#page-note').textContent=`${p.route} · ${p.approved?'沿用已确认布局':'待评审布局'} · 所有数据为演示`;document.querySelector('#coverage').textContent=`${Object.keys(pages).length} 页面 / ${Object.keys(dialogs).length} 弹窗`;document.querySelector('#state').value=state;catalog();}
function go(id,push=true){if(!pages[id])throw Error('Unknown page '+id);close();if(push&&id!==current)trail.push(current);current=id;state='ready';history.replaceState(null,'','#'+id);render();document.querySelector('#page').scrollTop=0;}
function show(id){if(!dialogs[id])throw Error('Unknown dialog '+id);lastFocus=document.activeElement;const [title,body]=dialogs[id],el=document.querySelector('#overlay');el.innerHTML=`<section class="sheet" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1"><div class="split"><h2 id="dialog-title">${title}</h2><button class="close" data-close aria-label="关闭弹窗">×</button></div>${body()}</section>`;el.hidden=false;document.querySelector('#page').inert=true;document.querySelector('#header').inert=true;document.querySelector('#bottom').inert=true;el.querySelector('.sheet').focus();}
function close(){const overlay=document.querySelector('#overlay');overlay.hidden=true;overlay.innerHTML='';for(const id of ['page','header','bottom'])document.querySelector('#'+id).inert=false;if(lastFocus?.isConnected)lastFocus.focus();}
function toast(text){clearTimeout(toastTimer);const el=document.querySelector('#toast');el.textContent=text;el.hidden=false;toastTimer=setTimeout(()=>el.hidden=true,3000);}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b){if(e.target.id==='overlay')close();return}if(b.hasAttribute('data-close'))return close();if(b.hasAttribute('data-photo')){demoPhoto=true;go('short-compose');toast('已选用演示图');return}if(b.hasAttribute('data-back')){const target=trail.pop()||'account';if(pages[current].editable&&Object.values(values[current]||{}).some(Boolean)){dialogs.leave[1]=()=>`<p>当前输入在原型会话内保留，刷新即清除。</p>${action('离开编辑',target,'danger')}`;show('leave')}else go(target,false);return}if(b.dataset.modal)return show(b.dataset.modal);if(b.dataset.go)return go(b.dataset.go);if(b.hasAttribute('data-ready')){state='ready';render();return}if(b.dataset.publish){if(!document.querySelector('#rights')?.checked){document.querySelector('#form-error').textContent='请先核对并勾选发布权利。';return}go(b.dataset.publish);toast('演示完成，未向服务端提交。');return}if(b.dataset.submit){const required=b.dataset.required.split(',').filter(Boolean),missing=required.some(k=>!values[current]?.[k]?.trim());const root=b.closest('.sheet')||document.querySelector('#page');if(missing){root.querySelector('#form-error').textContent='请填写必填项。';return}go(b.dataset.submit);toast('演示完成，未向服务端提交。');}});
document.addEventListener('input',e=>{if(e.target.dataset.field){(values[current]??={})[e.target.dataset.field]=e.target.value;}if(e.target.id==='catalog-search')catalog();});
document.querySelector('#state').addEventListener('change',e=>{state=e.target.value;render()});
document.querySelector('#size').addEventListener('change',e=>document.documentElement.style.setProperty('--width',e.target.value+'px'));
document.addEventListener('keydown',e=>{const overlay=document.querySelector('#overlay');if(overlay.hidden)return;if(e.key==='Escape'){close();return}if(e.key==='Tab'){const nodes=[...overlay.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(el=>!el.disabled),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement.classList.contains('sheet'))){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}});
if(pages[location.hash.slice(1)])current=location.hash.slice(1);
render();
