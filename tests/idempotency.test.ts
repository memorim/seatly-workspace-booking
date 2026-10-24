import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {createDatabase} from '../server/db.js';
import {createApp} from '../server/app.js';
test('one reservation for concurrent retries, original response survives later changes',async(t)=>{
 const db=createDatabase(':memory:'),server=createApp(db).listen(0);await new Promise<void>(r=>server.once('listening',r));t.after(async()=>{await new Promise<void>(r=>server.close(()=>r()));db.close();});const agent=request.agent(server);
 await agent.post('/api/login').send({email:'guest@seatly.example',password:'GuestDemo2026!'});
 const body={spaceId:1,guestName:'Synthetic guest',guestEmail:'demo@example.com',bookingDate:'2030-04-10',startTime:'10:00',endTime:'11:00',guests:2},key='synthetic-operation-123';
 const results=await Promise.all(Array.from({length:20},()=>agent.post('/api/bookings').set('Idempotency-Key',key).send(body)));assert.ok(results.every(r=>r.status===201));const first=results[0].body;assert.ok(results.every(r=>JSON.stringify(r.body)===JSON.stringify(first)));
 assert.equal(db.prepare('SELECT COUNT(*) n FROM bookings WHERE request_key=?').get('1:'+key)?.n,1);
 assert.equal((await agent.post('/api/bookings').set('Idempotency-Key',key).send({...body,guests:3})).status,409);
 assert.equal((await agent.post('/api/bookings').set('Idempotency-Key','').send(body)).status,400);
 assert.equal((await agent.delete('/api/bookings/'+first.id)).status,204);
 const again=await agent.post('/api/bookings').set('Idempotency-Key',key).send(body);assert.equal(again.status,201);assert.deepEqual(again.body,first);assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(first.id)?.status,'cancelled');
 assert.equal((await request(server).post('/api/bookings').set('Idempotency-Key',key).send(body)).status,401);
});
