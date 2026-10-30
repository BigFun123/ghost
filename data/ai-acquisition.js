// Training-only bridge. Progress is not a held-out convergence measurement.
(function(scope){
  const fractions=[0,.1,.25,.5,.75,1];
  function create(){
    let level=0,outcomes=[];
    function status(){return {level,levels:fractions.length,fraction:fractions[level],episodes:outcomes.length,successes:outcomes.filter(Boolean).length};}
    return {status,
      record(success){outcomes.push(!!success);if(outcomes.length>20)outcomes.shift();
        if(outcomes.length>=10&&outcomes.filter(Boolean).length/outcomes.length>=.8&&level<fractions.length-1){level++;outcomes=[];}
        else if(outcomes.length===20&&outcomes.filter(Boolean).length<=3&&level>0){level--;outcomes=[];}
        return status();
      },
      prepare(scenario){
        if(level===fractions.length-1)return {...scenario,acquisition:status()};
        const copy=JSON.parse(JSON.stringify(scenario));let state=(scenario.seed^0x19B483A7)>>>0;
        const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
        copy.resetOptions.initialAngles=copy.task.joints.map((joint,i)=>{
          const ordinary=joint.startup+(random()*2-1)*(scenario.resetOptions.jitterDegrees??0);
          const centre=copy.task.solution.angles[i]+fractions[level]*(ordinary-copy.task.solution.angles[i]);
          const jitter=level===0?.25:1;
          return Math.max(joint.min,Math.min(joint.max,centre+(random()*2-1)*jitter));
        });
        copy.acquisition=status();return copy;
      }
    };
  }
  scope.GhostAcquisition={create};
  if(typeof module!=='undefined'&&module.exports)module.exports=scope.GhostAcquisition;
})(globalThis);
