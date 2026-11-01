// Browser-hosted frozen-policy playback. Simulation and hardware have separate observations.
(function(scope){
  let active=null;
  function database(){return new Promise((resolve,reject)=>{const request=indexedDB.open('ghost-sequence-policies',1);request.onupgradeneeded=()=>request.result.createObjectStore('policies',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('Policy library unavailable.'));});}
  async function stored(method,value){
    const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('policies',method==='put'?'readwrite':'readonly'),request=tx.objectStore('policies')[method](...(value===undefined?[]:[value]));let result;request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(new Error('Could not access the browser policy library.'));});}finally{db.close();}
  }
  async function list(){
    let local=[];try{local=(await stored('getAll')).map(({id,name})=>({id,name}));}catch{/* Devserver policies still work without browser storage. */}
    if(typeof localConfigServer!=='undefined'&&localConfigServer){const response=await fetch('/api/training/policies',{cache:'no-store',signal:AbortSignal.timeout(3000)});if(!response.ok)throw new Error('Could not list training policies.');const files=await response.json();local.unshift(...files.map(file=>({id:'file:'+file.filename,name:file.filename})));}
    return local;
  }
  function validate(record){if(record?.format!=='ghost-ppo-policy'||record.version!==1||!record.compatibility||!record.network||JSON.stringify(record).length>2*1024*1024)throw new Error('Choose a GHOST policy JSON file (maximum 2 MB).');}
  async function importFile(file){
    if(file.size>2*1024*1024)throw new Error('Policy file exceeds 2 MB.');const text=await file.text(),record=JSON.parse(text);validate(record);
    const bytes=crypto.subtle?new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(record)))):crypto.getRandomValues(new Uint8Array(32));
    const hash=Array.from(bytes).map(v=>v.toString(16).padStart(2,'0')).join('');
    const id='local:'+hash;await stored('put',{id,name:file.name,record});return id;
  }
  function chooseFile(){return new Promise((resolve,reject)=>{const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.hidden=true;document.body.append(input);const finish=()=>input.remove();input.addEventListener('cancel',()=>{finish();resolve(null);});input.addEventListener('change',async()=>{try{resolve(input.files?.[0]?await importFile(input.files[0]):null);}catch(error){reject(error);}finally{finish();}});input.click();});}
  async function read(id,signal){
    if(id.startsWith('file:')){if(typeof localConfigServer==='undefined'||!localConfigServer)throw new Error('This policy is in the devserver training folder. Import its JSON on this controller and select that copy.');const response=await fetch('/api/training/policy?file='+encodeURIComponent(id.slice(5)),{cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(3000)])});if(!response.ok)throw new Error('Saved policy is missing or invalid.');const record=await response.json();validate(record);return record;}
    const item=await stored('get',id);if(!item)throw new Error('Policy is missing from this browser. Import its JSON and select it again.');validate(item.record);return item.record;
  }
  function stop(){if(!active)return;active.cancelled=true;active.abort.abort();active.worker?.dispose('AI sequence stopped.');active.wake?.();}
  async function run(id,adapter){
    if(active||scope.GhostLearning?.isBusy())throw new Error('Stop AI training or policy playback before running an AI sequence step.');
    const state={cancelled:false,abort:new AbortController(),worker:null,wake:null};active=state;scope.GhostLearning?.updateControls();let environment=null;
    const check=()=>{if(state.cancelled||!adapter.isCurrent())throw new Error('AI sequence stopped.');if(!adapter.canMove())throw new Error('AI policy requires both joints ready, powered on and allowed by mute/solo.');};
    const wait=ms=>new Promise(resolve=>{const timer=setTimeout(()=>{state.wake=null;resolve();},ms);state.wake=()=>{clearTimeout(timer);state.wake=null;resolve();};});
    try{
      check();adapter.status('Loading frozen AI policy...');const record=await read(id,state.abort.signal);check();
      const context=record.compatibility,nodes=JSON.parse(JSON.stringify(adapter.nodes)),savedRig=JSON.parse(context.configurationFingerprint);
      // PWM state is a runtime gate, not a learned geometry setting. Actual gates are checked before every command.
      nodes.forEach((node,i)=>{node.outputEnabled=savedRig[i]?.outputEnabled;});
      const task=scope.GhostLearningTask.validate({nodes,configuration:adapter.configuration,registry:adapter.registry,worldPoint:adapter.worldPoint,sensorIndex:context.sensorIndex,targetIndex:context.targetIndex,panIndex:context.joints[0].index,tiltIndex:context.joints[1].index,holdSeconds:context.holdSeconds,episodeSeconds:context.episodeSeconds,diagnoseLimits:adapter.offline});
      adapter.bindJoints(task.joints);check();
      const componentFiles=Array.from(document.querySelectorAll('script[src^="./components/"]'),script=>script.getAttribute('src').slice(2));
      const worker=state.worker=scope.GhostLearningWorker.create();await worker.request('init',{nodes,task,componentFiles,backend:'auto'});check();await worker.request('load',{record});check();
      const encoder=scope.GhostLearningPolicy.createEncoder(task.joints);let previousAngles=null,previousAt=null,previousAction=null,result=null,commands=null;
      if(adapter.offline){const rig=scope.GhostRig.forRegistry(adapter.registry),RAPIER=await scope.GhostPhysics.load();check();environment=scope.GhostLearningEnvironment.create({RAPIER,nodes,task,registry:adapter.registry,...rig});commands=adapter.initialAngles();result=environment.reset(42,{initialAngles:commands,jitterDegrees:0});}
      const started=performance.now(),deadline=started+task.episodeSeconds*1000;
      let first=true,iterations=0;const actionLimit=Math.ceil(task.episodeSeconds/.05)+1;
      while(iterations++<actionLimit&&(adapter.offline||first||performance.now()<deadline)){first=false;check();const tick=performance.now();let vector;
        if(adapter.offline){vector=result.observation.policyVector;}
        else {
          const response=await fetch('/api/status',{cache:'no-store',signal:AbortSignal.any([state.abort.signal,AbortSignal.timeout(1500)])});if(!response.ok)throw new Error('Robot status unavailable.');const status=await response.json();check();if(performance.now()>=deadline)break;
          const sensor=status.sensors?.vl53l0x;if(!status.wifi?.connected||!sensor?.ready||!Number.isFinite(sensor.sampleAgeMs)||sensor.sampleAgeMs>500)throw new Error('Robot or real distance sensor disconnected or stale.');
          const joints=task.joints.map(joint=>status.servos?.find(servo=>servo.name===joint.name));
          if(joints.some(joint=>!joint?.ready||!joint.outputEnabled||!Number.isFinite(joint.angleDegrees)))throw new Error('Policy joints are unavailable or powered off.');
          const angles=joints.map(joint=>joint.angleDegrees),now=performance.now(),dt=previousAt===null?.05:Math.max(.001,(now-previousAt)/1000),velocities=angles.map((angle,i)=>previousAngles?(angle-previousAngles[i])/dt:0);
          const valid=sensor.valid===true&&Number.isFinite(sensor.distanceMm)&&sensor.distanceMm>=0&&sensor.distanceMm<=2000;
          vector=encoder.encode({jointAnglesDegrees:angles,jointVelocitiesDegreesPerSecond:velocities,sensor:{valid,distanceMm:valid?sensor.distanceMm:null}},previousAction,previousAngles===null);previousAngles=angles;previousAt=now;commands??=[...angles];
        }
        const prediction=await worker.request('predict',{vector});check();if(!adapter.offline&&performance.now()>=deadline)break;const action=prediction.action;if(!scope.GhostLearningPolicy.actions[action])throw new Error('Invalid policy action.');
        if(adapter.offline){result=environment.step(action);if(result.info.reason==='invalid-state'||!result.observation.jointAnglesDegrees.every(Number.isFinite))throw new Error('Invalid policy simulation state.');await adapter.command(result.observation.jointAnglesDegrees);check();adapter.snapshot(environment.snapshot());if(result.terminated||result.truncated){adapter.status('AI step: '+result.info.reason);return {reason:result.info.reason};}}
        else {const chosen=scope.GhostLearningPolicy.actions[action];if(chosen.joint!==null){const i=chosen.joint;commands[i]=Math.max(task.joints[i].min,Math.min(task.joints[i].max,commands[i]+chosen.delta));await adapter.command(commands);check();}}
        previousAction=action;adapter.status('AI policy / '+((performance.now()-started)/1000).toFixed(1)+' s / '+scope.GhostLearningPolicy.actions[action].name+(adapter.offline?'':' / real sensor; target identity unverified'));
        const remaining=adapter.offline?50:deadline-performance.now();if(remaining<=0)break;await wait(Math.max(0,Math.min(remaining,50-(performance.now()-tick))));
      }
      return {reason:adapter.offline?'time-limit':'physical-time-limit; target identity unverified'};
    }finally{environment?.dispose();state.worker?.dispose();state.abort.abort();if(active===state)active=null;scope.GhostLearning?.updateControls();}
  }
  scope.addEventListener?.('beforeunload',stop);
  scope.GhostSequenceAI={list,chooseFile,run,stop,running:()=>!!active};
  if(typeof refreshSequencePolicies==='function')void refreshSequencePolicies();
})(globalThis);
