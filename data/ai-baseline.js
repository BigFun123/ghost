// Sensor-only coarse-to-fine reference search; no target coordinates or hit IDs.
(function(scope){
  function create({joints,holdSeconds,rowStepDegrees=2}){
    if(joints.length!==2||joints.some(joint=>!Number.isFinite(joint.min)||!Number.isFinite(joint.max)||joint.min<0||joint.max>180||joint.max<=joint.min)||!Number.isFinite(holdSeconds)||holdSeconds<=0||!Number.isFinite(rowStepDegrees)||rowStepDegrees<2)throw new Error('Invalid raster controller settings.');
    let phaseBeforeHold='sweep';
    let phase='sweep',row=null,direction=1,lockRemaining=0,lockAttempts=0,exhausted=false,lastEvent=null,rejectedRange=null,rows=[],rowIndex=0,initialLeg=true;
    const toward=(observation,joint,goal)=>{const difference=goal-observation.jointAnglesDegrees[joint];return Math.abs(difference)<=1.05?0:joint===0?(difference<0?1:2):(difference<0?3:4);};
    function plan(observation){
      const tilt=joints[1],pan=joints[0];row=Math.max(tilt.min,Math.min(tilt.max,observation.jointAnglesDegrees[1]));
      const add=value=>{if(!rows.some(r=>Math.abs(r-value)<.01))rows.push(value);};
      add(row);add((tilt.min+tilt.max)/2);add(tilt.min);add(tilt.max);
      let intervals=[[tilt.min,tilt.max]];
      while(intervals.length){const next=[];for(const [a,b] of intervals){if(b-a<=rowStepDegrees)continue;const mid=(a+b)/2;add(mid);next.push([a,mid],[mid,b]);}intervals=next;}
      direction=observation.jointAnglesDegrees[0]-pan.min<pan.max-observation.jointAnglesDegrees[0]?-1:1;
    }
    return {
      act(observation){
        lastEvent=null;if(observation.jointAnglesDegrees?.length!==2||!observation.jointAnglesDegrees.every(Number.isFinite))throw new Error('Raster requires finite joint observations.');
        if(row===null)plan(observation);if(exhausted)return 0;
        const range=observation.sensor?.distanceMm,hasReturn=observation.sensor?.valid&&Number.isFinite(range)&&range>=1;
        if(!hasReturn)rejectedRange=null;
        if(lockRemaining>0){if(hasReturn){lockRemaining--;return 0;}lockRemaining=0;}
        // A completed hold without episode success was not sufficient. Do not repeatedly
        // park on a continuous similar-range background; retry after a gap or range change.
        if(lockRemaining===0&&phase==='holding'){rejectedRange=hasReturn?range:null;phase=phaseBeforeHold;}
        if(hasReturn&&(rejectedRange===null||Math.abs(range-rejectedRange)>Math.max(8,rejectedRange*.1))){
          lockRemaining=Math.ceil(holdSeconds/.05)+2;lockAttempts++;lastEvent='lock-start';phaseBeforeHold=phase;phase='holding';return 0;
        }
        for(let transitions=0;transitions<4;transitions++){
          if(phase==='sweep'){
            const action=toward(observation,0,direction>0?joints[0].max:joints[0].min);if(action)return action;
            if(initialLeg){initialLeg=false;direction*=-1;continue;}
            if(++rowIndex>=rows.length){exhausted=true;return 0;}
            row=rows[rowIndex];phase='row';
          }else{
            const action=toward(observation,1,row);if(action)return action;direction*=-1;phase='sweep';
          }
        }
        return 0;
      },
      status(){return {phase,row,direction,lockAttempts,exhausted,event:lastEvent,scanPattern:'coarse-to-fine',rowIndex,totalRows:rows.length};}
    };
  }
  scope.GhostRasterBaseline={create};
  if(typeof module!=='undefined'&&module.exports)module.exports=scope.GhostRasterBaseline;
})(globalThis);
