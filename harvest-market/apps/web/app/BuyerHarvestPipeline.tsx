type HarvestProject = {
 id: string;
 title: string;
 product: string;
 location: string;
 currency: string;
 principal: number;
 status: string;
};

export function BuyerHarvestPipeline({ projects, onOpen }: { projects: HarvestProject[]; onOpen: (projectId: string) => void }) {
 const upcoming = projects.filter(project => project.status === 'FUNDING' || project.status === 'GROWING');
 if (!upcoming.length) return null;

 return <section className="buyer-pipeline" aria-label="Harvests not yet ready for purchase">
  <div>
   <span className="eyebrow">COSECHAS DE PRODUCTORES</span>
   <h2>Cosechas en preparación</h2>
   <p>Puedes seguir cada solicitud desde su publicación. Cuando las tres fases tienen desembolso y progreso con evidencia, la cosecha pasa automáticamente al marketplace para su compra.</p>
  </div>
  <div className="buyer-pipeline-list">
   {upcoming.map(project => <button className="buyer-pipeline-item" key={project.id} onClick={() => onOpen(project.id)}>
    <span><strong>{project.title}</strong><small>{project.product} · {project.location}</small></span>
    <span className="buyer-pipeline-status">{project.status === 'FUNDING' ? 'Buscando financiación' : 'En crecimiento'}</span>
   </button>)}
  </div>
 </section>;
}
