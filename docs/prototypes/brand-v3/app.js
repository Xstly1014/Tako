const $=s=>document.querySelector(s);
let currentView='login',sent=false,busy=false,sendTimer,blinkTimer,blinkEnd,faceState='open';
const media=matchMedia('(prefers-reduced-motion: reduce)');
const face=$('#face');
['open','closed'].forEach(state=>{const image=new Image();image.src=`assets/lean-${state}.png`;});
const reduced=()=>media.matches||$('#reduce').checked;
function expression(state){faceState=state;face.src=`assets/lean-${state}.png`;face.dataset.expression=state;}
function stopBlink(){clearTimeout(blinkTimer);clearTimeout(blinkEnd);expression('open');}
function scheduleBlink(){clearTimeout(blinkTimer);if(reduced()||document.hidden||currentView!=='login')return;blinkTimer=setTimeout(()=>{expression('closed');blinkEnd=setTimeout(()=>{expression('open');scheduleBlink();},160);},6500);}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{currentView=b.dataset.view;document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==currentView);document.querySelectorAll('[data-view]').forEach(t=>t.setAttribute('aria-pressed',String(t===b)));stopBlink();scheduleBlink();});
document.addEventListener('visibilitychange',()=>{stopBlink();scheduleBlink();});media.addEventListener('change',()=>{stopBlink();scheduleBlink();});
$('#reduce').onchange=()=>{document.body.classList.toggle('reduced',$('#reduce').checked);stopBlink();scheduleBlink();};
$('#email').onfocus=()=>{stopBlink();scheduleBlink();};
$('#code').onfocus=()=>{stopBlink();if(!reduced())expression('closed');};
$('#code').onblur=()=>{stopBlink();scheduleBlink();};
face.onerror=()=>{face.hidden=true;$('#art-fallback').hidden=false;};
$('#no-art').onchange=()=>{face.hidden=$('#no-art').checked;$('#art-fallback').hidden=!$('#no-art').checked;};
function message(copy,error=false){$('#form-message').textContent=copy;$('#form-message').classList.toggle('error',error);}
function emailValid(){const valid=$('#email').validity.valid&&$('#email').value.trim().length>0;$('#email').setAttribute('aria-invalid',String(!valid));if(!valid){message('请填写完整邮箱地址，例如 name@example.com。',true);$('#email').focus();}return valid;}
$('#email').oninput=()=>{$('#email').removeAttribute('aria-invalid');if(sent){sent=false;clearTimeout(sendTimer);$('#send').textContent='发送验证码';$('#send').disabled=false;}};
$('#send').onclick=()=>{if(busy||!emailValid())return;busy=true;$('#send').disabled=true;$('#send').textContent='发送中…';message('正在模拟发送，不会投递真实邮件。');sendTimer=setTimeout(()=>{busy=false;if($('#fail').checked){$('#send').disabled=false;$('#send').textContent='重新发送';message('邮件暂时未能发出，请重试。',true);return;}sent=true;$('#send').textContent='稍后重发';message('样稿验证码为 123456，未发送真实邮件。');sendTimer=setTimeout(()=>{$('#send').disabled=false;$('#send').textContent='重新发送';},5000);},650);};
$('#login-form').onsubmit=e=>{e.preventDefault();if(busy||!emailValid())return;if(!sent){message('请先发送验证码。',true);$('#send').focus();return;}if($('#code').value!=='123456'){$('#code').setAttribute('aria-invalid','true');message('验证码不正确。样稿请填写 123456。',true);$('#code').focus();return;}$('#code').removeAttribute('aria-invalid');message('登录交互完成。正式账号状态没有变化。');stopBlink();if(!reduced()){expression('closed');blinkEnd=setTimeout(()=>{expression('open');scheduleBlink();},500);}};
$('#code').oninput=()=>$('#code').removeAttribute('aria-invalid');
$('#reset-login').onclick=()=>{clearTimeout(sendTimer);sent=false;busy=false;$('#login-form').reset();$('#send').disabled=false;$('#send').textContent='发送验证码';$('#email').removeAttribute('aria-invalid');$('#code').removeAttribute('aria-invalid');message('使用邮箱验证码登录，无需设置密码。');stopBlink();scheduleBlink();};
function notice(copy){$('#notice-copy').textContent=copy;$('#notice').showModal();}
$('#terms-link').onclick=e=>{e.preventDefault();notice('这里仅演示协议入口。正式登录沿用现有用户协议与隐私政策。');};$('#close-notice').onclick=()=>$('#notice').close();
$('#draft-btn').onclick=()=>{$('#draft-message').textContent='工作稿仍是原来的内容，选择发布节点不会覆盖它。';};
const paragraphs=[
 '我下晚课的时候，末班车还停在站台。\n\n司机问：“星期八，去不去？”\n\n我看了眼明天的早八，决定先问问票价。',
 '“学生票半价。”司机指了指门边的牌子。\n\n我刷了校园卡。机器响了一声：余额不足。\n\n连通往异世界的公交车都不放过我的饭卡。',
 '车里只有三个人。一个抱着没写完的实验报告，一个戴着耳机睡觉，还有一个正在研究怎么把星期八加进课表。\n\n我坐到最后一排。窗外的学校慢慢变成了海。'
];
let selected=5,displayed=5,windowStart=0;
function versions(){const n=$('#many').checked?24:5;return Array.from({length:n},(_,i)=>({id:i+1,restricted:i===2,title:'末班车开往星期八',body:paragraphs[i%3],date:`2026-10-${String(Math.min(30,i+4)).padStart(2,'0')} 21:30`,note:i?'调整了对话和结尾。':'首次发布。'}));}
function reader(){return $('#reader').checked;}
function visible(){return versions().filter(v=>!reader()||!v.restricted);}
function windowSize(){return innerWidth<768?4:7;}
function render(focusNode=false){let all=visible();if(!all.some(v=>v.id===selected))selected=displayed;const count=windowSize();windowStart=Math.max(0,Math.min(windowStart,Math.max(0,all.length-count)));const slice=all.slice(windowStart,windowStart+count);$('#rail').replaceChildren();slice.forEach(v=>{const b=document.createElement('button');b.className=`node${v.id===selected?' selected':''}${v.id===displayed?' public':''}${v.restricted?' restricted':''}`;b.id=`node-${v.id}`;b.type='button';b.role='tab';b.tabIndex=v.id===selected?0:-1;b.setAttribute('aria-selected',String(v.id===selected));b.setAttribute('aria-controls','version-panel');b.setAttribute('aria-label',`版本 ${v.id}，${v.date}${v.restricted?'，受限':''}${v.id===displayed?'，读者正在看':''}`);b.innerHTML='<span class="dot"></span>';b.onclick=()=>{selected=v.id;render(true);};b.onkeydown=e=>{let ix=all.findIndex(x=>x.id===selected);if(e.key==='ArrowRight')ix=Math.min(all.length-1,ix+1);else if(e.key==='ArrowLeft')ix=Math.max(0,ix-1);else if(e.key==='Home')ix=0;else if(e.key==='End')ix=all.length-1;else return;e.preventDefault();selected=all[ix].id;if(ix<windowStart)windowStart=ix;if(ix>=windowStart+count)windowStart=ix-count+1;render(true);};$('#rail').append(b);});
// A window without the selected node still needs one keyboard entry point.
if(!slice.some(v=>v.id===selected)&&$('#rail').firstChild)$('#rail').firstChild.tabIndex=0;
$('#prev').disabled=windowStart===0;$('#next').disabled=windowStart+count>=all.length;$('#range').textContent=`${windowStart+1}–${Math.min(windowStart+count,all.length)} / ${all.length}`;
const v=versions().find(x=>x.id===selected),blocked=reader()&&selected!==displayed&&!$('#history').checked;
$('#version-panel').setAttribute('aria-label',`版本 ${selected} 预览`);if(slice.some(x=>x.id===selected))$('#version-panel').setAttribute('aria-labelledby',`node-${selected}`);else $('#version-panel').removeAttribute('aria-labelledby');
$('#status').textContent=v.restricted?'受限 · 仅作者可见':selected===displayed?'读者正在看的版本':'历史版本预览';$('#version-title').textContent=blocked?'历史正文未开放':v.title;$('#body-text').textContent=blocked?'作者尚未开启历史阅读。你仍可阅读当前公开展示的版本。':v.restricted?'该版本对读者不可见。作者可以查看、导出并申请复核。\n\n示例处置原因：存在需要人工复核的内容。':v.body;
$('#version-number').textContent=`V${v.id}`;$('#version-date').textContent=v.date;$('#version-note').textContent=v.note;$('#set-display').hidden=reader();$('#set-display').disabled=v.restricted||selected===displayed;$('#set-display').textContent=selected===displayed?'正在展示':'设为读者展示';$('#attention').hidden=reader();$('#history-label').hidden=reader();$('#view-title').textContent=reader()?'阅读记录':'发布记录';$('#action-message').textContent='';if(focusNode)$(`#node-${selected}`)?.focus();}
$('#prev').onclick=()=>{windowStart-=windowSize();render();};$('#next').onclick=()=>{windowStart+=windowSize();render();};$('#locate').onclick=()=>{selected=3;windowStart=0;render(true);};
$('#set-display').onclick=()=>{$('#confirm-copy').textContent=`读者将看到当前预览的版本 V${selected}。作品链接保持不变。`;$('#confirm').showModal();};$('#cancel').onclick=()=>$('#confirm').close();$('#confirm-display').onclick=()=>{displayed=selected;$('#confirm').close();render();$('#action-message').textContent='读者展示已更换。工作稿保持原样。';$('#set-display').focus();};
$('#history').onchange=()=>{render();$('#action-message').textContent=$('#history').checked?'已开放所有正常历史版本；受限版本仍不可见。':'已关闭历史正文阅读。';};$('#reader').onchange=()=>{windowStart=0;if(selected===3)selected=displayed;render();};$('#many').onchange=()=>{selected=$('#many').checked?24:5;displayed=selected;windowStart=Math.max(0,visible().length-windowSize());render();};$('#reset-timeline').onclick=()=>{$('#many').checked=false;$('#reader').checked=false;$('#history').checked=false;selected=displayed=5;windowStart=0;render();};let resizeTimer;addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>render(),100);});render();scheduleBlink();
