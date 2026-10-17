import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { allocation } from '../src/domain.js';

const testPhases=[
 {name:'Inputs',description:'Buy fertilizer and prepare the land.',percentage_bps:4000},
 {name:'Growing season',description:'Maintain the crop and pay farm workers.',percentage_bps:3500},
 {name:'Harvest',description:'Pick, sort, and pack the harvest.',percentage_bps:2500}
];

test('production database initialization can leave all tables empty',()=>{
 const db=openDb(':memory:',false);
 try {
  for(const table of ['users','sessions','projects','orders','payments','journal','requests','updates','agreements','project_phases','phase_progress']){
   assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count,0,`${table} should start empty`);
  }
 } finally {db.close();}
});

test('a grower can enter directly, publish a capital request, and see all grower projects',async()=>{
 const db=openDb(':memory:',false);const server=createApp(db).listen(0,'127.0.0.1');await once(server,'listening');const address=server.address() as {port:number};const base='http://127.0.0.1:'+address.port+'/api';
 try{
  const entry=await fetch(base+'/demo-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:'farmer'})});
  assert.equal(entry.status,200);
  const cookie=entry.headers.get('set-cookie')!.split(';')[0];
  const created=await fetch(base+'/projects',{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({title:'Coffee harvest request',description:'Capital for organic fertilizer and seasonal harvest labor.',product:'Coffee',location:'Huila, Colombia',currency:'COP',principal:1000000000,quantity:100,unit_price:20000000,share_bps:1500,harvest_months:6,phases:testPhases})});
  assert.equal(created.status,201);
  const result=await created.json() as {id:string};
  const belowPrincipal=await fetch(base+'/projects',{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({title:'Underfunded coffee harvest',description:'This planned sales total is below the requested capital amount.',product:'Coffee',location:'Huila, Colombia',currency:'COP',principal:1000000000,quantity:100,unit_price:5000000,share_bps:1500,phases:testPhases})});
  assert.equal(belowPrincipal.status,400);
  assert.match((await belowPrincipal.json()).error,/precio mínimo es COP\s*100\.000 por unidad/i);
  const badPhasePlan=await fetch(base+'/projects',{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({title:'Invalid phase plan',description:'Three phase allocations that do not sum correctly.',product:'Coffee',location:'Huila, Colombia',currency:'COP',principal:1000000000,quantity:100,unit_price:20000000,share_bps:1500,phases:[...testPhases.slice(0,2),{...testPhases[2],percentage_bps:2400}]})});
  assert.equal(badPhasePlan.status,400);
  assert.match((await badPhasePlan.json()).error,/fases deben sumar exactamente 100%/i);
  const dashboardResponse=await fetch(base+'/dashboard',{headers:{cookie}});
  assert.equal(dashboardResponse.status,200);
  const ownDashboard=await dashboardResponse.json() as {projects:{id:string;phases:{phase_number:number;percentage_bps:number;amount:number;source:string}[]}[]};
  assert.deepEqual(ownDashboard.projects.map(project=>project.id),[result.id]);
  assert.deepEqual(ownDashboard.projects[0].phases.map(phase=>phase.percentage_bps),[4000,3500,2500]);
  assert.equal(ownDashboard.projects[0].phases.reduce((sum,phase)=>sum+phase.amount,0),1000000000);
  assert.ok(ownDashboard.projects[0].phases.every(phase=>phase.source==='GROWER'));
  db.prepare("INSERT INTO users(id,name,email,password,role) VALUES('other-grower','Other Grower','other@example.test','','farmer')").run();
  db.prepare("INSERT INTO projects(id,farmer_id,title,description,product,location,currency,principal,quantity,unit_price,share_bps) VALUES('other-project','other-grower','Other coffee harvest','A separate grower capital request.','Coffee','Cauca, Colombia','COP',100000,10,20000,1000)").run();
  const collectiveDashboard=await fetch(base+'/dashboard',{headers:{cookie}});
  const collective=await collectiveDashboard.json() as {projects:{id:string}[]};
  assert.deepEqual(collective.projects.map(project=>project.id).sort(),['other-project',result.id].sort());
  const buyerEntry=await fetch(base+'/demo-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:'buyer'})});
  const buyerProjects=await fetch(base+'/projects',{headers:{cookie:buyerEntry.headers.get('set-cookie')!.split(';')[0]}});
  const marketplace=await buyerProjects.json() as {id:string;status:string;product:string;phases:{percentage_bps:number;amount:number}[]}[];
  assert.ok(marketplace.some(project=>project.id===result.id&&project.status==='FUNDING'&&project.product==='Coffee'));
  const buyerProject=marketplace.find(project=>project.id===result.id)!;
  assert.equal(buyerProject.phases.length,3);
  assert.equal(buyerProject.phases.reduce((sum,phase)=>sum+phase.amount,0),1000000000);
 }finally{server.close();db.close();}
});

test('revoked sessions are rejected and their browser cookie is cleared',async()=>{
 const db=openDb(':memory:',false);const server=createApp(db).listen(0,'127.0.0.1');await once(server,'listening');const address=server.address() as {port:number};const base='http://127.0.0.1:'+address.port+'/api';
 try{
  const entry=await fetch(base+'/demo-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:'farmer'})});
  const cookie=entry.headers.get('set-cookie')!.split(';')[0];
  db.prepare('DELETE FROM sessions').run();
  const response=await fetch(base+'/dashboard',{headers:{cookie}});
  assert.equal(response.status,401);
  assert.match((await response.json()).error,/sesión no es válida/i);
  assert.match(response.headers.get('set-cookie')||'',/harvest_session=;/);
 }finally{server.close();db.close();}
});

test('principal is repaid and only profit is shared, with exact remainder',()=>{
 assert.deepEqual(allocation(100000,200000,3000),{principal:100000,revenue:200000,profit:100000,royalty:30000,commission:6000,investor:130000,farmer:64000});
 const x=allocation(100,103,3333,0);assert.equal(x.investor+x.farmer,103);assert.equal(x.royalty,0);
 assert.throws(()=>allocation(100,90,3000));
 assert.throws(()=>allocation(100,101,9000,3000));
});
test('demo marketplace starts with a funded citrus harvest ready to sell',()=>{
 const db=openDb(':memory:');
 try {
  const citrus=db.prepare("SELECT status,investor_id FROM projects WHERE id='citrus'").get() as {status:string;investor_id:string};
  assert.equal(citrus.status,'SELLING');
  assert.equal(citrus.investor_id,'investor');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agreements WHERE project_id='citrus'").get()?.n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payments WHERE project_id='citrus' AND kind='FUNDING'").get()?.n,1);
  const migratedPhases=db.prepare("SELECT percentage_bps,amount,status,source FROM project_phases WHERE project_id='citrus' ORDER BY phase_number").all() as {percentage_bps:number;amount:number;status:string;source:string}[];
  assert.equal(migratedPhases.length,3);
  assert.deepEqual(migratedPhases.map(phase=>phase.percentage_bps),[4000,3500,2500]);
  assert.equal(migratedPhases.reduce((sum,phase)=>sum+phase.amount,0),60000);
  assert.ok(migratedPhases.every(phase=>phase.status==='RELEASED'&&phase.source==='MIGRATION'));
  const campaign=db.prepare("SELECT status,currency,principal,share_bps,harvest_months FROM projects WHERE id='huila-coffee'").get() as {status:string;currency:string;principal:number;share_bps:number;harvest_months:number};
  assert.equal(campaign.status,'FUNDING');
  assert.equal(campaign.currency,'COP');
  assert.equal(campaign.principal,1000000000);
  assert.equal(campaign.share_bps,1500);
  assert.equal(campaign.harvest_months,6);
  const lot=db.prepare("SELECT status,currency,quantity,unit_price,sca_score,moisture_pct,deforestation_free FROM projects WHERE id='huila-specialty-lot'").get() as {status:string;currency:string;quantity:number;unit_price:number;sca_score:number;moisture_pct:number;deforestation_free:number};
  assert.equal(lot.status,'SELLING');
  assert.equal(lot.currency,'EUR');
  assert.equal(lot.quantity*lot.unit_price,350000);
  assert.equal(lot.sca_score,86.5);
  assert.equal(lot.moisture_pct,10.5);
  assert.equal(lot.deforestation_free,1);
 } finally {db.close();}
});
test('COP harvest funding and final sale settle the grower margin in simulated COP',async()=>{
 const db=openDb(':memory:');const server=createApp(db).listen(0,'127.0.0.1');await once(server,'listening');const address=server.address() as {port:number};const base='http://127.0.0.1:'+address.port+'/api';
 async function request(path:string,body?:unknown,cookie='') {const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','cookie':cookie,'idempotency-key':crypto.randomUUID()},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]||''};}
 try{
  const investor=(await request('/login',{email:'investor@harvest.demo',password:'HarvestDemo123!'})).cookie;
  const farmer=(await request('/login',{email:'farmer@harvest.demo',password:'HarvestDemo123!'})).cookie;
  const buyer=(await request('/login',{email:'buyer@harvest.demo',password:'HarvestDemo123!'})).cookie;
  assert.equal((await request('/projects/huila-coffee/fund',{acceptTerms:true},investor)).status,200);
  assert.equal((await request('/projects/huila-coffee/phase-progress',{phase_number:1,body:'Field preparation is underway.'},farmer)).status,400);
  const legacyUpdate=await request('/projects/huila-coffee/update',{body:'Generic progress does not complete a numbered phase.'},farmer);
  assert.equal(legacyUpdate.status,400);
  assert.match(legacyUpdate.data.error,/fase correspondiente/i);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM updates WHERE project_id='huila-coffee'").get()?.count,0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM journal WHERE account='farmer:farmer' AND payment_id IN (SELECT id FROM payments WHERE project_id='huila-coffee' AND kind='FUNDING')").get()?.count,0);
  assert.equal((await request('/projects/huila-coffee/harvest',{},farmer)).status,400);
  for(const phase_number of [1,2,3])assert.equal((await request('/projects/huila-coffee/phase-release',{phase_number},farmer)).status,200);
  assert.equal(db.prepare("SELECT SUM(amount) AS amount FROM payments WHERE project_id='huila-coffee' AND kind='PHASE_DISBURSEMENT'").get()?.amount,1000000000);
  const missingEvidence=await request('/projects/huila-coffee/phase-progress',{phase_number:1,body:'A report without its required photo evidence.'},farmer);
  assert.equal(missingEvidence.status,400);
  const progress=await request('/projects/huila-coffee/phase-progress',{phase_number:1,body:'Field preparation is underway.',attachment:{name:'field.png',type:'image/png',data:'iVBORw0KGgo='}},farmer);
  assert.equal(progress.status,201);
  assert.equal(progress.data.status,'GROWING');
  assert.equal(progress.data.ready_for_sale,false);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM phase_progress WHERE project_id='huila-coffee' AND phase_number=1").get()?.count,1);
  const duplicateProgress=await request('/projects/huila-coffee/phase-progress',{phase_number:1,body:'A duplicate report should not advance the same phase again.',attachment:{name:'duplicate.png',type:'image/png',data:'iVBORw0KGgo='}},farmer);
  assert.equal(duplicateProgress.status,409);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM phase_progress WHERE project_id='huila-coffee' AND phase_number=1").get()?.count,1);
  const visibleProgress=await request('/projects',undefined,buyer);
  const publicProject=visibleProgress.data.find((project:{id:string})=>project.id==='huila-coffee');
  assert.equal(publicProject.phases[0].progress[0].body,'Field preparation is underway.');
  const evidence=await fetch(base+`/projects/huila-coffee/phases/1/progress/${progress.data.id}/attachment`,{headers:{cookie:buyer}});
  assert.equal(evidence.status,200);
  assert.equal(evidence.headers.get('content-type'),'image/png');
  assert.deepEqual([...new Uint8Array(await evidence.arrayBuffer())],[137,80,78,71,13,10,26,10]);
  const secondProgress=await request('/projects/huila-coffee/phase-progress',{phase_number:2,body:'The crop maintenance phase is complete.',attachment:{name:'phase-2.png',type:'image/png',data:'iVBORw0KGgo='}},farmer);
  assert.equal(secondProgress.data.status,'GROWING');
  const finalProgress=await request('/projects/huila-coffee/phase-progress',{phase_number:3,body:'The harvest is picked and packed for sale.',attachment:{name:'phase-3.png',type:'image/png',data:'iVBORw0KGgo='}},farmer);
  assert.equal(finalProgress.status,201);
  assert.equal(finalProgress.data.status,'SELLING');
  assert.equal(finalProgress.data.ready_for_sale,true);
  const readyProjects=await request('/projects',undefined,buyer);
  assert.equal(readyProjects.data.find((project:{id:string})=>project.id==='huila-coffee').status,'SELLING');
  const buyerPost=await request('/projects/huila-coffee/phase-progress',{phase_number:1,body:'A buyer cannot post as the grower.',attachment:{name:'field.png',type:'image/png',data:'iVBORw0KGgo='}},buyer);
  assert.equal(buyerPost.status,403);
  const invalidEvidence=await request('/projects/huila-coffee/phase-progress',{phase_number:1,body:'A second progress report with bad evidence.',attachment:{name:'not-an-image.png',type:'image/png',data:'dGVzdA=='}},farmer);
  assert.equal(invalidEvidence.status,400);
  assert.equal((await request('/projects/huila-coffee/harvest',{},farmer)).status,400);
  const sale=await request('/projects/huila-coffee/buy',{quantity:100},buyer);
  assert.equal(sale.status,200);
  assert.equal(sale.data.distribution.investor,1150000000);
  assert.equal(sale.data.distribution.commission,60000000);
  assert.equal(sale.data.distribution.farmer,790000000);
  assert.equal(db.prepare("SELECT currency FROM payments WHERE project_id='huila-coffee' AND kind='FARMER_PROFIT'").get()?.currency,'COP');
  assert.equal(db.prepare("SELECT amount FROM payments WHERE project_id='huila-coffee' AND kind='DAPP_COMMISSION'").get()?.amount,60000000);
  assert.equal(db.prepare("SELECT status FROM projects WHERE id='huila-coffee'").get()?.status,'DISTRIBUTED');
 }finally{server.close();db.close();}
});
test('B2B €3,500 coffee invoice atomically splits investor, farmer, and 3% dApp fee',async()=>{
 const db=openDb(':memory:');const server=createApp(db).listen(0,'127.0.0.1');await once(server,'listening');const address=server.address() as {port:number};const base='http://127.0.0.1:'+address.port+'/api';
 try{
  const login=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'buyer@harvest.demo',password:'HarvestDemo123!'})});
  const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const sale=await fetch(base+'/projects/huila-specialty-lot/buy',{method:'POST',headers:{'content-type':'application/json',cookie,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({quantity:100})});
  assert.equal(sale.status,200);
  const result=await sale.json();
  assert.equal(result.distribution.revenue,350000);
  assert.equal(result.distribution.investor,307500);
  assert.equal(result.distribution.farmer,32000);
  assert.equal(result.distribution.commission,10500);
  assert.equal(result.distribution.investor+result.distribution.farmer+result.distribution.commission,result.distribution.revenue);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payments WHERE project_id='huila-specialty-lot' AND kind IN ('INVESTOR_RETURN','FARMER_PROFIT','DAPP_COMMISSION')").get()?.n,3);
  assert.equal(db.prepare("SELECT SUM(amount) AS n FROM journal WHERE account='proceeds:huila-specialty-lot'").get()?.n,0);
 }finally{server.close();db.close();}
});
test('fund → harvest → buy → automatic distribution; authorization and replay safety',async()=>{
 const db=openDb(':memory:');const server=createApp(db).listen(0,'127.0.0.1');await once(server,'listening');const address=server.address() as {port:number};const base='http://127.0.0.1:'+address.port+'/api';
 async function request(path:string,body?:unknown,cookie='',key=crypto.randomUUID()) {const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','cookie':cookie,'idempotency-key':key},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]||''};}
 try {
  assert.equal((await request('/dashboard')).status,401);
  const farmer=(await request('/login',{email:'farmer@harvest.demo',password:'HarvestDemo123!'})).cookie;
  const investor=(await request('/login',{email:'investor@harvest.demo',password:'HarvestDemo123!'})).cookie;
  const buyer=(await request('/login',{email:'buyer@harvest.demo',password:'HarvestDemo123!'})).cookie;
  const created=await request('/projects',{title:'New coffee harvest',description:'A seasonal coffee harvest project in Colombia.',product:'Coffee',location:'Nariño, Colombia',currency:'EUR',principal:1001,quantity:1,unit_price:1001,share_bps:1500,variety:'Washed Caturra',sca_score:86.5,moisture_pct:10.5,deforestation_free:true,phases:testPhases},farmer);
  assert.equal(created.status,201);
  assert.equal(db.prepare('SELECT harvest_months FROM projects WHERE id=?').get(created.data.id)?.harvest_months,6);
  assert.deepEqual(db.prepare('SELECT amount FROM project_phases WHERE project_id=? ORDER BY phase_number').all(created.data.id).map((phase:{amount:number})=>phase.amount),[400,350,251]);
  const newLot=db.prepare('SELECT variety,sca_score,moisture_pct,deforestation_free FROM projects WHERE id=?').get(created.data.id) as {variety:string;sca_score:number;moisture_pct:number;deforestation_free:number};
  assert.equal(newLot.variety,'Washed Caturra');
  assert.equal(newLot.sca_score,86.5);
  assert.equal(newLot.moisture_pct,10.5);
  assert.equal(newLot.deforestation_free,1);
  assert.equal((await request('/projects/orchard/harvest',{},farmer)).status,400);
  assert.equal((await request('/projects/orchard/fund',{acceptTerms:true},buyer)).status,400);
  assert.equal((await request('/projects/orchard/fund',{acceptTerms:false},investor)).status,400);
  const fundingKey=crypto.randomUUID();assert.equal((await request('/projects/orchard/fund',{acceptTerms:true},investor,fundingKey)).status,200);
  assert.equal((await request('/projects/orchard/fund',{acceptTerms:true},investor,fundingKey)).status,200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payments WHERE project_id='orchard' AND kind='FUNDING'").get()?.n,1);
  assert.equal(db.prepare("SELECT SUM(amount) AS n FROM journal WHERE account='escrow:orchard'").get()?.n,100000);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM journal WHERE account='farmer:farmer' AND payment_id IN (SELECT id FROM payments WHERE project_id='orchard' AND kind='FUNDING')").get()?.n,0);
  assert.equal((await request('/projects/orchard/phase-release',{phase_number:2},farmer)).status,400);
  assert.equal((await request('/projects/orchard/phase-release',{phase_number:1},investor)).status,400);
  const phaseKey=crypto.randomUUID();
  assert.equal((await request('/projects/orchard/phase-release',{phase_number:1},farmer,phaseKey)).status,200);
  assert.equal((await request('/projects/orchard/phase-release',{phase_number:1},farmer,phaseKey)).status,200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payments WHERE project_id='orchard' AND kind='PHASE_DISBURSEMENT'").get()?.n,1);
  assert.equal((await request('/projects/orchard/phase-release',{phase_number:2},farmer)).status,200);
  assert.equal((await request('/projects/orchard/phase-release',{phase_number:3},farmer)).status,200);
  assert.equal(db.prepare("SELECT SUM(amount) AS n FROM journal WHERE account='escrow:orchard'").get()?.n,0);
  assert.equal((await request('/projects/orchard/harvest',{},buyer)).status,400);
  assert.equal((await request('/projects/orchard/harvest',{},farmer)).status,400);
  for(const phase_number of [1,2,3]){
   const phaseProgress=await request('/projects/orchard/phase-progress',{phase_number,body:`Orchard work for phase ${phase_number} is complete.`,attachment:{name:'field.png',type:'image/png',data:'iVBORw0KGgo='}},farmer);
   assert.equal(phaseProgress.status,201);
   if(phase_number<3)assert.equal(phaseProgress.data.status,'GROWING');
   else assert.equal(phaseProgress.data.ready_for_sale,true);
  }
  assert.equal(db.prepare("SELECT status FROM projects WHERE id='orchard'").get()?.status,'SELLING');
  assert.equal((await request('/projects/orchard/buy',{quantity:2001},buyer)).status,400);
  const orderKey=crypto.randomUUID();assert.equal((await request('/projects/orchard/buy',{quantity:1500},buyer,orderKey)).status,200);
  assert.equal((await request('/projects/orchard/buy',{quantity:1500},buyer,orderKey)).status,200);
  assert.equal((await request('/projects/orchard/buy',{quantity:1},buyer,orderKey)).status,400);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payments WHERE kind='INVESTOR_RETURN'").get()?.n,0);
  const finalKey=crypto.randomUUID();const final=await request('/projects/orchard/buy',{quantity:500},buyer,finalKey);assert.equal(final.status,200);assert.equal(final.data.distribution.investor,130000);assert.equal(final.data.distribution.commission,6000);assert.equal(final.data.distribution.farmer,64000);
  assert.equal((await request('/projects/orchard/buy',{quantity:500},buyer,finalKey)).status,200);
  assert.equal((await request('/projects/orchard/buy',{quantity:1},buyer)).status,400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get()?.n,2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payments WHERE kind='INVESTOR_RETURN'").get()?.n,1);
  assert.equal(db.prepare("SELECT status FROM projects WHERE id='orchard'").get()?.status,'DISTRIBUTED');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM (SELECT payment_id FROM journal GROUP BY payment_id HAVING SUM(amount)<>0)').get()?.n,0);
  assert.equal(db.prepare("SELECT SUM(amount) AS n FROM journal WHERE account='proceeds:orchard'").get()?.n,0);
  const dashboard=await request('/dashboard',undefined,buyer);assert.equal(dashboard.data.payments.length,0);assert.equal(dashboard.data.orders.length,2);
  assert.equal((await request('/projects',{title:'Unauthorized'},investor)).status,403);
  await request('/logout',{},buyer);assert.equal((await request('/me',undefined,buyer)).status,401);
 } finally {server.close();db.close();}
});
test('competing purchases cannot oversell',async()=>{
 const db=openDb(':memory:');db.exec("UPDATE projects SET status='SELLING',investor_id='investor',quantity=2,principal=100,unit_price=100 WHERE id='orchard'");
 const server=createApp(db).listen(0,'127.0.0.1');await once(server,'listening');const address=server.address() as {port:number};const base='http://127.0.0.1:'+address.port+'/api';
 try {const login=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'buyer@harvest.demo',password:'HarvestDemo123!'})});const cookie=login.headers.get('set-cookie')!.split(';')[0];
 const responses=await Promise.all([1,2].map(()=>fetch(base+'/projects/orchard/buy',{method:'POST',headers:{'content-type':'application/json',cookie,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({quantity:2})})));
 assert.deepEqual(responses.map(x=>x.status).sort(),[200,400]);assert.equal(db.prepare("SELECT sold FROM projects WHERE id='orchard'").get()?.sold,2);
 }finally{server.close();db.close();}
});
