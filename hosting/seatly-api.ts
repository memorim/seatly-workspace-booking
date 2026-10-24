import {z} from 'zod';
import {body,HttpError,operationKey,type SqlDB} from '../portfolio/flow-api';
import {bookingSchema,slotSchema,priceFor,HOLD_MS} from './booking-rules';
import {bookingPageOptions} from './pagination';
import data from './demo-data.json';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const users={guest:{id:1,name:'Демо-гость',email:'guest@seatly.example',role:'guest'},owner:{id:2,name:'Демо-владелец',email:'owner@seatly.example',role:'owner'}};
// ponytail: each authenticated visitor owns a simulated two-role playground; real shared venues need actual owner accounts.
export async function seatlyApi(req:Request,db:SqlDB,key:string|null){
 try{
  const url=new URL(req.url),path=url.pathname.replace(/^\/api\/seatly/,''),method=req.method;
  const q=(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args);
  if(!['GET','HEAD'].includes(method)&&(req.headers.get('sec-fetch-site')==='cross-site'||(req.headers.get('origin')&&req.headers.get('origin')!==url.origin)))throw new HttpError(403,'Запрос с другого сайта запрещён');
  let role='none';
  if(key){
   await q("INSERT OR IGNORE INTO seatly_profiles(sandbox_key,role) VALUES (?,'guest')",key).run();
   role=(await q('SELECT role FROM seatly_profiles WHERE sandbox_key=?',key).first<{role:string}>())!.role;
   await q("UPDATE seatly_bookings SET status='expired' WHERE sandbox_key=? AND status='pending' AND expires_at<=?",key,new Date().toISOString()).run();
  }
  const user=role==='guest'?users.guest:role==='owner'?users.owner:null;
  if(path==='/session'&&method==='GET')return json({mode:'hosted',authenticated:!!key,user});
  if(path==='/health'&&method==='GET')return json({status:'ok',mode:'isolated-synthetic-playground'});
  if(path==='/spaces'&&method==='GET')return json(data.spaces);
  const availability=path.match(/^\/spaces\/(\d+)\/availability$/);
  if(availability&&method==='GET'){
   const date=url.searchParams.get('date');if(!bookingSchema.shape.bookingDate.safeParse(date).success)throw new HttpError(400,'Укажите корректную дату');
   if(!data.spaces.some(s=>s.id===Number(availability[1])))throw new HttpError(404,'Пространство не найдено');
   const slots=key?(await q("SELECT start_time,end_time FROM seatly_bookings WHERE sandbox_key=? AND space_id=? AND booking_date=? AND status IN ('pending','confirmed') ORDER BY start_time",key,Number(availability[1]),date).all()).results:[];
   return json({date,bookings:slots});
  }
  if(!key)throw new HttpError(401,'Войдите через ChatGPT');
  if(path==='/login'&&method==='POST'){
   const parsed=z.object({email:z.enum(['guest@seatly.example','owner@seatly.example']),password:z.string().max(128)}).strict().safeParse(await body(req));
   if(!parsed.success)throw new HttpError(400,'Выберите учебную роль');
   const next=parsed.data.email.startsWith('guest')?'guest':'owner';await q('UPDATE seatly_profiles SET role=? WHERE sandbox_key=?',next,key).run();return json(users[next]);
  }
  if(path==='/logout'&&method==='POST'){await q("UPDATE seatly_profiles SET role='none' WHERE sandbox_key=?",key).run();return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});}
  if(!user)throw new HttpError(401,'Выберите учебную роль');
  if((path==='/bookings'||path==='/bookings/page')&&method==='GET'){
   const {limit,offset,search,status}=bookingPageOptions(url.searchParams),clauses=['sandbox_key=?'],values:unknown[]=[key];if(status){clauses.push('status=?');values.push(status);}if(search){const spaceIds=data.spaces.filter(s=>s.name.toLowerCase().includes(search.toLowerCase())).map(s=>s.id);clauses.push('(guest_name LIKE ?'+(spaceIds.length?' OR space_id IN ('+spaceIds.map(()=>'?').join(',')+')':'')+')');values.push('%'+search+'%',...spaceIds);}
   const where=' WHERE '+clauses.join(' AND '),[rows,count]=await db.batch([q('SELECT id,space_id,guest_name,booking_date,start_time,end_time,guests,total_price,status,expires_at FROM seatly_bookings'+where+' ORDER BY booking_date DESC,id DESC LIMIT ? OFFSET ?',...values,limit,offset),q('SELECT COUNT(*) total FROM seatly_bookings'+where,...values)]);
   const items=rows.results.map(b=>({...b,user_id:1,space_name:data.spaces.find(s=>s.id===b.space_id)?.name||''}));return json(path.endsWith('/page')?{items,total:(count.results[0] as {total:number}).total,limit,offset}:items);
  }
  if(path==='/bookings'&&method==='POST'){
   const parsed=bookingSchema.safeParse(await body(req));if(!parsed.success)throw new HttpError(400,'Проверьте данные бронирования');
   const b=parsed.data,payload=JSON.stringify(b),requestKey=operationKey(req,key+':'+role),space=data.spaces.find(s=>s.id===b.spaceId);if(!space)throw new HttpError(404,'Пространство не найдено');
   const previous=requestKey?await q('SELECT request_payload,create_result FROM seatly_bookings WHERE request_key=?',requestKey).first<{request_payload:string;create_result:string}>():null;
   if(previous){if(previous.request_payload!==payload)throw new HttpError(409,'Ключ уже использован с другими данными');return json(JSON.parse(previous.create_result),201);}
   const n=await q('SELECT COUNT(*) n FROM seatly_bookings WHERE sandbox_key=?',key).first<{n:number}>();if(n!.n>=200)throw new HttpError(429,'Достигнут лимит 200 заявок учебной площадки');
   const total=priceFor(space,b),expiresAt=new Date(Date.now()+HOLD_MS).toISOString();
   const insert=q("INSERT INTO seatly_bookings(sandbox_key,space_id,guest_name,guest_email,booking_date,start_time,end_time,guests,total_price,status,expires_at,created_at,request_key,request_payload) SELECT ?,?,?,?,?,?,?,?,?,'pending',?,?,?,? WHERE ? IS NULL OR NOT EXISTS(SELECT 1 FROM seatly_bookings WHERE request_key=?)",key,b.spaceId,b.guestName,b.guestEmail,b.bookingDate,b.startTime,b.endTime,b.guests,total,expiresAt,new Date().toISOString(),requestKey,requestKey?payload:null,requestKey,requestKey);
   const statements=[insert];if(requestKey)statements.push(q("UPDATE seatly_bookings SET create_result=json_object('id',id,'totalPrice',total_price,'status','pending','expiresAt',expires_at) WHERE request_key=? AND create_result IS NULL",requestKey));
   const [added]=await db.batch(statements);
   if(requestKey){const saved=await q('SELECT request_payload,create_result FROM seatly_bookings WHERE request_key=?',requestKey).first<{request_payload:string;create_result:string}>();if(saved!.request_payload!==payload)throw new HttpError(409,'Ключ уже использован с другими данными');return json(JSON.parse(saved!.create_result),201);}
   return json({id:added.meta.last_row_id,totalPrice:total,status:'pending',expiresAt},201);
  }
  const booking=path.match(/^\/bookings\/(\d+)(\/confirm|\/reschedule)?$/);
  if(booking){
   const id=Number(booking[1]);const old=await q('SELECT id,space_id,status FROM seatly_bookings WHERE sandbox_key=? AND id=?',key,id).first<{id:number;space_id:number;status:string}>();
   if(!old)throw new HttpError(404,'Бронирование не найдено');
   if(!booking[2]&&method==='DELETE'){await q("UPDATE seatly_bookings SET status='cancelled' WHERE sandbox_key=? AND id=?",key,id).run();return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});}
   if(booking[2]==='/confirm'&&method==='PATCH'){
    if(role!=='owner')throw new HttpError(403,'Подтвердить может только владелец');
    const r=await q("UPDATE seatly_bookings SET status='confirmed' WHERE sandbox_key=? AND id=? AND status='pending' AND expires_at>?",key,id,new Date().toISOString()).run();
    if(!r.meta.changes)throw new HttpError(409,'Срок подтверждения истёк или статус уже изменён');return json({id,status:'confirmed'});
   }
   if(booking[2]==='/reschedule'&&method==='PATCH'){
    const parsed=slotSchema.safeParse(await body(req));if(!parsed.success)throw new HttpError(400,'Проверьте дату, время и количество гостей');
    const slot=parsed.data,total=priceFor(data.spaces.find(s=>s.id===old.space_id)!,slot),expiresAt=new Date(Date.now()+HOLD_MS).toISOString();
    const r=await q("UPDATE seatly_bookings SET booking_date=?,start_time=?,end_time=?,guests=?,total_price=?,status='pending',expires_at=? WHERE sandbox_key=? AND id=? AND status IN ('pending','confirmed')",slot.bookingDate,slot.startTime,slot.endTime,slot.guests,total,expiresAt,key,id).run();
    if(!r.meta.changes)throw new HttpError(409,'Перенос доступен для действующей заявки');return json({id,totalPrice:total,status:'pending',expiresAt});
   }
  }
  throw new HttpError(404,'Маршрут не найден');
 }catch(e){
  if(e instanceof HttpError)return json({message:e.message},e.status);
  if(e instanceof RangeError)return json({message:e.message},400);
  if(String(e).includes('booking_overlap'))return json({message:'Это время занято. При переносе исходное бронирование сохранено.'},409);
  console.error('Seatly request failed:',e instanceof Error?e.name:'UnknownError');return json({message:'Сервис временно недоступен. Изменения не подтверждены.'},503);
 }
}
