import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
export function openDb(path = process.env.DB_PATH || 'harvest.sqlite', seedDemo = true) {
 const db = new DatabaseSync(path);
 db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,farmer_id TEXT NOT NULL REFERENCES users(id),investor_id TEXT REFERENCES users(id),title TEXT NOT NULL,description TEXT NOT NULL,product TEXT NOT NULL,location TEXT NOT NULL,currency TEXT NOT NULL CHECK(currency IN ('USD','EUR','COP')),principal INTEGER NOT NULL,quantity INTEGER NOT NULL,unit_price INTEGER NOT NULL,share_bps INTEGER NOT NULL,harvest_months INTEGER NOT NULL DEFAULT 6,variety TEXT NOT NULL DEFAULT '',sca_score REAL,moisture_pct REAL,deforestation_free INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'FUNDING',sold INTEGER NOT NULL DEFAULT 0,revenue INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),buyer_id TEXT NOT NULL REFERENCES users(id),quantity INTEGER NOT NULL,amount INTEGER NOT NULL,currency TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),kind TEXT NOT NULL,amount INTEGER NOT NULL,currency TEXT NOT NULL,status TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'simulation',created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS journal(id INTEGER PRIMARY KEY AUTOINCREMENT,payment_id TEXT NOT NULL REFERENCES payments(id),account TEXT NOT NULL,amount INTEGER NOT NULL,currency TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS requests(user_id TEXT NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(user_id,key));
 CREATE TABLE IF NOT EXISTS updates(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),body TEXT NOT NULL,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS agreements(project_id TEXT PRIMARY KEY REFERENCES projects(id),investor_id TEXT NOT NULL REFERENCES users(id),principal INTEGER NOT NULL,share_bps INTEGER NOT NULL,quantity INTEGER NOT NULL,currency TEXT NOT NULL,accepted TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 `);
 const projectColumns=db.prepare('PRAGMA table_info(projects)').all() as {name:string}[];
 if(!projectColumns.some(column=>column.name==='harvest_months'))db.exec('ALTER TABLE projects ADD COLUMN harvest_months INTEGER NOT NULL DEFAULT 6');
 if(!projectColumns.some(column=>column.name==='variety'))db.exec("ALTER TABLE projects ADD COLUMN variety TEXT NOT NULL DEFAULT ''");
 if(!projectColumns.some(column=>column.name==='sca_score'))db.exec('ALTER TABLE projects ADD COLUMN sca_score REAL');
 if(!projectColumns.some(column=>column.name==='moisture_pct'))db.exec('ALTER TABLE projects ADD COLUMN moisture_pct REAL');
 if(!projectColumns.some(column=>column.name==='deforestation_free'))db.exec('ALTER TABLE projects ADD COLUMN deforestation_free INTEGER NOT NULL DEFAULT 0');
 const projectSchema=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'").get() as {sql:string}|undefined;
 if(projectSchema&&!projectSchema.sql.includes("'COP'")){
  db.exec('PRAGMA foreign_keys=OFF');
  try{
   db.exec(`BEGIN;
    CREATE TABLE projects_new(id TEXT PRIMARY KEY,farmer_id TEXT NOT NULL REFERENCES users(id),investor_id TEXT REFERENCES users(id),title TEXT NOT NULL,description TEXT NOT NULL,product TEXT NOT NULL,location TEXT NOT NULL,currency TEXT NOT NULL CHECK(currency IN ('USD','EUR','COP')),principal INTEGER NOT NULL,quantity INTEGER NOT NULL,unit_price INTEGER NOT NULL,share_bps INTEGER NOT NULL,harvest_months INTEGER NOT NULL DEFAULT 6,variety TEXT NOT NULL DEFAULT '',sca_score REAL,moisture_pct REAL,deforestation_free INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'FUNDING',sold INTEGER NOT NULL DEFAULT 0,revenue INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO projects_new(id,farmer_id,investor_id,title,description,product,location,currency,principal,quantity,unit_price,share_bps,harvest_months,variety,sca_score,moisture_pct,deforestation_free,status,sold,revenue,created)
     SELECT id,farmer_id,investor_id,title,description,product,location,currency,principal,quantity,unit_price,share_bps,harvest_months,variety,sca_score,moisture_pct,deforestation_free,status,sold,revenue,created FROM projects;
    DROP TABLE projects;
    ALTER TABLE projects_new RENAME TO projects;
    COMMIT;`);
  }catch(error){try{db.exec('ROLLBACK');}finally{db.exec('PRAGMA foreign_keys=ON');}throw error;}
  db.exec('PRAGMA foreign_keys=ON');
 }
 db.exec(`CREATE TABLE IF NOT EXISTS project_phases(
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_number INTEGER NOT NULL CHECK(phase_number BETWEEN 1 AND 3),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  percentage_bps INTEGER NOT NULL CHECK(percentage_bps BETWEEN 1 AND 10000),
  amount INTEGER NOT NULL CHECK(amount>=0),
  status TEXT NOT NULL CHECK(status IN ('PROPOSED','FUNDED','RELEASED')),
  source TEXT NOT NULL DEFAULT 'MIGRATION' CHECK(source IN ('GROWER','MIGRATION')),
  released_at TEXT,
  PRIMARY KEY(project_id,phase_number)
 );
 CREATE TABLE IF NOT EXISTS phase_progress(
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  phase_number INTEGER NOT NULL,
  grower_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  attachment_name TEXT,
  attachment_type TEXT,
  attachment_data BLOB,
  created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id,phase_number) REFERENCES project_phases(project_id,phase_number) ON DELETE CASCADE
 )`);
 db.exec(`DELETE FROM phase_progress
  WHERE id NOT IN (
   SELECT latest.id FROM phase_progress latest
   WHERE latest.id=(SELECT progress.id FROM phase_progress progress WHERE progress.project_id=latest.project_id AND progress.phase_number=latest.phase_number ORDER BY progress.created DESC,progress.id DESC LIMIT 1)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS phase_progress_once_per_phase ON phase_progress(project_id,phase_number);`);
 if (seedDemo && !db.prepare('SELECT id FROM users LIMIT 1').get()) {
  const salt=randomBytes(16).toString('hex'); const password=salt+':'+scryptSync('HarvestDemo123!',salt,64).toString('hex');
  const insert=db.prepare('INSERT INTO users VALUES(?,?,?,?,?)');
  insert.run('farmer','Elena Rivera','farmer@harvest.demo',password,'farmer'); insert.run('investor','Alex Morgan','investor@harvest.demo',password,'investor'); insert.run('buyer','Jordan Lee','buyer@harvest.demo',password,'buyer');
  const project=db.prepare('INSERT INTO projects(id,farmer_id,title,description,product,location,currency,principal,quantity,unit_price,share_bps,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  project.run('orchard','farmer','A better season, one apple at a time','Help an independent grower bring 2,000 crisp orchard apples to market. Your investment covers this production cycle, with a transparent share of the harvest profit.','Apples','Boyacá, Colombia','USD',100000,2000,100,3000,'FUNDING');
  project.run('citrus','farmer','Sun-grown citrus, locally rooted','Freshly picked oranges from an independent Valencian grower. Order a seasonal harvest directly from the farm while supplies last.','Oranges','Valencia, Spain','EUR',60000,1000,120,2500,'FUNDING');
 }
 if(seedDemo&&!db.prepare("SELECT id FROM projects WHERE id='huila-coffee'").get()){
  db.prepare('INSERT INTO projects(id,farmer_id,title,description,product,location,currency,principal,quantity,unit_price,share_bps,harvest_months,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('huila-coffee','farmer','Huila coffee cooperative · next harvest','Demo campaign: COP 10,000,000 for organic inputs and harvest labor, backed by a 100-bag coffee harvest. Six-month timeline; the grower receives the remaining harvest margin after the agreed investor share.','Coffee','Huila, Colombia','COP',1000000000,100,20000000,1500,6,'FUNDING');
 }
 if(seedDemo)db.prepare("UPDATE projects SET description=?,currency='COP',principal=1000000000,quantity=100,unit_price=20000000,share_bps=1500,harvest_months=6,variety='Caturra / Castillo',sca_score=86.5,moisture_pct=10.5,deforestation_free=1 WHERE id='huila-coffee' AND investor_id IS NULL AND status='FUNDING'").run('Demo campaign: COP 10,000,000 for organic inputs and harvest labor, backed by a 100-bag coffee harvest. Six-month timeline; the grower receives the remaining harvest margin after the agreed investor share.');
 if(seedDemo&&!db.prepare("SELECT id FROM projects WHERE id='huila-cop-capital'").get()&&!db.prepare("SELECT id FROM projects WHERE product IN ('Coffee','Cacao') AND currency='COP' AND status='FUNDING'").get()){
  db.prepare('INSERT INTO projects(id,farmer_id,title,description,product,location,currency,principal,quantity,unit_price,share_bps,harvest_months,variety,sca_score,moisture_pct,deforestation_free) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('huila-cop-capital','farmer','Huila cooperative · organic inputs and jornales','Demo funding request: COP 10,000,000 for organic farm inputs and harvest labor, backed by the next 100-bag coffee lot. Six-month harvest timeline and profit-share terms are disclosed before funding.','Coffee','Huila, Colombia','COP',1000000000,100,20000000,1500,6,'Caturra / Castillo',86.5,10.5,1);
 }
 if(seedDemo){
 const marketLots=[
  {id:'huila-specialty-lot',title:'Huila microlot · washed Caturra',description:'Demo traceability profile for a 100-bag specialty coffee lot from Elena Rivera and the Huila growers cooperative. Funded by Alex Morgan; lot proceeds split automatically in this simulation.',product:'Coffee',location:'Huila, Colombia',principal:300000,quantity:100,unit_price:3500,share_bps:1500,harvest_months:6,variety:'Washed Caturra',sca_score:86.5,moisture_pct:10.5},
  {id:'santander-cacao-lot',title:'Santander cacao · fine aroma',description:'Demo traceability profile for a 100-bag fine-aroma cacao lot from Elena Rivera and the Santander cooperative. Funded by Alex Morgan; lot proceeds split automatically in this simulation.',product:'Cacao',location:'Santander, Colombia',principal:200000,quantity:100,unit_price:2500,share_bps:1200,harvest_months:5,variety:'Fino de aroma · FSV-41',sca_score:null,moisture_pct:7}
 ];
 for(const lot of marketLots){
  if(db.prepare('SELECT id FROM projects WHERE id=?').get(lot.id))continue;
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare("INSERT INTO projects(id,farmer_id,investor_id,title,description,product,location,currency,principal,quantity,unit_price,share_bps,harvest_months,variety,sca_score,moisture_pct,deforestation_free,status) VALUES(?,?,'investor',?,?,?,?,'EUR',?,?,?,?,?,?,?, ?,1,'SELLING')").run(lot.id,'farmer',lot.title,lot.description,lot.product,lot.location,lot.principal,lot.quantity,lot.unit_price,lot.share_bps,lot.harvest_months,lot.variety,lot.sca_score,lot.moisture_pct);
   db.prepare('INSERT INTO agreements(project_id,investor_id,principal,share_bps,quantity,currency) VALUES(?,?,?,?,?,?)').run(lot.id,'investor',lot.principal,lot.share_bps,lot.quantity,'EUR');
   const paymentId=randomUUID();
   db.prepare("INSERT INTO payments(id,project_id,kind,amount,currency,status) VALUES(?,?,'FUNDING',?,'EUR','SIMULATED_COMPLETED')").run(paymentId,lot.id,lot.principal);
   const journal=db.prepare('INSERT INTO journal(payment_id,account,amount,currency) VALUES(?,?,? ,?)');
   journal.run(paymentId,'farmer:farmer',lot.principal,'EUR');
   journal.run(paymentId,'investor:investor',-lot.principal,'EUR');
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 db.prepare("UPDATE projects SET description=? WHERE id='huila-specialty-lot' AND description LIKE 'Traceable 100-bag%'").run('Demo traceability profile for a 100-bag specialty coffee lot from Elena Rivera and the Huila growers cooperative. Funded by Alex Morgan; lot proceeds split automatically in this simulation.');
 db.prepare("UPDATE projects SET description=? WHERE id='santander-cacao-lot' AND description LIKE 'Traceable 100-bag%'").run('Demo traceability profile for a 100-bag fine-aroma cacao lot from Elena Rivera and the Santander cooperative. Funded by Alex Morgan; lot proceeds split automatically in this simulation.');
 const citrus=db.prepare("SELECT id,farmer_id,principal,share_bps,quantity,currency,investor_id,status FROM projects WHERE id='citrus'").get() as {id:string;farmer_id:string;principal:number;share_bps:number;quantity:number;currency:string;investor_id:string|null;status:string}|undefined;
 if(citrus?.status==='FUNDING'&&!citrus.investor_id){
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare("UPDATE projects SET investor_id='investor',status='SELLING' WHERE id='citrus'").run();
   db.prepare('INSERT OR IGNORE INTO agreements(project_id,investor_id,principal,share_bps,quantity,currency) VALUES(?,?,?,?,?,?)').run(citrus.id,'investor',citrus.principal,citrus.share_bps,citrus.quantity,citrus.currency);
   const paymentId=randomUUID();
   db.prepare("INSERT INTO payments(id,project_id,kind,amount,currency,status) VALUES(?,?,'FUNDING',?,?,'SIMULATED_COMPLETED')").run(paymentId,citrus.id,citrus.principal,citrus.currency);
   const journal=db.prepare('INSERT INTO journal(payment_id,account,amount,currency) VALUES(?,?,?,?)');
   journal.run(paymentId,'farmer:'+citrus.farmer_id,citrus.principal,citrus.currency);
   journal.run(paymentId,'investor:investor',-citrus.principal,citrus.currency);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 db.prepare("UPDATE projects SET description=? WHERE id='citrus' AND description=?").run('Freshly picked oranges from an independent Valencian grower. Order a seasonal harvest directly from the farm while supplies last.','A small citrus harvest with a clear funding target and a 25% investor share of profit.');
 }
 const existingProjects=db.prepare('SELECT id,principal,investor_id,status FROM projects').all() as {id:string;principal:number;investor_id:string|null;status:string}[];
 const insertLegacyPhase=db.prepare('INSERT OR IGNORE INTO project_phases(project_id,phase_number,name,description,percentage_bps,amount,status,source) VALUES(?,?,?,?,?,?,?,?)');
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const project of existingProjects){
   const existing=db.prepare('SELECT COUNT(*) AS count,MIN(source) AS source FROM project_phases WHERE project_id=?').get(project.id) as {count:number;source:string|null};
   if(existing.count===3)continue;
   if(existing.count>0&&existing.source!=='MIGRATION')throw new Error(`Project ${project.id} has an incomplete grower-defined phase plan`);
   if(existing.count>0)db.prepare("DELETE FROM project_phases WHERE project_id=? AND source='MIGRATION'").run(project.id);
   const previouslyFunded=Boolean((project.investor_id&&db.prepare("SELECT 1 FROM payments WHERE project_id=? AND kind='FUNDING' LIMIT 1").get(project.id))||['SELLING','SOLD_OUT','DISTRIBUTED'].includes(project.status));
   const status=previouslyFunded?'RELEASED':project.investor_id?'FUNDED':'PROPOSED';
   const allocations=[4000,3500,2500];
   let allocated=0;
   for(const [index,percentage] of allocations.entries()){
    const value=index===allocations.length-1?project.principal-allocated:Math.floor(project.principal*percentage/10000);
    allocated+=value;
    insertLegacyPhase.run(project.id,index+1,`Fase ${index+1} · asignación migrada`,'Distribución provisional añadida para conservar una cosecha anterior; no fue propuesta por el cultivador.',percentage,value,status,'MIGRATION');
   }
  }
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 return db;
}
