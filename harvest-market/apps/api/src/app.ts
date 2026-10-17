import express from 'express';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { openDb } from './db.js';
import { allocation } from './domain.js';
import { getOpenPaymentsConfig, inspectConfiguredWallets } from './openPayments.js';
import { initiateFunding, completeFunding, initiatePurchase, completePurchase, checkPaymentStatus, getPaymentState, getSplitState } from './openPaymentsProvider.js';

type User={id:string;name:string;email:string;role:string};
type Project={id:string;farmer_id:string;investor_id:string|null;principal:number;quantity:number;sold:number;revenue:number;share_bps:number;unit_price:number;currency:string;status:string;[key:string]:unknown};
const amount=z.number().int().min(1).max(1000000000);
const phaseInput=z.object({name:z.string().trim().min(3).max(80),description:z.string().trim().min(5).max(500),percentage_bps:z.number().int().min(1).max(10000)});
const phaseInputs=z.array(phaseInput).length(3).superRefine((phases,ctx)=>{if(phases.reduce((sum,phase)=>sum+phase.percentage_bps,0)!==10000)ctx.addIssue({code:'custom',message:'Los porcentajes de las 3 fases deben sumar exactamente 100%'});});
export function createApp(db=openDb()) {
 const app=express(); app.disable('x-powered-by');app.use(express.json({limit:'8mb'}));
 app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');if(req.method!=='GET' && req.headers.origin && ![process.env.WEB_ORIGIN||'http://localhost:3000','http://127.0.0.1:3000'].includes(req.headers.origin))return res.status(403).json({error:'Origin not allowed'});next();});
 app.get('/api/health',(_req,res)=>res.json({ok:true,paymentMode:process.env.PAYMENT_MODE||'simulation'}));
 app.get('/api/payment-status/:paymentId',(_req,res)=>{const s=checkPaymentStatus(String(_req.params.paymentId));if(!s)return res.status(404).json({error:'Payment not found'});res.json(s);});
 app.get('/api/open-payments/status',(_req,res)=>{
  const config=getOpenPaymentsConfig();
  res.json({environment:config.environment,paymentMode:process.env.PAYMENT_MODE||'simulation',credentialsConfigured:Boolean(config.clientWalletAddress&&config.keyId&&config.privateKeyPath),walletsConfigured:Object.keys(config.wallets),liveTransfersEnabled:false});
 });
 app.get('/api/open-payments/wallets',async(_req,res,next)=>{
  try{
   const wallets=await inspectConfiguredWallets();
   res.json({wallets,fxRoute:'EUR to COP must be confirmed by the sandbox quote API before live funding is enabled'});
  }catch(error){next(error);}
 });
 const attempts=new Map<string,{count:number;until:number}>();
 app.post('/api/demo-session',(req,res)=>{
  const role=z.enum(['farmer','investor','buyer']).parse(req.body.role);
  const profiles={farmer:{id:'demo-farmer',name:'Demo Grower'},investor:{id:'demo-investor',name:'Demo Investor'},buyer:{id:'demo-buyer',name:'Demo Buyer'}} as const;
  const profile=profiles[role];
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare('INSERT OR IGNORE INTO users(id,name,email,password,role) VALUES(?,?,?,?,?)').run(profile.id,profile.name,profile.id+'@harvest.local','',role);
   const user=db.prepare('SELECT id,name,email,role FROM users WHERE id=? AND role=?').get(profile.id,role) as User|undefined;
   if(!user)throw new Error('The demo profile conflicts with an existing account');
   const token=randomBytes(32).toString('hex');
   db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token,user.id,Date.now()+86400000);
   db.exec('COMMIT');
   res.cookie('harvest_session',token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:86400000,path:'/'});
   res.json(user);
  }catch(error){db.exec('ROLLBACK');throw error;}
 });
 app.post('/api/register',(req,res)=>{
  const input=z.object({name:z.string().trim().min(2).max(100),email:z.string().trim().email().max(254),password:z.string().min(10).max(200),role:z.enum(['farmer','investor','buyer'])}).parse(req.body);
  const email=input.email.toLowerCase();
  db.exec('BEGIN IMMEDIATE');
  try{
   const salt=randomBytes(16).toString('hex');
   const password=salt+':'+scryptSync(input.password,salt,64).toString('hex');
   const inserted=db.prepare('INSERT OR IGNORE INTO users VALUES(?,?,?,?,?)').run(randomUUID(),input.name,email,password,input.role);
   if(inserted.changes===0){db.exec('ROLLBACK');return res.status(409).json({error:'An account with this email already exists'});}
   const user=db.prepare('SELECT id,name,email,role FROM users WHERE email=?').get(email) as User;
   const token=randomBytes(32).toString('hex');
   db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token,user.id,Date.now()+86400000);
   db.exec('COMMIT');
   res.cookie('harvest_session',token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:86400000,path:'/'});
   res.status(201).json(user);
  }catch(error){db.exec('ROLLBACK');throw error;}
 });
 app.post('/api/login',(req,res)=>{
  const ip=req.ip||'unknown'; const recent=attempts.get(ip); if(recent && recent.until>Date.now() && recent.count>=20)return res.status(429).json({error:'Too many attempts; retry in 15 minutes.'});
  attempts.set(ip,{count:recent && recent.until>Date.now()?recent.count+1:1,until:recent && recent.until>Date.now()?recent.until:Date.now()+900000});
  const input=z.object({email:z.string().email(),password:z.string().max(200)}).parse(req.body);
  const row=db.prepare('SELECT * FROM users WHERE email=?').get(input.email) as (User&{password:string})|undefined;
  if(!row)return res.status(401).json({error:'Invalid credentials'});
  const [salt,hash]=row.password.split(':');if(!timingSafeEqual(Buffer.from(hash,'hex'),scryptSync(input.password,salt,64)))return res.status(401).json({error:'Invalid credentials'});
  const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token,row.id,Date.now()+86400000);
  res.cookie('harvest_session',token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:86400000,path:'/'});res.json({id:row.id,name:row.name,email:row.email,role:row.role});
 });
 function includePhases(projects:{id:string}[]){return projects.map(project=>({...project,phases:(db.prepare('SELECT phase_number,name,description,percentage_bps,amount,status,source,released_at FROM project_phases WHERE project_id=? ORDER BY phase_number').all(project.id) as {phase_number:number}[]).map(phase=>({...phase,progress:db.prepare('SELECT id,body,attachment_name,attachment_type,created FROM phase_progress WHERE project_id=? AND phase_number=? ORDER BY created DESC,id DESC').all(project.id,phase.phase_number)}))}));}
 app.get('/api/projects',(_req,res)=>res.json(includePhases(db.prepare('SELECT p.*,u.name AS farmer_name,i.name AS investor_name FROM projects p JOIN users u ON u.id=p.farmer_id LEFT JOIN users i ON i.id=p.investor_id ORDER BY created DESC').all() as {id:string}[])));
 app.use('/api',(req,res,next)=>{const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('harvest_session='))?.split('=')[1];const user=db.prepare('SELECT u.id,u.name,u.email,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?').get(token||'',Date.now());if(!user){res.clearCookie('harvest_session',{path:'/'});return res.status(401).json({error:'La sesión no es válida. Elige un perfil para volver a entrar.'});}res.locals.user=user;next();});
 app.get('/api/me',(_req,res)=>res.json(res.locals.user));
 app.post('/api/logout',(req,res)=>{const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('harvest_session='))?.split('=')[1];db.prepare('DELETE FROM sessions WHERE token=?').run(token||'');res.clearCookie('harvest_session',{path:'/'});res.json({ok:true});});
 app.get('/api/dashboard',(_req,res)=>{const user=res.locals.user as User;const projects=user.role==='farmer'?db.prepare("SELECT p.* FROM projects p JOIN users f ON f.id=p.farmer_id WHERE f.role='farmer' ORDER BY p.created DESC").all() as {id:string}[]:db.prepare('SELECT * FROM projects WHERE farmer_id=? OR investor_id=?').all(user.id,user.id) as {id:string}[];const orders=db.prepare('SELECT o.*,p.title FROM orders o JOIN projects p ON p.id=o.project_id WHERE o.buyer_id=? OR p.farmer_id=?').all(user.id,user.id);const payments=db.prepare('SELECT x.*,p.title FROM payments x JOIN projects p ON p.id=x.project_id WHERE p.farmer_id=? OR p.investor_id=?').all(user.id,user.id);res.json({projects:includePhases(projects),orders,payments});});
 app.get('/api/projects/:id/updates',(req,res)=>res.json(db.prepare('SELECT * FROM updates WHERE project_id=? ORDER BY created DESC').all(String(req.params.id))));
 app.get('/api/projects/:id/phases/:phaseNumber/progress/:progressId/attachment',(req,res)=>{
  const file=db.prepare('SELECT attachment_name,attachment_type,attachment_data FROM phase_progress WHERE id=? AND project_id=? AND phase_number=?').get(String(req.params.progressId),String(req.params.id),Number(req.params.phaseNumber)) as {attachment_name:string|null;attachment_type:string|null;attachment_data:Uint8Array|null}|undefined;
  if(!file?.attachment_data||!file.attachment_name||!file.attachment_type)return res.status(404).json({error:'Evidence file not found'});
  const safeName=file.attachment_name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,160)||'evidence';
  res.setHeader('Content-Type',file.attachment_type);res.setHeader('Content-Length',file.attachment_data.byteLength);res.setHeader('Content-Disposition',`attachment; filename="${safeName}"`);res.setHeader('X-Content-Type-Options','nosniff');
  res.send(Buffer.from(file.attachment_data));
 });
 app.post('/api/projects/:id/phase-progress',(req,res)=>{
  const user=res.locals.user as User;
  const input=z.object({phase_number:z.number().int().min(1).max(3),body:z.string().trim().min(5).max(2000),attachment:z.object({name:z.string().trim().min(1).max(160),type:z.enum(['image/jpeg','image/png','image/webp','application/pdf']),data:z.string().min(1).max(7_000_000)})}).parse(req.body);
  const project=db.prepare('SELECT farmer_id,status FROM projects WHERE id=?').get(String(req.params.id)) as {farmer_id:string;status:string}|undefined;
  if(!project)return res.status(404).json({error:'Project not found'});
  if(user.id!==project.farmer_id)return res.status(403).json({error:'Only the project grower can post phase progress'});
  if(project.status!=='GROWING')return res.status(400).json({error:'Phase progress can only be posted during the growing stage'});
  const phase=db.prepare('SELECT status FROM project_phases WHERE project_id=? AND phase_number=?').get(String(req.params.id),input.phase_number) as {status:string}|undefined;
  if(!phase)return res.status(404).json({error:'Project phase not found'});
  if(phase.status!=='RELEASED')return res.status(400).json({error:'Phase progress can only be posted after its simulated disbursement'});
  let attachmentData:Buffer|null=null;
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.attachment.data))return res.status(400).json({error:'Evidence file encoding is invalid'});
  attachmentData=Buffer.from(input.attachment.data,'base64');
  if(attachmentData.length===0||attachmentData.length>5*1024*1024)return res.status(400).json({error:'Evidence files must be no larger than 5 MB'});
  const signature=input.attachment.type==='image/png'?attachmentData.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):input.attachment.type==='image/jpeg'?attachmentData[0]===255&&attachmentData[1]===216&&attachmentData[2]===255:input.attachment.type==='image/webp'?attachmentData.toString('ascii',0,4)==='RIFF'&&attachmentData.toString('ascii',8,12)==='WEBP':attachmentData.toString('ascii',0,5)==='%PDF-';
  if(!signature)return res.status(400).json({error:'Evidence must be a valid JPEG, PNG, WebP image, or PDF'});
  const id=randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try{
   if(db.prepare('SELECT 1 FROM phase_progress WHERE project_id=? AND phase_number=? LIMIT 1').get(String(req.params.id),input.phase_number)){
    db.exec('COMMIT');
    return res.status(409).json({error:'Esta fase ya está completada. Cada fase acepta un solo informe de cierre.'});
   }
   db.prepare('INSERT INTO phase_progress(id,project_id,phase_number,grower_id,body,attachment_name,attachment_type,attachment_data) VALUES(?,?,?,?,?,?,?,?)').run(id,String(req.params.id),input.phase_number,user.id,input.body,input.attachment.name,input.attachment.type,attachmentData);
   const completed=db.prepare("SELECT COUNT(*) AS count FROM project_phases p WHERE p.project_id=? AND p.status='RELEASED' AND EXISTS (SELECT 1 FROM phase_progress progress WHERE progress.project_id=p.project_id AND progress.phase_number=p.phase_number)").get(String(req.params.id)) as {count:number};
   if(completed.count===3)db.prepare("UPDATE projects SET status='SELLING' WHERE id=? AND status='GROWING'").run(String(req.params.id));
   const status=db.prepare('SELECT status FROM projects WHERE id=?').get(String(req.params.id)) as {status:string};
   db.exec('COMMIT');
   res.status(201).json({id,status:status.status,ready_for_sale:status.status==='SELLING'});
  }catch(error){db.exec('ROLLBACK');throw error;}
 });
 function pay(p:Project,kind:string,value:number,debit:string,credit:string){const id=randomUUID();db.prepare('INSERT INTO payments(id,project_id,kind,amount,currency,status) VALUES(?,?,?,?,?,?)').run(id,p.id,kind,value,p.currency,'SIMULATED_COMPLETED');const line=db.prepare('INSERT INTO journal(payment_id,account,amount,currency) VALUES(?,?,?,?)');line.run(id,debit,value,p.currency);line.run(id,credit,-value,p.currency);}
 app.post('/api/projects',(req,res)=>{
  if(res.locals.user.role!=='farmer')return res.status(403).json({error:'Farmer role required'});
  const p=z.object({title:z.string().min(5).max(120),description:z.string().min(10).max(2000),product:z.string().min(2).max(80),location:z.string().min(2).max(120),currency:z.enum(['USD','EUR','COP']),principal:amount,quantity:z.number().int().min(1).max(1000000),unit_price:amount,share_bps:z.number().int().min(0).max(10000),harvest_months:z.number().int().min(1).max(36).default(6),variety:z.string().max(120).default(''),sca_score:z.number().min(0).max(100).nullable().default(null),moisture_pct:z.number().min(0).max(100).nullable().default(null),deforestation_free:z.boolean().default(false),phases:phaseInputs}).parse(req.body);
  if(p.quantity*p.unit_price<p.principal){const minPrice=Math.ceil(p.principal/p.quantity)/100;const formatted=new Intl.NumberFormat('es-CO',{style:'currency',currency:p.currency,currencyDisplay:p.currency==='COP'?'code':'symbol',maximumFractionDigits:p.currency==='COP'?0:2}).format(minPrice);return res.status(400).json({error:`Las ventas estimadas no cubren el capital solicitado. Para ${p.quantity} unidades, el precio mínimo es ${formatted} por unidad; aumenta el precio o la cantidad.`});}
  const phaseAmounts=p.phases.map((phase,index)=>index===2?p.principal-p.phases.slice(0,2).reduce((sum,previous)=>sum+Math.floor(p.principal*previous.percentage_bps/10000),0):Math.floor(p.principal*phase.percentage_bps/10000));
  if(phaseAmounts.some(value=>value<1))return res.status(400).json({error:'Cada fase debe representar al menos una unidad mínima de la moneda solicitada. Aumenta el capital o ajusta los porcentajes.'});
  const id=randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare('INSERT INTO projects(id,farmer_id,title,description,product,location,currency,principal,quantity,unit_price,share_bps,harvest_months,variety,sca_score,moisture_pct,deforestation_free) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,res.locals.user.id,p.title,p.description,p.product,p.location,p.currency,p.principal,p.quantity,p.unit_price,p.share_bps,p.harvest_months,p.variety,p.sca_score,p.moisture_pct,p.deforestation_free?1:0);
   const insertPhase=db.prepare("INSERT INTO project_phases(project_id,phase_number,name,description,percentage_bps,amount,status,source) VALUES(?,?,?,?,?,?,'PROPOSED','GROWER')");
   p.phases.forEach((phase,index)=>insertPhase.run(id,index+1,phase.name,phase.description,phase.percentage_bps,phaseAmounts[index]));
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  res.status(201).json({id});
 });
 app.post('/api/projects/:id/:action',async(req,res)=>{
  const user=res.locals.user as User; const key=req.headers['idempotency-key'];if(typeof key!=='string'||key.length<8||key.length>100)return res.status(400).json({error:'A unique Idempotency-Key is required'});
  const fingerprint=JSON.stringify([req.params.id,req.params.action,req.body]);db.exec('BEGIN IMMEDIATE');
  try {
   const old=db.prepare('SELECT * FROM requests WHERE user_id=? AND key=?').get(user.id,key) as {fingerprint:string;response:string}|undefined;
   if(old){if(old.fingerprint!==fingerprint)throw new Error('Idempotency key already used for another operation');db.exec('COMMIT');return res.json(JSON.parse(old.response));}
   const p=db.prepare('SELECT * FROM projects WHERE id=?').get(String(req.params.id)) as Project|undefined;if(!p)throw new Error('Project not found');
   const action=req.params.action;let result:unknown={ok:true};
   if(action==='fund'){
    if(user.role!=='investor'||p.status!=='FUNDING')throw new Error('Only an investor can fund an unfunded project');
    if(req.body.acceptTerms!==true)throw new Error('Accept the investment agreement first');
    const existing=db.prepare('SELECT id FROM projects WHERE farmer_id=? AND investor_id IS NOT NULL AND investor_id<>? LIMIT 1').get(p.farmer_id,user.id);if(existing)throw new Error('This farmer already has a different investor');
    const paymentMode=process.env.PAYMENT_MODE||'simulation';
    if(paymentMode==='open-payments'){
     // Open Payments real flow: initiate payment, return redirect URL for investor consent
     const config=getOpenPaymentsConfig();
     const callbackUrl=process.env.OPEN_PAYMENTS_CALLBACK_URL||'http://localhost:3000/payment-callback';
     const funding=await initiateFunding({projectId:p.id,investorId:user.id,growerId:p.farmer_id,amount:p.principal,currency:p.currency as 'USD'|'EUR'|'COP',callbackUrl});
     // Store pending funding in DB so we can complete it on callback
     db.prepare('INSERT INTO agreements(project_id,investor_id,principal,share_bps,quantity,currency) VALUES(?,?,?,?,?,?)').run(p.id,user.id,p.principal,p.share_bps,p.quantity,p.currency);
     // Create a pending payment record
     const paymentId=randomUUID();
     db.prepare("INSERT INTO payments(id,project_id,kind,amount,currency,status,provider) VALUES(?,?,'FUNDING',?,?, 'PENDING_CONSENT','open-payments')").run(paymentId,p.id,p.principal,p.currency);
     db.prepare('INSERT INTO journal(payment_id,account,amount,currency) VALUES(?,?,?,?)').run(paymentId,'escrow:'+p.id,p.principal,p.currency);
     db.prepare('INSERT INTO journal(payment_id,account,amount,currency) VALUES(?,?,?,?)').run(paymentId,'investor:'+user.id,-p.principal,p.currency);
     // Store mapping paymentId -> open payments state (in memory via provider)
     // Don't change project status yet — wait for payment confirmation
     result={ok:true,paymentId:funding.paymentId,redirectUrl:funding.redirectUrl,interactFinish:funding.interactFinish,status:'PENDING_CONSENT',message:'Investor must approve the payment in their wallet.'};
    }else{
     // Simulation flow (original)
     db.prepare('INSERT INTO agreements(project_id,investor_id,principal,share_bps,quantity,currency) VALUES(?,?,?,?,?,?)').run(p.id,user.id,p.principal,p.share_bps,p.quantity,p.currency);
     db.prepare("UPDATE projects SET investor_id=?,status='GROWING' WHERE id=?").run(user.id,p.id);db.prepare("UPDATE project_phases SET status='FUNDED' WHERE project_id=? AND status='PROPOSED'").run(p.id);pay(p,'FUNDING',p.principal,'escrow:'+p.id,'investor:'+user.id);
    }
   }else if(action==='phase-release'){
    if(user.id!==p.farmer_id||p.status!=='GROWING')throw new Error('Solo el cultivador puede confirmar desembolsos de una cosecha financiada');
    const phaseNumber=z.number().int().min(1).max(3).parse(req.body.phase_number);
    const phase=db.prepare('SELECT * FROM project_phases WHERE project_id=? AND phase_number=?').get(p.id,phaseNumber) as {phase_number:number;amount:number;status:string}|undefined;
    if(!phase||phase.status!=='FUNDED')throw new Error('Esta fase ya fue desembolsada o aún no está financiada');
    const earlier=db.prepare("SELECT 1 FROM project_phases WHERE project_id=? AND phase_number<? AND status<>'RELEASED' LIMIT 1").get(p.id,phaseNumber);
    if(earlier)throw new Error('Confirma las fases anteriores en orden antes de continuar');
    if(phase.amount>0)pay(p,'PHASE_DISBURSEMENT',phase.amount,'farmer:'+p.farmer_id,'escrow:'+p.id);
    db.prepare("UPDATE project_phases SET status='RELEASED',released_at=CURRENT_TIMESTAMP WHERE project_id=? AND phase_number=?").run(p.id,phaseNumber);
    result={ok:true,phase_number:phaseNumber,amount:phase.amount};
   }else if(action==='harvest'){
    if(user.id!==p.farmer_id||p.status!=='GROWING')throw new Error('Only the project farmer can mark a funded harvest ready');const pendingPhases=db.prepare("SELECT COUNT(*) AS count FROM project_phases WHERE project_id=? AND status<>'RELEASED'").get(p.id) as {count:number};if(pendingPhases.count!==0)throw new Error('Confirma las tres fases de desembolso antes de marcar la cosecha lista');const missingProgress=db.prepare("SELECT COUNT(*) AS count FROM project_phases p WHERE p.project_id=? AND NOT EXISTS (SELECT 1 FROM phase_progress progress WHERE progress.project_id=p.project_id AND progress.phase_number=p.phase_number)").get(p.id) as {count:number};if(missingProgress.count!==0)throw new Error('Publica el progreso con evidencia de cada fase para habilitar la venta');db.prepare("UPDATE projects SET status='SELLING' WHERE id=?").run(p.id);
   }else if(action==='update'){
    if(user.id!==p.farmer_id)throw new Error('Only the farmer can post updates');if(p.status==='GROWING')throw new Error('Registra el avance desde la fase correspondiente; cada fase admite una sola descripción y evidencia de cierre.');const body=z.string().min(3).max(2000).parse(req.body.body);db.prepare('INSERT INTO updates(id,project_id,body) VALUES(?,?,?)').run(randomUUID(),p.id,body);
   }else if(action==='buy'){
    if(user.role!=='buyer'||p.status!=='SELLING')throw new Error('Only buyers can purchase an available harvest');const qty=z.number().int().positive().parse(req.body.quantity);if(qty>p.quantity-p.sold)throw new Error('Not enough inventory');const value=qty*p.unit_price;
    const paymentMode=process.env.PAYMENT_MODE||'simulation';
    if(paymentMode==='open-payments'&&qty+p.sold===p.quantity){
     // Full-lot purchase with Open Payments split — grower + platform + investor
     const split=allocation(p.principal,p.revenue+value,p.share_bps,300);
     const callbackUrl=process.env.OPEN_PAYMENTS_CALLBACK_URL||'http://localhost:3000/payment-callback';
     const purchase=await initiatePurchase({projectId:p.id,buyerId:user.id,investorId:p.investor_id,growerId:p.farmer_id,investorAmount:split.investor,growerAmount:split.farmer,platformAmount:split.commission,callbackUrl});
     // Record the order and update inventory in the same transaction
     db.prepare('INSERT INTO orders(id,project_id,buyer_id,quantity,amount,currency) VALUES(?,?,?,?,?,?)').run(randomUUID(),p.id,user.id,qty,value,p.currency);
     db.prepare('UPDATE projects SET sold=sold+?,revenue=revenue+?,status=? WHERE id=?').run(qty,value,'SOLD_OUT',p.id);
     // Create pending payment records for each split
     const fundPaymentId=randomUUID();
     db.prepare("INSERT INTO payments(id,project_id,kind,amount,currency,status,provider) VALUES(?,?,'SALE',?,?, 'PENDING_CONSENT','open-payments')").run(fundPaymentId,p.id,value,p.currency);
     result={ok:true,paymentId:purchase.paymentId,redirectUrl:purchase.redirectUrl,interactFinish:purchase.interactFinish,status:'PENDING_CONSENT',distribution:split,message:'Buyer must approve the split payment in their wallet.'};
    }else{
     // Simulation flow (original) — partial purchases or simulation mode
     db.prepare('INSERT INTO orders(id,project_id,buyer_id,quantity,amount,currency) VALUES(?,?,?,?,?,?)').run(randomUUID(),p.id,user.id,qty,value,p.currency);pay(p,'SALE',value,'proceeds:'+p.id,'buyer:'+user.id);
     db.prepare('UPDATE projects SET sold=sold+?,revenue=revenue+?,status=? WHERE id=?').run(qty,value,qty+p.sold===p.quantity?'SOLD_OUT':'SELLING',p.id);
     if(qty+p.sold===p.quantity){const split=allocation(p.principal,p.revenue+value,p.share_bps,300);pay(p,'INVESTOR_RETURN',split.investor,'investor:'+p.investor_id,'proceeds:'+p.id);pay(p,'FARMER_PROFIT',split.farmer,'farmer:'+p.farmer_id,'proceeds:'+p.id);pay(p,'DAPP_COMMISSION',split.commission,'dapp:treasury','proceeds:'+p.id);db.prepare("UPDATE projects SET status='DISTRIBUTED' WHERE id=?").run(p.id);result={ok:true,distribution:split};}
    }
   }else throw new Error('Unknown action');
   db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(user.id,key,fingerprint,JSON.stringify(result));db.exec('COMMIT');res.json(result);
  }catch(error){db.exec('ROLLBACK');res.status(400).json({error:error instanceof Error?error.message:'Operation failed'});}
 });
 // Payment callback endpoint — frontend calls this after user is redirected back from wallet
 app.get('/api/payment-callback',async(req,res)=>{
  const interactRef=typeof req.query.interact_ref==='string'?req.query.interact_ref:'';
  const paymentId=typeof req.query.payment_id==='string'?req.query.payment_id:'';
  if(!interactRef){return res.status(400).json({error:'Missing interact_ref parameter'});}
  if(!paymentId){return res.status(400).json({error:'Missing payment_id parameter'});}
  // Try funding state first
  const fundState=getPaymentState(paymentId);
  if(fundState){
   if(fundState.status==='COMPLETED'){return res.json({ok:true,paymentId,message:'Payment already completed'});}
   try{
    const result=await completeFunding(paymentId,interactRef);
    db.exec('BEGIN IMMEDIATE');
    try{
     db.prepare("UPDATE projects SET investor_id=?,status='GROWING' WHERE id=? AND status='FUNDING'").run(fundState.investorId,fundState.projectId);
     db.prepare("UPDATE project_phases SET status='FUNDED' WHERE project_id=? AND status='PROPOSED'").run(fundState.projectId);
     db.prepare("UPDATE payments SET status='CONFIRMED' WHERE project_id=? AND kind='FUNDING' AND provider='open-payments'").run(fundState.projectId);
     db.exec('COMMIT');
    }catch(dbError){db.exec('ROLLBACK');throw dbError;}
    res.json({ok:true,paymentId,type:'funding',outgoingPaymentId:result.outgoingPaymentId,sentAmount:result.sentAmount});
   }catch(error){
    console.error('Funding callback error:',error);
    try{db.prepare("UPDATE payments SET status='FAILED' WHERE project_id=? AND kind='FUNDING' AND provider='open-payments'").run(fundState.projectId);}catch{}
    res.status(400).json({error:error instanceof Error?error.message:'Payment failed'});
   }
   return;
  }
  // Try split purchase state
  const splitState=getSplitState(paymentId);
  if(splitState){
   if(splitState.status==='COMPLETED'){return res.json({ok:true,paymentId,message:'Split payment already completed'});}
   try{
    const result=await completePurchase(paymentId,interactRef);
    db.exec('BEGIN IMMEDIATE');
    try{
     // Update payment records and project status to DISTRIBUTED
     db.prepare("UPDATE payments SET status='CONFIRMED' WHERE project_id=? AND kind='SALE' AND provider='open-payments'").run(splitState.projectId);
     db.prepare("UPDATE projects SET status='DISTRIBUTED' WHERE id=?").run(splitState.projectId);
     // Record journal entries for each split
     const p=db.prepare('SELECT * FROM projects WHERE id=?').get(splitState.projectId) as Project;
     if(splitState.investorAmount>0&&p.investor_id){
      const invPayId=randomUUID();
      db.prepare("INSERT INTO payments(id,project_id,kind,amount,currency,status,provider) VALUES(?,?,'INVESTOR_RETURN',?,?, 'CONFIRMED','open-payments')").run(invPayId,splitState.projectId,splitState.investorAmount,p.currency);
      db.prepare('INSERT INTO journal(payment_id,account,amount,currency) VALUES(?,?,?,?)').run(invPayId,'investor:'+p.investor_id,splitState.investorAmount,p.currency);
      db.prepare('INSERT INTO journal(payment_id,account,amount,currency) VALUES(?,?,?,?)').run(invPayId,'proceeds:'+splitState.projectId,-splitState.investorAmount,p.currency);
     }
     const grwPayId=randomUUID();
     db.prepare("INSERT INTO payments(id,project_id,kind,amount,currency,status,provider) VALUES(?,?,'FARMER_PROFIT',?,?, 'CONFIRMED','open-payments')").run(grwPayId,splitState.projectId,splitState.growerAmount,p.currency);
     db.prepare('INSERT INTO journal(payment_id,account,amount,currency) VALUES(?,?,?,?)').run(grwPayId,'farmer:'+p.farmer_id,splitState.growerAmount,p.currency);
     db.prepare('INSERT INTO journal(payment_id,account,amount,currency) VALUES(?,?,?,?)').run(grwPayId,'proceeds:'+splitState.projectId,-splitState.growerAmount,p.currency);
     const platPayId=randomUUID();
     db.prepare("INSERT INTO payments(id,project_id,kind,amount,currency,status,provider) VALUES(?,?,'DAPP_COMMISSION',?,?, 'CONFIRMED','open-payments')").run(platPayId,splitState.projectId,splitState.platformAmount,p.currency);
     db.prepare('INSERT INTO journal(payment_id,account,amount,currency) VALUES(?,?,?,?)').run(platPayId,'dapp:treasury',splitState.platformAmount,p.currency);
     db.prepare('INSERT INTO journal(payment_id,account,amount,currency) VALUES(?,?,?,?)').run(platPayId,'proceeds:'+splitState.projectId,-splitState.platformAmount,p.currency);
     db.exec('COMMIT');
    }catch(dbError){db.exec('ROLLBACK');throw dbError;}
    res.json({ok:true,paymentId,type:'purchase',payments:result.payments});
   }catch(error){
    console.error('Purchase callback error:',error);
    try{db.prepare("UPDATE payments SET status='FAILED' WHERE project_id=? AND kind='SALE' AND provider='open-payments'").run(splitState.projectId);}catch{}
    res.status(400).json({error:error instanceof Error?error.message:'Split payment failed'});
   }
   return;
  }
  res.status(404).json({error:'Payment state not found — it may have expired'});
 });
 app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{if(error instanceof z.ZodError)return res.status(400).json({error:error.issues.map(x=>x.message).join('; ')});console.error(error);res.status(500).json({error:'Unexpected server error'});});
 return app;
}
