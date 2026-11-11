import {DatabaseSync,type SQLOutputValue} from 'node:sqlite';
import type {scanReviewBacklog,ReviewTarget} from './review-backlog.ts';
import type {reviewHandoff} from './review-handoff.ts';
import {compareOutcomeReports,outcomeReportVersion,type OutcomeReport} from './review-outcomes.ts';
import {shiftSummary,type OperatorShift} from './operator-shift.ts';
import type {checkCuration} from './curation-check.ts';
import {reconciliationSummary,type ShiftReconciliation} from './shift-reconciliation.ts';
import type {ReaderEffect} from './reader-effect.ts';

type Report=Awaited<ReturnType<typeof scanReviewBacklog>>;
export type Observation=Report|{
  status:'incomplete';scannedAt:string;queues:[];failedQueue:'session';
  error:'operator_session_failed';httpStatus:number|null;totalOverdue:null;
};
type Queue=Report['queues'][number]['queue'];
type TaskId=string|number;
export type ReviewHandoffItem={queue:Queue;id:TaskId;waitingSince:string|null;target:ReviewTarget|null};
type Backlog=Partial<Record<Queue,TaskId[]>>;
type Event=
  | {kind:'scan_failed';queue:Queue|'session';error:string;httpStatus:number|null}
  | {kind:'scan_restored'}
  | {kind:'overdue_changed';queue:Queue;added:TaskId[];noLongerObserved:TaskId[];total:number};

export class ReviewMonitor {
  private db:DatabaseSync;

  constructor(file:string){
    this.db=new DatabaseSync(file);
    this.db.exec(`
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS monitor_state(
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        observed_at TEXT NOT NULL, status TEXT NOT NULL, backlog TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS monitor_events(
        id INTEGER PRIMARY KEY, observed_at TEXT NOT NULL, event TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS monitor_acknowledgments(
        event_id INTEGER PRIMARY KEY REFERENCES monitor_events(id),
        operator_label TEXT NOT NULL, acknowledged_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS monitor_targets(
        queue TEXT NOT NULL, task_id TEXT NOT NULL, waiting_since TEXT NOT NULL, target TEXT NOT NULL,
        PRIMARY KEY(queue,task_id)
      );
      CREATE TABLE IF NOT EXISTS monitor_checks(
        event_id INTEGER NOT NULL, queue TEXT NOT NULL, task_id TEXT NOT NULL,
        checked_at TEXT NOT NULL, result TEXT NOT NULL,
        PRIMARY KEY(event_id,queue,task_id)
      );
      CREATE TABLE IF NOT EXISTS outcome_reports(
        id INTEGER PRIMARY KEY, version TEXT NOT NULL, generated_at TEXT NOT NULL, report TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operator_shifts(
        id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, run TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operator_shift_acknowledgments(
        shift_id INTEGER NOT NULL, revision INTEGER NOT NULL,
        operator_label TEXT NOT NULL, acknowledged_at TEXT NOT NULL,
        PRIMARY KEY(shift_id,revision)
      );
      CREATE TABLE IF NOT EXISTS curation_reports(
        id INTEGER PRIMARY KEY, report TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS shift_reconciliations(
        id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, run TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reader_effect_reports(id INTEGER PRIMARY KEY, report TEXT NOT NULL);
    `);
  }

