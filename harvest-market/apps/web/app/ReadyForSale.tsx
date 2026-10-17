type ReadyProject={id:string;title:string;product:string;location:string;status:string};

export function ReadyForSale({projects,onOpen}:{projects:ReadyProject[];onOpen:(id:string)=>void}){
 const ready=projects.filter(project=>project.status==='SELLING');
 if(!ready.length)return null;
 return <section className="ready-for-sale" aria-label="Cosechas listas para venta">
  <div><span className="eyebrow">FASES COMPLETADAS</span><h2>Cosechas listas para venta</h2><p>Estas cosechas completaron sus fases y ya están disponibles en el marketplace.</p></div>
  <div className="ready-for-sale-list">{ready.map(project=><button key={project.id} onClick={()=>onOpen(project.id)}><span><strong>{project.title}</strong><small>{project.product} · {project.location}</small></span><span className="ready-for-sale-badge">Lista para venta</span></button>)}</div>
 </section>;
}
