// Reproducible clean-task curriculum. Privileged checks generate cases, not policy inputs.
(function(scope){
  const stages=Object.freeze([
    Object.freeze({id:'nearby',label:'Configured target / near startup angles',jitterDegrees:5}),
    Object.freeze({id:'wide',label:'Configured target / wider startup variation',jitterDegrees:20}),
    Object.freeze({id:'random-target',label:'Random reachable targets',jitterDegrees:10})
  ]);
  const seeds=Object.freeze({training:Object.freeze([11,23,37,53,71]),evaluation:Object.freeze([10001,10003,10007,10009,10037]),monitoring:Object.freeze(Array.from({length:50},(_,i)=>200003+i*101)),qualification:Object.freeze(Array.from({length:50},(_,i)=>900001+i*103))});
  function random(seed){let state=seed>>>0;return()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};}
  function makeCase({stageId,split,index,nodes,task,registry,worldPoint,seedOverride}){
    const stage=stages.find(item=>item.id===stageId);
    if(!stage||!seeds[split]||!Number.isInteger(index)||index<0||index>=seeds[split].length)throw new Error('Unknown curriculum stage, split or case index.');
    const seed=seedOverride??seeds[split][index];
    if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw new Error("Invalid curriculum seed.");
    const copy=JSON.parse(JSON.stringify(nodes)),episodeTask=JSON.parse(JSON.stringify(task));
    if(stage.id==='random-target'){
      const rng=random(seed^0xA53C9E17);let visible=false;
      for(let attempt=0;attempt<48;attempt++){
        const aim=task.joints.map(joint=>joint.min+rng()*(joint.max-joint.min));
        task.joints.forEach((joint,i)=>{copy[joint.index].angle=aim[i];});
        const ray=scope.GhostSensor.sensorRay(copy,task.sensorIndex,worldPoint);if(!ray)continue;
        const distance=50+rng()*450;
        const target=ray.origin.map((value,i)=>value+ray.direction[i]*distance);
        if(target[1]<5)continue;
        copy[task.targetIndex].parent=null;copy[task.targetIndex].position=target;copy[task.targetIndex].rotation=[0,0,0];
        const reading=scope.GhostSensor.read({nodes:copy,index:task.sensorIndex,worldPoint,registry});
        if(!reading.valid||reading.hit?.kind!=='component'||reading.hit.index!==task.targetIndex)continue;
        episodeTask.targetWorld=target;episodeTask.solution={angles:aim,distanceMm:reading.distanceMm};visible=true;break;
      }
      if(!visible)throw new Error('Could not generate a visible target after 48 attempts for seed '+seed+'. Check rig geometry.');
    }
    return {id:stageId+'/'+split+'/'+seed,stageId,split,seed,task:episodeTask,resetOptions:{jitterDegrees:stage.jitterDegrees}};
  }
  scope.GhostLearningCurriculum={stages,seeds,makeCase};
  if(typeof module!=='undefined'&&module.exports)module.exports=scope.GhostLearningCurriculum;
})(globalThis);
