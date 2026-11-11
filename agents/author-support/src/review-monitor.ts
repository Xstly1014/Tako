import {DatabaseSync,type SQLOutputValue} from 'node:sqlite';
import type {scanReviewBacklog,ReviewTarget} from './review-backlog.ts';

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

  close(){this.db.close()}
}

function eventRow(row:Record<string,SQLOutputValue>){
  return {
    id:Number(row.id),observedAt:String(row.observed_at),...JSON.parse(String(row.event)) as Event,
    acknowledgment:row.acknowledged_at?{operatorLabel:String(row.operator_label),acknowledgedAt:String(row.acknowledged_at)}:null,
  };
}
