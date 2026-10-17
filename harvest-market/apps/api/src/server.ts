import { createApp } from './app.js';
import { openDb } from './db.js';
import { validateOpenPaymentsConfig } from './openPayments.js';
const paymentMode=process.env.PAYMENT_MODE||'simulation';
if(paymentMode==='open-payments')validateOpenPaymentsConfig();
else if(paymentMode!=='simulation')throw new Error('PAYMENT_MODE must be simulation or open-payments.');
createApp(openDb(undefined,false)).listen(Number(process.env.PORT||4000),'127.0.0.1',()=>console.log('Harvest API http://127.0.0.1:4000 — '+(paymentMode==='simulation'?'simulated payments only':'Open Payments wallet diagnostics enabled; live transfers remain disabled')));
