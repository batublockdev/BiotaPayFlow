'use client';
import { useState, type FormEvent } from 'react';

type PhaseProgress={
 id:string;
 body:string;
 attachment_name:string|null;
 attachment_type:string|null;
 created:string;
};

type ProjectPhase={
 phase_number:number;
 name:string;
 description:string;
 percentage_bps:number;
 amount:number;
 status:'PROPOSED'|'FUNDED'|'RELEASED';
 source:'GROWER'|'MIGRATION';
 progress:PhaseProgress[];
};

type Attachment={name:string;type:string;data:string};
type Props={
 projectId:string;
 phases:ProjectPhase[];
 currency:string;
 canRelease:boolean;
 canPostProgress:boolean;
 busy:boolean;
 onRelease:(phaseNumber:number)=>void;
 onPostProgress:(phaseNumber:number,body:string,attachment?:Attachment)=>Promise<void>;
};

const money=(amount:number,currency:string)=>new Intl.NumberFormat(currency==='COP'?'es-CO':'en-IE',{
 style:'currency',
 currency,
 currencyDisplay:currency==='COP'?'code':'symbol',
 maximumFractionDigits:currency==='COP'?0:2
}).format(amount/100);

async function encodeFile(file:File){
 const bytes=new Uint8Array(await file.arrayBuffer());
 let binary='';
 for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
 return{name:file.name,type:file.type,data:btoa(binary)};
}

export function ProjectPhases({projectId,phases,currency,canRelease,canPostProgress,busy,onRelease,onPostProgress}:Props){
 const [fileError,setFileError]=useState('');
 const readyForSale=phases.length===3&&phases.every(phase=>phase.status==='RELEASED'&&phase.progress.length>0);
 async function submitProgress(event:FormEvent<HTMLFormElement>,phaseNumber:number){
  event.preventDefault();
  const form=new FormData(event.currentTarget);
  const body=String(form.get('progress')||'');
  const file=form.get('evidence');
  setFileError('');
  try{
   if(file instanceof File&&file.size>5*1024*1024){setFileError('El archivo supera el límite de 5 MB.');return;}
   const attachment=file instanceof File&&file.size>0?await encodeFile(file):undefined;
   await onPostProgress(phaseNumber,body,attachment);
  }catch(error){
   setFileError(error instanceof Error?error.message:'No se pudo preparar la evidencia');
  }
 }
 return <section className="project-phases" aria-label="Fases de financiación">
  <div className="phase-heading"><div><span className="eyebrow">DESEMBOLSO POR ETAPAS</span><h3>Plan de financiación en {phases.length} fases</h3></div><span className="phase-simulation">Simulación · sin transferencias reales</span></div>
  {canPostProgress&&<p className="phase-instructions">Completa cada fase con su descripción y foto. Cada número de fase se registra una sola vez; al completar la última, la cosecha queda lista para venta.</p>}
  {readyForSale&&<div className="phase-ready-banner" role="status"><strong>Fases completadas · cosecha lista para la venta</strong><span>El lote ya está disponible en el marketplace.</span></div>}
  <div className="phase-list">{phases.map((phase,index)=>{
   const canConfirm=canRelease&&phase.status==='FUNDED'&&(index===0||phases[index-1]?.status==='RELEASED');
   const phaseCompleted=phase.status==='RELEASED'&&phase.progress.length>0;
   return <article className="phase-item" key={phase.phase_number}>
    <div className="phase-number">{phase.phase_number}</div>
    <div className="phase-content"><div className="phase-title"><strong>{phase.name}</strong><span>{phase.percentage_bps/100}% · {money(phase.amount,currency)}</span></div>
     <p>{phase.description}</p>
     {phase.source==='MIGRATION'&&<small className="phase-origin">Asignación provisional añadida para conservar una cosecha anterior; no fue propuesta por el cultivador.</small>}
     <div className="phase-footer"><span className={'phase-status phase-'+phase.status.toLowerCase()}>{phaseCompleted?`Fase ${phase.phase_number} completada`:phase.status==='RELEASED'?'Desembolsada · falta el informe de cierre':phase.status==='FUNDED'?'Lista para confirmar':'Pendiente de financiación'}</span>
      {canConfirm&&<button className="button secondary phase-release" disabled={busy} onClick={()=>onRelease(phase.phase_number)}>Confirmar desembolso simulado</button>}
     </div>
     {canPostProgress&&phase.status==='RELEASED'&&!phaseCompleted&&<form key={phase.phase_number} className="phase-progress-form" onSubmit={event=>submitProgress(event,phase.phase_number)}>
      <label>Progreso de la fase<textarea name="progress" required minLength={5} maxLength={2000} placeholder="Describe las labores realizadas y el avance alcanzado…"/></label>
      <label>Evidencia obligatoria · foto o PDF<input name="evidence" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required /></label>
      <small>Máximo 5 MB. Formatos permitidos: JPG, PNG, WebP y PDF.</small>
      {fileError&&<small className="inline-error" role="alert">{fileError}</small>}
      <button className="button secondary" type="submit" disabled={busy}>Subir progreso de la fase {phase.phase_number}</button>
     </form>}
     {phase.progress.length>0&&<div className="phase-progress-list"><strong>Actualizaciones del cultivador</strong>{phase.progress.map(progress=><article className="phase-progress-entry" key={progress.id}>
      <time dateTime={progress.created}>{new Date(progress.created+'Z').toLocaleString('es-CO')}</time>
      <p>{progress.body}</p>
      {progress.attachment_name&&<a href={`/api/projects/${encodeURIComponent(projectId)}/phases/${phase.phase_number}/progress/${encodeURIComponent(progress.id)}/attachment`} download>{progress.attachment_name} · Descargar evidencia</a>}
     </article>)}</div>}
    </div>
   </article>;
  })}</div>
 </section>;
}
