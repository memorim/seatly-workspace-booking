import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import request from 'supertest';
import {createDatabase} from '../server/db.js';
import {createApp} from '../server/app.js';

for(const sameKey of [false,true])test(`independent HTTP servers: ${sameKey?'same-key retries return the same result':'only one overlapping reservation commits'}`,async t=>{
 const dir=mkdtempSync(join(tmpdir(),'booking-race-')),file=join(dir,'bookings.sqlite');const workers:Worker[]=[];
 t.after(async()=>{await Promise.all(workers.map(w=>w.terminate()));assert.ok(realpathSync(dir).startsWith(realpathSync(tmpdir())+sep));rmSync(dir,{recursive:true,force:true});});
 const seed=createDatabase(file);createApp(seed);seed.close();
 const barrier=sameKey?new SharedArrayBuffer(4):undefined;
 const ports=await Promise.all([0,1].map(()=>new Promise<number>((resolve,reject)=>{
  const worker=new Worker(new URL('./helpers/booking-worker.mjs',import.meta.url),{workerData:{file,barrier},execArgv:['--import','tsx']});workers.push(worker);worker.once('message',resolve);worker.once('error',reject);
 })));
 const agents=ports.map(port=>request.agent(`http://127.0.0.1:${port}`));
 for(const agent of agents)assert.equal((await agent.post('/api/login').send({email:'guest@seatly.example',password:'GuestDemo2026!'})).status,200);
 const body={spaceId:1,guestName:'Concurrency check',guestEmail:'race@example.test',bookingDate:'2030-04-10',startTime:'10:00',endTime:'11:30',guests:2};
 const results=await Promise.all(agents.map((agent,i)=>agent.post('/api/bookings').set('Idempotency-Key',sameKey?'parallel-same-key':'parallel-key-'+i).send(body)));
 assert.deepEqual(results.map(r=>r.status).sort(),sameKey?[201,201]:[201,409]);
 if(sameKey)assert.deepEqual(results[0].body,results[1].body);
 const verify=createDatabase(file);try{assert.equal(verify.prepare("SELECT COUNT(*) n FROM bookings WHERE booking_date='2030-04-10'").get()?.n,1);assert.equal(verify.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok');}finally{verify.close();}
});
