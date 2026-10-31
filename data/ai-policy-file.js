// Versioned local policy data. Files contain numbers/metadata, never executable code.
(function(scope){
  function canonical(value){
    if(Array.isArray(value))return value.map(canonical);
    if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])]));
    return value;
  }
  const stable=value=>JSON.stringify(canonical(value));
  function compatibility({nodes,task,registry}){
    const joints=new Set(task.joints.map(joint=>joint.index));
    const rig=nodes.map((node,index)=>({name:node.name,objectType:node.objectType,model:node.model,parent:node.parent,position:node.position,rotation:node.rotation,
      settings:registry.settings?.(node),physics:registry.getPhysics?.(node),attachment:registry.attachment?.(nodes,index),
      enabled:node.enabled,outputEnabled:node.outputEnabled,continuous:node.continuous,angle:joints.has(index)?undefined:node.angle,
      constraints:node.constraints,rotationConstraints:node.rotationConstraints}));
    return canonical({version:1,configurationFingerprint:stable(rig),joints:task.joints,rootIndex:task.rootIndex,sensorIndex:task.sensorIndex,targetIndex:task.targetIndex,targetWorld:task.targetWorld,
      holdSeconds:task.holdSeconds,episodeSeconds:task.episodeSeconds,observation:scope.GhostLearningPolicy.createEncoder(task.joints).schema,actions:scope.GhostLearningPolicy.actions,
      sensor:{model:'VL53L0X-centre-ray',version:1,rangeMm:2000,targetRadiusMm:5},rewardVersion:scope.GhostLearningReward.version,physicsHz:120,actionHz:20});
  }
  function targetCompatible(left,right){
    const hardware=context=>{
      const rig=JSON.parse(context.configurationFingerprint);
      if(!Array.isArray(rig))throw new Error('Invalid rig fingerprint.');
      return {...context,targetIndex:undefined,targetWorld:undefined,configurationFingerprint:stable(rig.map((node,index)=>({node,index})).filter(item=>item.node.objectType!=='Target'))};
    };
    try{return stable(hardware(left))===stable(hardware(right));}catch{return false;}
  }
  function save({agent,context,training={},evaluation=null}){
    return {format:'ghost-ppo-policy',version:1,tensorflowVersion:'4.22.0',savedAt:new Date().toISOString(),compatibility:context,
      network:{schema:agent.schema,settings:agent.settings,weights:agent.exportWeights()},training,evaluation,
      continuation:'Weights only: Adam optimizer, random generator and rollout state restart on load.'};
  }
  function load({tf,record,context,allowTargetChange=false}){
    if(record?.format!=='ghost-ppo-policy'||record.version!==1||record.tensorflowVersion!=='4.22.0')throw new Error('Unsupported policy file or TensorFlow.js version.');
    if(record.compatibility?.observation?.version!==context.observation?.version)throw new Error('Policy uses an older or different observation format. Retrain with the corrected mount-aware joint angles.');
    if(record.compatibility?.rewardVersion!==context.rewardVersion)throw new Error('Policy uses a different reward model. Start fresh training for the acquisition reward.');
    if(stable(record.compatibility)!==stable(context)&&!(allowTargetChange&&targetCompatible(record.compatibility,context)))throw new Error('Policy is incompatible with this rig, task or observation/action format.');
    const schema=record.network?.schema;
    if(schema?.version!==1||schema.inputSize!==29||schema.actionCount!==5||stable(schema.hiddenUnits)!=='[64,64]'||!Number.isInteger(schema.seed))throw new Error('Unsupported policy network schema.');
    if(!record.network.settings||stable(Object.keys(record.network.settings).sort())!==stable(Object.keys(scope.GhostPPO.defaults).sort()))throw new Error('Incomplete or unsupported policy training settings.');
    let candidate;
    try{
      candidate=scope.GhostPPO.create({tf,inputSize:29,actionCount:5,seed:schema.seed,settings:record.network.settings});
      candidate.importWeights(record.network.weights);
      const prediction=candidate.predict(Array(29).fill(0));
      if(!Number.isFinite(prediction.value)||!prediction.probabilities.every(Number.isFinite))throw new Error('Policy produced non-finite predictions.');
      return candidate;
    }catch(error){candidate?.dispose();throw error;}
  }
  scope.GhostPolicyFile={compatibility,targetCompatible,save,load};
  if(typeof module!=='undefined'&&module.exports)module.exports=scope.GhostPolicyFile;
})(globalThis);
