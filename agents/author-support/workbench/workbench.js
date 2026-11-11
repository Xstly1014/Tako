'use strict';
const $=selector=>document.querySelector(selector);
const labels={complete:'检查完整',incomplete:'检查未完整',changed:'核验期间有变更',pending:'待处理',decided:'已有决定',
  unavailable:'未能读取',rescan_required:'需重新扫描',unchecked:'未核对',pre_review:'发行前审',post_review:'发行后审',appeal:'作者复核',
  empty:'未设置',selected_readable:'读者可见',selection_stale:'恢复后待重选',excluded_unreadable:'已排除不可读作品',observed_mismatch:'展示不一致',
  approved:'通过',restricted:'限制',upheld:'维持',revoked:'撤销',superseded:'已被替换',rejected:'驳回',published:'已发行'};
const errors={job_running:'已有检查在运行，请等待或停止当前检查。',invalid_period:'请选择有效的复盘日期，起日应早于截至日期。',
  period_not_started:'起日尚未到来，请选择已经开始的周期。',invalid_acknowledgment:'接收人请用 1—32 位字母、数字、下划线或短横线。',
  shift_changed:'班次已有新结果，请重新打开核对后再交班。',shift_incomplete:'本班检查尚未完整，请先续查。',
  period_still_open:'报表周期尚未结束，暂不能作周期对照。',periods_not_comparable:'请选择按时间先后、不重叠且等长的两个周期。',
  report_version_mismatch:'两份报表口径不一致，请选择当前口径的报表。',report_not_comparable:'请选择两份完整的周期报表。',
  local_session_required:'本地会话已失效，请刷新页面后重试。',test_operator_required:'本机未配置测试运营凭据，请按启动说明配置。',
  operator_logout_failed:'检查结果已保留，但退出运营会话失败。请检查本地服务。',operation_failed:'检查未完成，请确认本地服务可用后重试。',
  operator_rate_limited:'运营认证已限频，请等待服务端窗口结束后再手动重试。',operator_access_denied:'运营身份或权限校验失败，请检查本地凭据与账号权限。',
  shift_scan_incomplete:'两班的积压扫描必须完整，请先续查对应班次。',shifts_not_comparable:'请选择扫描时间先后明确的两个不同班次。',
  reconciliation_target_changed:'同一任务的定位信息不一致，暂不能对账，请重新检查班次来源。',
  reconciliation_changed:'对账记录已有更新，请重新打开后续查。',reconciliation_not_found:'没有找到这份对账，请刷新记录。',
  job_cancelled:'检查已停止，可从班次记录继续。'};