  record(report:Observation){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const prior=this.db.prepare('SELECT observed_at,status,backlog FROM monitor_state WHERE singleton=1').get();
      if(prior&&report.scannedAt<=String(prior.observed_at)){
        this.db.exec('COMMIT');
        return {accepted:false,events:[]};
      }
      const backlog:Backlog=prior?JSON.parse(String(prior.backlog)):{};
      const events:Event[]=[];
      if(report.status==='incomplete'){
        if(prior?.status!=='incomplete'){
          events.push({kind:'scan_failed',queue:report.failedQueue,error:report.error,httpStatus:report.httpStatus});
        }
      }else{
        if(prior?.status==='incomplete')events.push({kind:'scan_restored'});
        for(const queue of report.queues){
          for(const item of queue.overdue){
            if(item.target)this.db.prepare(`
              INSERT INTO monitor_targets(queue,task_id,waiting_since,target) VALUES(?,?,?,?)
              ON CONFLICT(queue,task_id) DO NOTHING
            `).run(queue.queue,String(item.id),item.waitingSince,JSON.stringify(item.target));
          }
          const previous=new Set(backlog[queue.queue]);
          const current=new Set(queue.overdue.map(item=>item.id));
          const added=[...current].filter(id=>!previous.has(id));
          const noLongerObserved=[...previous].filter(id=>!current.has(id));
          if(added.length||noLongerObserved.length){
            events.push({kind:'overdue_changed',queue:queue.queue,added,noLongerObserved,total:current.size});
          }
          backlog[queue.queue]=[...current];
        }
      }
      this.db.prepare(`
        INSERT INTO monitor_state(singleton,observed_at,status,backlog) VALUES(1,?,?,?)
        ON CONFLICT(singleton) DO UPDATE SET observed_at=excluded.observed_at,status=excluded.status,backlog=excluded.backlog
      `).run(report.scannedAt,report.status,JSON.stringify(backlog));
      const append=this.db.prepare('INSERT INTO monitor_events(observed_at,event) VALUES(?,?)');
      const recorded=events.map(event=>({
        ...event,id:Number(append.run(report.scannedAt,JSON.stringify(event)).lastInsertRowid),
      }));
      this.db.exec('COMMIT');
      return {accepted:true,events:recorded};
    }catch(error){
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  recentEvents(){
    return this.db.prepare(`
      SELECT e.*,a.operator_label,a.acknowledged_at
      FROM monitor_events e LEFT JOIN monitor_acknowledgments a ON a.event_id=e.id
      ORDER BY e.id DESC LIMIT 20
    `).all().map(eventRow);
  }

  pendingEvents(after=0){
    const rows=this.db.prepare(`
      SELECT e.* FROM monitor_events e
      WHERE e.id>? AND NOT EXISTS (SELECT 1 FROM monitor_acknowledgments a WHERE a.event_id=e.id)
      ORDER BY e.id LIMIT 21
    `).all(after);
    const events=rows.slice(0,20).map(eventRow);
    return {events,nextAfter:rows.length>20?events[19].id:null};
  }

  acknowledge(id:number,operatorLabel:string){
    if(!Number.isSafeInteger(id)||id<=0||!/^[a-zA-Z0-9_-]{1,32}$/.test(operatorLabel)){
      throw Error('invalid_acknowledgment');
    }
    const updated=this.db.prepare(`
      INSERT INTO monitor_acknowledgments(event_id,operator_label,acknowledged_at)
      SELECT id,?,? FROM monitor_events WHERE id=?
      ON CONFLICT(event_id) DO NOTHING
    `).run(operatorLabel,new Date().toISOString(),id);
    const row=this.db.prepare('SELECT operator_label,acknowledged_at FROM monitor_acknowledgments WHERE event_id=?').get(id);
    if(!row)throw Error('review_event_not_found');
    return {id,operatorLabel:String(row.operator_label),acknowledgedAt:String(row.acknowledged_at),alreadyAcknowledged:updated.changes===0};
  }

  handoffItems(eventId:number):ReviewHandoffItem[]{
    const row=this.db.prepare('SELECT event FROM monitor_events WHERE id=?').get(eventId);
    if(!row)throw Error('review_event_not_found');
    const event=JSON.parse(String(row.event)) as Event;
    if(event.kind!=='overdue_changed')throw Error('not_backlog_event');
    return [...new Set([...event.added,...event.noLongerObserved])].map(id=>{
      const saved=this.db.prepare('SELECT waiting_since,target FROM monitor_targets WHERE queue=? AND task_id=?')
        .get(event.queue,String(id));
      return {queue:event.queue,id,waitingSince:saved?String(saved.waiting_since):null,
        target:saved?JSON.parse(String(saved.target)) as ReviewTarget:null};
    }).sort((a,b)=>(a.waitingSince??'9999').localeCompare(b.waitingSince??'9999')||String(a.id).localeCompare(String(b.id)));
  }

  saveHandoff(eventId:number,report:Awaited<ReturnType<typeof reviewHandoff>>){
    const items=this.handoffItems(eventId);
    const valid=new Map(items.map(item=>[item.queue+':'+item.id,item]));
    this.db.exec('BEGIN IMMEDIATE');
    try{
      for(const row of report.rows){
        const item=valid.get(row.queue+':'+row.id);
        if(!item||JSON.stringify(item.target)!==JSON.stringify(row.target))throw Error('handoff_target_changed');
        this.db.prepare(`
          INSERT INTO monitor_checks(event_id,queue,task_id,checked_at,result) VALUES(?,?,?,?,?)
          ON CONFLICT(event_id,queue,task_id) DO UPDATE SET
            checked_at=excluded.checked_at,result=excluded.result
          WHERE excluded.checked_at>monitor_checks.checked_at
        `).run(eventId,row.queue,String(row.id),report.checkedAt,JSON.stringify(row));
      }
      this.db.exec('COMMIT');
    }catch(error){
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  handoffSummary(eventId:number){
    const items=this.handoffItems(eventId);
    const saved=this.db.prepare('SELECT queue,task_id,checked_at,result FROM monitor_checks WHERE event_id=?').all(eventId);
    const checks=new Map(saved.map(row=>[String(row.queue)+':'+String(row.task_id),row]));
    const rows=items.map(item=>{
      const row=checks.get(item.queue+':'+item.id);
      if(!row)return {...item,status:'unchecked' as const,checkedAt:null};
      const result=JSON.parse(String(row.result)) as Awaited<ReturnType<typeof reviewHandoff>>['rows'][number];
      if(JSON.stringify(item.target)!==JSON.stringify(result.target)){
        return {...item,status:'unchecked' as const,checkedAt:null};
      }
      return {...result,checkedAt:String(row.checked_at)};
    });
    const counts={pending:0,decided:0,unavailable:0,rescan_required:0,unchecked:0};
    for(const row of rows)counts[row.status]++;
    return {eventId,total:items.length,counts,rows};
  }

  saveOutcomeReport(report:OutcomeReport){
    const result=this.db.prepare('INSERT INTO outcome_reports(version,generated_at,report) VALUES(?,?,?)')
      .run(outcomeReportVersion,new Date().toISOString(),JSON.stringify(report));
    return Number(result.lastInsertRowid);
  }

  outcomeReport(id:number){
    const row=this.db.prepare('SELECT version,report FROM outcome_reports WHERE id=?').get(id);
    if(!row)throw Error('outcome_report_not_found');
    return {reportId:id,version:String(row.version),report:JSON.parse(String(row.report)) as OutcomeReport};
  }

  compareOutcomes(previousId:number,currentId:number){
    const previous=this.outcomeReport(previousId),current=this.outcomeReport(currentId);
    if(previous.version!==current.version||previous.version!==outcomeReportVersion)throw Error('report_version_mismatch');
    return {previousId,currentId,version:previous.version,...compareOutcomeReports(previous.report,current.report)};
  }

  createShift(run:OperatorShift){
    const result=this.db.prepare('INSERT INTO operator_shifts(revision,run) VALUES(1,?)').run(JSON.stringify(run));
    return {id:Number(result.lastInsertRowid),revision:1,run};
  }

  shift(id:number){
    const row=this.db.prepare('SELECT revision,run FROM operator_shifts WHERE id=?').get(id);
    if(!row)throw Error('shift_not_found');
    return {id,revision:Number(row.revision),run:JSON.parse(String(row.run)) as OperatorShift};
  }

  saveShift(id:number,revision:number,run:OperatorShift){
    const updated=this.db.prepare('UPDATE operator_shifts SET revision=revision+1,run=? WHERE id=? AND revision=?')
      .run(JSON.stringify(run),id,revision);
    if(updated.changes!==1)throw Error('shift_changed');
    return {id,revision:revision+1,run};
  }

  saveShiftOutcome(id:number,revision:number,run:OperatorShift,report:OutcomeReport){
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const reportId=this.saveOutcomeReport(report);
      const updated={...run,outcomeReportId:reportId,outcomeStatus:report.status};
      const stored=this.saveShift(id,revision,updated);
      this.db.exec('COMMIT');
      Object.assign(run,updated);
      return stored;
    }catch(error){
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  shiftAcknowledgment(id:number){
    const {revision}=this.shift(id);
    const row=this.db.prepare('SELECT operator_label,acknowledged_at FROM operator_shift_acknowledgments WHERE shift_id=? AND revision=?')
      .get(id,revision);
    return row?{revision,operatorLabel:String(row.operator_label),acknowledgedAt:String(row.acknowledged_at)}:null;
  }

  acknowledgeShift(id:number,operatorLabel:string,expectedRevision?:number){
    if(!/^[a-zA-Z0-9_-]{1,32}$/.test(operatorLabel))throw Error('invalid_acknowledgment');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const {revision,run}=this.shift(id);
      if(expectedRevision!==undefined&&expectedRevision!==revision)throw Error('shift_changed');
      if(shiftSummary(id,run).status!=='complete')throw Error('shift_incomplete');
      this.db.prepare(`
        INSERT INTO operator_shift_acknowledgments(shift_id,revision,operator_label,acknowledged_at)
        VALUES(?,?,?,?) ON CONFLICT(shift_id,revision) DO NOTHING
      `).run(id,revision,operatorLabel,new Date().toISOString());
      const receipt=this.shiftAcknowledgment(id)!;
      this.db.exec('COMMIT');
      return {shiftId:id,...receipt};
    }catch(error){
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  saveCurationReport(report:Awaited<ReturnType<typeof checkCuration>>){
    return Number(this.db.prepare('INSERT INTO curation_reports(report) VALUES(?)').run(JSON.stringify(report)).lastInsertRowid);
  }

  curationReport(id:number){
    const row=this.db.prepare('SELECT report FROM curation_reports WHERE id=?').get(id);
    if(!row)throw Error('curation_report_not_found');
    return {reportId:id,...JSON.parse(String(row.report)) as Awaited<ReturnType<typeof checkCuration>>};
  }

  close(){this.db.close()}

  saveReaderEffect(report:ReaderEffect){
    return Number(this.db.prepare('INSERT INTO reader_effect_reports(report) VALUES(?)').run(JSON.stringify(report)).lastInsertRowid);
  }

  readerEffect(id:number){
    const row=this.db.prepare('SELECT report FROM reader_effect_reports WHERE id=?').get(id);
    if(!row)throw Error('effect_report_not_found');
    return {reportId:id,...JSON.parse(String(row.report)) as ReaderEffect};
  }

  createReconciliation(run:ShiftReconciliation){
    const result=this.db.prepare('INSERT INTO shift_reconciliations(revision,run) VALUES(1,?)').run(JSON.stringify(run));
    return {id:Number(result.lastInsertRowid),revision:1,run};
  }

  reconciliation(id:number){
    const row=this.db.prepare('SELECT revision,run FROM shift_reconciliations WHERE id=?').get(id);
    if(!row)throw Error('reconciliation_not_found');
    return {id,revision:Number(row.revision),run:JSON.parse(String(row.run)) as ShiftReconciliation};
  }

  saveReconciliation(id:number,revision:number,run:ShiftReconciliation){
    const result=this.db.prepare('UPDATE shift_reconciliations SET revision=revision+1,run=? WHERE id=? AND revision=?')
      .run(JSON.stringify(run),id,revision);
    if(result.changes!==1)throw Error('reconciliation_changed');
    return {id,revision:revision+1,run};
  }

  /** Local immutable history, newest first; keyset pagination survives concurrent inserts. */
  history(kind:'shifts'|'outcomes'|'curation'|'reconciliations'|'effects',before=Number.MAX_SAFE_INTEGER){
    const table={shifts:'operator_shifts',outcomes:'outcome_reports',curation:'curation_reports',reconciliations:'shift_reconciliations',effects:'reader_effect_reports'}[kind];
    if(!table||!Number.isSafeInteger(before)||before<1)throw Error('invalid_history');
    const rows=this.db.prepare(`SELECT id FROM ${table} WHERE id<? ORDER BY id DESC LIMIT 21`).all(before);
    const items=rows.slice(0,20).map(row=>{
      const id=Number(row.id);
      if(kind==='effects'){
        const report=this.readerEffect(id);
        return {id,status:report.status,startedAt:report.startedAt,source:report.source};
      }
      if(kind==='reconciliations')return {id,...reconciliationSummary(id,this.reconciliation(id).run)};
      if(kind==='shifts')return {id,...shiftSummary(id,this.shift(id).run),acknowledgment:this.shiftAcknowledgment(id)};
      if(kind==='outcomes'){
        const stored=this.outcomeReport(id);
        return {id,version:stored.version,status:stored.report.status,startedAt:stored.report.startedAt,
          period:stored.report.period?{from:stored.report.period.from,untilExclusive:stored.report.period.untilExclusive}:null};
      }
      const report=this.curationReport(id);
      return {id,status:report.status,startedAt:report.startedAt};
    });
    return {items,nextBefore:rows.length>20?Number(rows[19].id):null};
  }
}

function eventRow(row:Record<string,SQLOutputValue>){
  return {
    id:Number(row.id),observedAt:String(row.observed_at),...JSON.parse(String(row.event)) as Event,
    acknowledgment:row.acknowledged_at?{operatorLabel:String(row.operator_label),acknowledgedAt:String(row.acknowledged_at)}:null,
  };
}
