import {DatabaseSync} from 'node:sqlite';
import type {scanReviewBacklog} from './review-backlog.ts';

type Report=Awaited<ReturnType<typeof scanReviewBacklog>>;
export type Observation=Report|{
  status:'incomplete';scannedAt:string;queues:[];failedQueue:'session';
  error:'operator_session_failed';httpStatus:number|null;totalOverdue:null;
};
type Queue=Report['queues'][number]['queue'];
type TaskId=string|number;
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
    return this.db.prepare('SELECT id,observed_at,event FROM monitor_events ORDER BY id DESC LIMIT 20').all()
      .map(row=>({id:Number(row.id),observedAt:String(row.observed_at),...JSON.parse(String(row.event)) as Event}));
  }

  close(){this.db.close()}
}