let tab='outcomes',busy=false,lastFinished=null,polling=false;
const cursors={shifts:null,outcomes:null,curation:null,reconciliations:null};
const selected={shifts:null,outcomes:null,curation:null,reconciliations:null};
function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node}
function notice(text,error=false){const node=$('#notice');node.hidden=!text;node.className=error?'error':'';node.textContent=text}
function time(value){return value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—'}
function textStatus(status){return labels[status]??status??'—'}
async function api(route,body){
  const response=await fetch('/local/'+route,body===undefined?{cache:'no-store'}:
    {method:'POST',headers:{'Content-Type':'application/json','X-Tako-Workbench':'1'},body:JSON.stringify(body),cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw Error(errors[data.error]??'请求未完成，请刷新记录后重试。');
  return data;
}
function action(task){return async event=>{event?.preventDefault();notice('');try{await task(event)}catch(error){notice(error.message,true)}}}
function button(text,onClick,className){const node=el('button',text,className);node.type='button';node.addEventListener('click',action(onClick));return node}
function metric(parent,name,value){const block=el('div',undefined,'metric');block.append(el('span',name),el('strong',value??'—'));parent.append(block)}
function table(headers,rows){const wrap=el('div',undefined,'table-wrap'),node=el('table'),head=el('thead'),tr=el('tr');
  for(const title of headers)tr.append(el('th',title));head.append(tr);node.append(head);const body=el('tbody');
  for(const row of rows){const tr=el('tr');for(const value of row){const td=el('td');if(value instanceof Node)td.append(value);else td.textContent=String(value??'—');tr.append(td)}body.append(tr)}
  node.append(body);wrap.append(node);return wrap;
}
function opsLink(path){const link=el('a','进入运营页');link.href='http://127.0.0.1:3300'+path;link.target='_blank';link.rel='noopener noreferrer';return link}
function title(parent,name,subtitle){const header=el('div',undefined,'result-header');header.append(el('h2',name));parent.append(header);if(subtitle)parent.append(el('small',subtitle));return header}
function pageRows(parent,headers,rows){
  let offset=0;const content=el('div'),pager=el('div',undefined,'pagination');parent.append(content,pager);
  const draw=()=>{content.replaceChildren(rows.length?table(headers,rows.slice(offset,offset+20)):el('div','本次没有符合条件的记录。','empty'));
    pager.replaceChildren();if(rows.length<=20)return;
    const prev=button('上一页',()=>{offset-=20;draw()}),next=button('下一页',()=>{offset+=20;draw()});prev.disabled=offset===0;next.disabled=offset+20>=rows.length;
    pager.append(prev,el('span',`${offset+1}—${Math.min(offset+20,rows.length)} / ${rows.length}`),next);};draw();
}
async function loadHistory(kind,more=false){
  const container=$('#'+kind+'-list');
  if(!more)container.replaceChildren(el('p','正在读取记录…'));
  try{
    const result=await api('history',{kind,...(more&&cursors[kind]?{before:cursors[kind]}:{})});
    if(!more)container.replaceChildren();
    for(const item of result.items){
      const record=button(`#${item.id} · ${textStatus(item.status)}`,()=>openReport(kind,item.id),'record');
      record.dataset.id=item.id;record.setAttribute('aria-pressed',String(selected[kind]===item.id));record.append(el('small',time(item.startedAt)));
      if(item.acknowledgment)record.append(el('small','已交班 · '+item.acknowledgment.operatorLabel));container.append(record);
    }
    if(!result.items.length&&!more)container.append(el('p','还没有记录，可开始一次检查。'));
    cursors[kind]=result.nextBefore;$('#'+kind+'-more').hidden=!result.nextBefore;
  }catch(error){if(!more)container.replaceChildren(el('p','记录读取失败。','error'),button('重试读取',()=>loadHistory(kind)));throw error}
}
async function openReport(kind,id){
  const data=await api('report',{kind,id});selected[kind]=id;
  for(const record of document.querySelectorAll('#'+kind+'-list .record'))record.setAttribute('aria-pressed',String(Number(record.dataset.id)===id));
  if(kind==='shifts')renderShift(data);else if(kind==='outcomes')renderOutcome(data);else if(kind==='reconciliations')renderReconciliation(data);else renderCuration(data);
}
function renderReconciliation(report){
  const parent=$('#reconciliation-detail');parent.hidden=false;parent.closest('details').open=true;parent.replaceChildren();
  const head=title(parent,`对账 #${report.reportId} · ${textStatus(report.status)}`,
    `班次 #${report.previous.shiftId}（${time(report.previous.scannedAt)}）→ #${report.current.shiftId}（${time(report.current.scannedAt)}）`);
  if(report.status==='incomplete')head.append(button('继续未确认项',()=>startJob('resume-reconciliation',{id:report.reportId}),'remote'));
  const metrics=el('div',undefined,'metrics');metric(metrics,'继续积压',report.retained);metric(metrics,'新进入超时',report.entered);metric(metrics,'离开超时队列',report.departed);parent.append(metrics);
  parent.append(el('p',`离开项回查：已有决定 ${report.departureChecks.decided} · 仍待处理 ${report.departureChecks.stillPending} · 未确认 ${report.departureChecks.unconfirmed}`));
  parent.append(el('small','离开队列不等于已处理。回查反映核对时间的结果，不代表在两班之间完成，也不代表读者已可见。'));
  parent.append(table(['队列','上班','新进入','离开','本班'],report.queues.map(row=>[textStatus(row.queue),row.previous,row.entered,row.departed,row.current])));
  const filter=el('select');filter.setAttribute('aria-label','筛选对账变化');
  for(const [value,label] of [['departed','离开超时队列'],['entered','新进入超时'],['retained','继续积压']]){const option=el('option',label);option.value=value;filter.append(option)}
  parent.append(el('h3','逐项变化'),filter);const list=el('div');parent.append(list);
  const checks=new Map(report.details.checks.map(row=>[row.queue+':'+row.id,row]));
  const draw=()=>{list.replaceChildren();pageRows(list,['队列 / 标识','等待起点','回查结果','回查时间','处理入口'],report.details[filter.value].map(item=>{
    const check=checks.get(item.queue+':'+item.id);
    const path=check?.workbenchPath??{pre_review:'/ops/work-submissions',post_review:'/ops/reviews',appeal:'/ops/appeals'}[item.queue];
    return [`${textStatus(item.queue)} · ${item.id}`,time(item.waitingSince),filter.value!=='departed'?'以本班快照为准':
      check?`${textStatus(check.status)}${check.decision&&check.decision!==check.status?' · '+textStatus(check.decision):''}${check.currentPending?.status==='unavailable'?' · 当前待审稿未确认':''}`:'未核对',
      time(check?.checkedAt),opsLink(path)];
  }))};filter.addEventListener('change',draw);draw();updateBusy();
}
function renderShift(report){
  const parent=$('#shift-detail');parent.replaceChildren();
  const head=title(parent,`班次 #${report.shiftId} · ${textStatus(report.status)}`,`开始 ${time(report.startedAt)} · 修订 ${report.revision}`);
  if(report.status==='incomplete')head.append(button('继续未完成检查',()=>startJob('resume',{id:report.shiftId}),'remote'));
  const metrics=el('div',undefined,'metrics');metric(metrics,'仍待处理',report.handoff.pending);metric(metrics,'已有决定',report.handoff.decided);
  metric(metrics,'需续查',report.handoff.unchecked+report.unresolvedItems);parent.append(metrics);
  if(report.details.scan?.status==='incomplete')parent.append(el('p','积压扫描未完整，不能将未读取部分视为零。请检查服务与权限后续查。','warning'));
  if(report.details.policy?.status==='incomplete')parent.append(el('p','观察期核对未完整，请续查。','warning'));
  parent.append(el('p',`观察期核对：${textStatus(report.policyStatus)} · 复核报表：${textStatus(report.outcomeStatus)}`));
  if(report.outcomeReportId)parent.append(button(`查看复核报表 #${report.outcomeReportId}`,async()=>{await switchTab('outcomes');await openReport('outcomes',report.outcomeReportId)}));
  parent.append(el('h3','超时待办核对'));
  const filter=el('select');filter.setAttribute('aria-label','筛选核对状态');
  for(const [value,label] of [['all','全部状态'],['pending','待处理'],['decided','已有决定'],['unresolved','需续查']]){const option=el('option',label);option.value=value;filter.append(option)}
  parent.append(filter);const list=el('div');parent.append(list);
  const all=new Map(report.details.checks.map(row=>[row.queue+':'+row.id,row]));
  for(const queue of report.details.scan?.queues??[])for(const item of queue.overdue)if(!all.has(queue.queue+':'+item.id))all.set(queue.queue+':'+item.id,{...item,queue:queue.queue,status:'unchecked'});
  const draw=()=>{
    const rows=[...all.values()].filter(row=>filter.value==='all'||row.status===filter.value||filter.value==='unresolved'&&(['unavailable','unchecked','rescan_required'].includes(row.status)||row.currentPending?.status==='unavailable'));
    list.replaceChildren();pageRows(list,['队列 / 标识','当前结果','核对时间','处理入口'],rows.map(row=>[
      `${textStatus(row.queue)} · ${row.id}`,`${textStatus(row.status)}${row.decision&&row.decision!==row.status?' · '+textStatus(row.decision):''}${row.currentPending?.status==='unavailable'?' · 替换后的待审稿未确认':row.currentPending?.status==='found'?' · 当前待审 '+row.currentPending.submission_id:''}`,
      time(row.checkedAt),row.workbenchPath?opsLink(row.workbenchPath):'—']));
  };filter.addEventListener('change',draw);draw();
  if(report.details.policy?.rows?.length){parent.append(el('h3','观察期中的送审稿'));pageRows(parent,['作品','观察期','稿件状态','入口'],report.details.policy.rows.map(row=>[row.workId,row.status==='submission_changed'?'需重新核对':row.observationActive?'生效中':'已结束',row.status==='submission_changed'?textStatus(row.currentState):'等待审核',opsLink('/ops/work-submissions')]))}
  parent.append(el('h3','交班记录'));
  if(report.acknowledgment)parent.append(el('p',`${report.acknowledgment.operatorLabel} · ${time(report.acknowledgment.acknowledgedAt)}`));
  else if(report.status==='complete'){
    const form=el('form',undefined,'actions'),label=el('label','接收人标识'),input=el('input');input.name='operatorLabel';input.required=true;input.maxLength=32;input.pattern='[A-Za-z0-9_-]{1,32}';label.append(input);
    const submit=el('button','记录交班接收','primary');submit.type='submit';form.append(label,submit);
    form.addEventListener('submit',action(async()=>{submit.disabled=true;try{await api('ack',{id:report.shiftId,revision:report.revision,operatorLabel:input.value});await loadHistory('shifts');await openReport('shifts',report.shiftId)}finally{submit.disabled=false}}));parent.append(form);
    parent.append(el('small','确认已核对本班结果并接收待办；这不会完成审核。'));
  }else parent.append(el('p','检查完整后可记录交班接收人。'));
  updateBusy();
}
function renderOutcome(stored){
  const report=stored.report,parent=$('#outcome-detail');parent.replaceChildren();title(parent,`报表 #${stored.reportId} · ${textStatus(report.status)}`,time(report.startedAt));
  if(report.status!=='complete'){parent.append(el('p','报表未完整，不能据此汇总。请在对应班次继续检查。','warning'));return}
  if(!report.period){parent.append(el('p','这是一份历史全量报表，不能与周期报表对照。'));const m=el('div',undefined,'metrics');for(const [key,value] of Object.entries(report.counts))metric(m,textStatus(key),value);parent.append(m);return}
  const period=report.period;parent.append(el('p',`${period.from} 至 ${period.untilExclusive}（不含），上海时间`));
  if(!period.flow){parent.append(el('p','这是旧口径报表，未包含全部期末积压；请使用新班次生成当前口径报表。','warning'));return}
  const metrics=el('div',undefined,'metrics');metric(metrics,'期初待决',period.flow.openingPending);metric(metrics,'本期提交',period.flow.incoming);
  metric(metrics,'本期决定',period.flow.decisions);metric(metrics,'期末待决',period.flow.closingPending);parent.append(metrics);
  parent.append(el('p',`决定中：维持 ${period.decisions.upheld} · 撤销 ${period.decisions.revoked}；期末超时 ${period.flow.closingOver48Hours}。`));
  parent.append(el('small','观察截至 '+time(period.observedThrough)));
  parent.append(el('h3','周期记录'));
  pageRows(parent,['复核编号','提交时间','决定时间','截至期末状态'],period.outcomes.map(row=>[row.appealId,time(row.requestedAt),time(row.decidedAt),textStatus(row.stateAtCutoff??row.state)]));
}
function renderCuration(report){
  const parent=$('#curation-detail');parent.replaceChildren();title(parent,`核验 #${report.reportId} · ${textStatus(report.status)}`,time(report.startedAt));
  if(report.status==='changed')parent.append(el('p','核验期间配置或读者结果发生变化，请重新核验。','warning'));
  else if(report.status==='incomplete')parent.append(el('p','部分结果未确认，请检查本地服务、权限后重新核验。','warning'));
  else parent.append(el('p',report.needsRecheck?'精选列表与观察结果有差异，请复查。':'本次列表核对一致。'));
  pageRows(parent,['精选位','作品标识','读者结果','入口'],report.slots.map(row=>[row.slot,row.workId??'—',textStatus(row.status)+(row.displayedVersion?` · V${row.displayedVersion}`:''),row.workId?opsLink('/ops/curation'):'—']));
  if(report.slots.some(row=>row.status==='selection_stale'))parent.append(el('p','作品恢复可读后，需要运营重新选择，才会重新进入精选。','warning'));
}
async function switchTab(next){tab=next;for(const panel of document.querySelectorAll('.panel'))panel.hidden=panel.id!==next;
  for(const button of document.querySelectorAll('[data-tab]')){if(button.dataset.tab===next)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')}
  await loadHistory(next);
  if(next==='outcomes'){await loadOverview();await loadHistory('reconciliations')}
}
async function loadOverview(){
  const parent=$('#overview');
  try{
    const [shifts,curation]=await Promise.all([api('history',{kind:'shifts'}),api('history',{kind:'curation'})]);
    parent.replaceChildren();
    const row=(name,status,at,kind,id)=>{
      const node=el('div',undefined,'summary-row'),text=el('div');text.append(el('span',name+' · '+status),el('small',at?time(at):'尚未检查'));
      node.append(text,button(id?'查看记录':'前往检查',async()=>{await switchTab(kind);if(id)await openReport(kind,id)}));parent.append(node);
    };
    const shift=shifts.items[0];
    row('最近班次',shift?(shift.status==='incomplete'?'检查未完整':`待处理 ${shift.handoff.pending} · ${shift.acknowledgment?'已交班':'待交班'}`):'未确认',shift?.startedAt,'shifts',shift?.id);
    const latest=curation.items[0];
    if(latest){
      const report=await api('report',{kind:'curation',id:latest.id});
      const abnormal=report.slots.filter(slot=>!['empty','selected_readable'].includes(slot.status)).length;
      row('精选展示',report.status!=='complete'?textStatus(report.status):report.needsRecheck||abnormal?`${abnormal} 个精选位需复查`:'最近核验一致',latest.startedAt,'curation',latest.id);
    }else row('精选展示','未确认',null,'curation',null);
    parent.append(el('small','各项为最近一次快照；核验一致仅代表当时读取结果。'));
  }catch(error){parent.replaceChildren(el('p','概览读取未完整，异常状态未确认。','error'),button('重试读取',loadOverview));throw error}
}
function updateBusy(){for(const node of document.querySelectorAll('.remote'))node.disabled=busy;$('#stop').disabled=!busy}
async function startJob(route,body){await api(route,body);await poll()}
async function poll(){
  if(polling)return;polling=true;
  try{
    const state=await api('state'),job=state.job;busy=job?.status==='running';
    $('#job').hidden=!busy;$('#job-text').textContent=job?.kind==='curation'?'正在核验精选展示…':job?.kind==='reconciliation'?'正在回查离开超时队列的任务…':'正在核对本班积压、观察期与复核报表…';updateBusy();
    if(job&&job.status!=='running'&&lastFinished!==job.id){
      lastFinished=job.id;
      if(job.status==='failed')notice(errors[job.error]??'检查未完成。已写入的班次记录可继续检查。',true);
      else{
        const kind=job.kind==='shift'?'shifts':job.kind==='reconciliation'?'reconciliations':'curation',id=job.result?.shiftId??job.result?.reportId;
        if(id){await switchTab(kind==='reconciliations'?'outcomes':kind);await openReport(kind,id)}
        notice(job.result?.status==='complete'?'检查结果已保存。':'检查结果已保存，仍有未确认项。');
      }
      await loadHistory(tab);
    }else if(busy&&tab==='shifts'){
      await loadHistory('shifts');
      if(selected.shifts)await openReport('shifts',selected.shifts);
    }
  }catch(error){notice('工作台连接中断，请确认本地工作台仍在运行，再刷新页面。',true)}finally{polling=false}
}
for(const node of document.querySelectorAll('[data-tab]'))node.addEventListener('click',action(()=>switchTab(node.dataset.tab)));
for(const kind of ['shifts','outcomes','curation','reconciliations'])$('#'+kind+'-more').addEventListener('click',action(()=>loadHistory(kind,true)));
$('#start-form').addEventListener('submit',action(event=>{const data=new FormData(event.target);return startJob('start',{from:data.get('from'),until:data.get('until')})}));
$('#check-curation').addEventListener('click',action(()=>startJob('curation',{})));
$('#stop').addEventListener('click',action(async()=>{await api('stop',{});notice('正在停止；当前请求结束后保留检查点。')}));
$('#refresh-overview').addEventListener('click',action(async()=>{await loadHistory('outcomes');await loadOverview();if(selected.outcomes)await openReport('outcomes',selected.outcomes)}));
$('#reconcile-form').addEventListener('submit',action(event=>{
  const data=new FormData(event.target);return startJob('reconcile',{previousId:Number(data.get('previousId')),currentId:Number(data.get('currentId'))});
}));
$('#compare-form').addEventListener('submit',action(async event=>{
  const data=new FormData(event.target),result=await api('compare',{previousId:Number(data.get('previousId')),currentId:Number(data.get('currentId'))}),parent=$('#comparison');parent.replaceChildren();
  title(parent,`报表 #${result.previousId} → #${result.currentId}`);
  for(const [name,label] of [['incoming','本期提交'],['decisions','本期决定'],['closingBacklog','期末待决']]){
    const value=result[name];if(value)parent.append(el('p',`${label}：${value.previous} → ${value.current}（变化 ${value.change}）`));
  }
}));
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}),weekAgo=new Date(Date.now()-7*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
$('#start-form [name=from]').value=weekAgo;$('#start-form [name=until]').value=today;
action(async()=>{await switchTab('outcomes');const latest=$('#outcomes-list .record');if(latest)await openReport('outcomes',Number(latest.dataset.id));await poll()})();
setInterval(()=>{void poll()},3000);
