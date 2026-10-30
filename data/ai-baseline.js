// Sensor-only reference controller. It receives observations, never target coordinates or hit IDs.
(function(scope){
  function create({joints,holdSeconds,rowStepDegrees=2}){
    if(joints.length!==2||joints.some(joint=>!Number.isFinite(joint.min)||!Number.isFinite(joint.max)||joint.max<=joint.min)||!Number.isFinite(holdSeconds)||holdSeconds<=0||!Number.isFinite(rowStepDegrees)||rowStepDegrees<2)throw new Error('Invalid raster controller settings.');
    let phase='pan-home',row=joints[1].min,direction=1,lockRemaining=0,cooldown=0,lockAttempts=0,exhausted=false,lastEvent=null;
    const toward=(observation,joint,goal)=>{
      const difference=goal-observation.jointAnglesDegrees[joint];
      return Math.abs(difference)<=1.05?0:joint===0?(difference<0?1:2):(difference<0?3:4);
    };
    return {
      act(observation){
        lastEvent=null;
        if(!observation.jointAnglesDegrees?.every(Number.isFinite))throw new Error('Raster requires finite joint observations.');
        if(exhausted)return 0;
        const hasReturn=observation.sensor?.valid&&Number.isFinite(observation.sensor.distanceMm)&&observation.sensor.distanceMm>=1;
        if(lockRemaining>0){
          if(hasReturn){lockRemaining--;return 0;}
          lockRemaining=0;cooldown=4;
        }
        if(cooldown>0)cooldown--;
        else if(hasReturn){lockRemaining=Math.ceil(holdSeconds/.05)+2;cooldown=6;lockAttempts++;lastEvent='lock-start';return 0;}
        // Boustrophedon scan; homing and row changes use the same bounded 2-degree actions.
        for(let transitions=0;transitions<4;transitions++){
          if(phase==='pan-home'){
            const action=toward(observation,0,joints[0].min);if(action)return action;phase='tilt-home';
          }else if(phase==='tilt-home'){
            const action=toward(observation,1,row);if(action)return action;phase='sweep';
          }else if(phase==='sweep'){
            const action=toward(observation,0,direction>0?joints[0].max:joints[0].min);if(action)return action;
            if(row>=joints[1].max){exhausted=true;return 0;}
            row=Math.min(joints[1].max,row+rowStepDegrees);phase='row';
          }else{
            const action=toward(observation,1,row);if(action)return action;direction*=-1;phase='sweep';
          }
        }
        return 0;
      },
      status(){return {phase,row,direction,lockAttempts,exhausted,event:lastEvent};}
    };
  }
  scope.GhostRasterBaseline={create};
  if(typeof module!=='undefined'&&module.exports)module.exports=scope.GhostRasterBaseline;
})(globalThis);
