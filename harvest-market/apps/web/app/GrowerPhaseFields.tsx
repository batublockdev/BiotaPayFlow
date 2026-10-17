const defaultPhases=[
 {name:'Preparación e insumos',description:'Compra de insumos orgánicos y preparación del cultivo.',percentage:40},
 {name:'Cuidado y jornales',description:'Labores de mantenimiento y pago de jornales.',percentage:35},
 {name:'Cosecha y empaque',description:'Recolección, selección y empaque del lote.',percentage:25}
];

export function GrowerPhaseFields(){
 return <fieldset className="phase-form">
  <legend>Propón las 3 fases de desembolso</legend>
  <p>Define el uso y porcentaje de cada etapa. La suma debe ser exactamente 100%; cada desembolso lo confirmarás durante el ciclo.</p>
  {defaultPhases.map((phase,index)=><div className="phase-form-item" key={index}>
   <strong>Fase {index+1}</strong>
   <div className="form-grid">
    <label>Nombre de la fase<input name={`phase_${index+1}_name`} required minLength={3} maxLength={80} defaultValue={phase.name}/></label>
    <label>Porcentaje del capital (%)<input name={`phase_${index+1}_percentage`} type="number" min="0.01" max="100" step="0.01" required defaultValue={phase.percentage}/></label>
   </div>
   <label>Uso del desembolso<textarea name={`phase_${index+1}_description`} required minLength={5} maxLength={500} defaultValue={phase.description}/></label>
  </div>)}
 </fieldset>;
}
