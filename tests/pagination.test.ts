import test from 'node:test';import assert from 'node:assert/strict';import request from 'supertest';import {createDatabase} from '../server/db.js';import {createApp} from '../server/app.js';
test('booking pages stay bounded, filtered and scoped to the current guest',async()=>{
 const db=createDatabase(':memory:'),app=createApp(db),agent=request.agent(app);try{
 await agent.post('/api/login').send({email:'guest@seatly.example',password:'GuestDemo2026!'});
 const insert=db.prepare("INSERT INTO bookings(space_id,guest_name,guest_email,booking_date,start_time,end_time,guests,total_price,status,created_at,user_id) VALUES (1,?,'fixture@example.com','2030-01-10','10:00','11:00',1,1800,'cancelled','2026-10-24',?)");for(let i=0;i<85;i++)insert.run('Page fixture '+i,1);insert.run('Other private guest',99);
 const a=await agent.get('/api/bookings/page?limit=40'),b=await agent.get('/api/bookings/page?limit=40&offset=40');assert.equal(a.body.total,85);assert.equal(a.body.items.length,40);assert.equal(a.body.items.some((x:{id:number})=>b.body.items.some((y:{id:number})=>x.id===y.id)),false);assert.equal(a.body.items.some((x:{user_id:number})=>x.user_id!==1),false);assert.equal('request_key' in a.body.items[0],false);
 const filtered=await agent.get('/api/bookings/page?search=Page%20fixture%2084&status=cancelled');assert.equal(filtered.body.total,1);assert.equal((await agent.get('/api/bookings/page?limit=101')).status,400);assert.equal((await agent.get('/api/bookings/page?status=bad')).status,400);assert.equal((await request(app).get('/api/bookings/page')).status,401);assert.equal((await agent.get('/api/bookings')).body.length,40);
 }finally{db.close();}
});
