// An isolated, simulation-time-only environment. No DOM, timers or servo request APIs.
(function (scope) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const dot = (a,b) => a.reduce((sum,value,i)=>sum+value*b[i],0);
  const sub = (a,b) => a.map((value,i)=>value-b[i]);
  function randomSeed(seed) {
    let state = seed >>> 0;
    return () => { state += 0x6D2B79F5; let value=state; value=Math.imul(value^value>>>15,value|1); value^=value+Math.imul(value^value>>>7,value|61); return ((value^value>>>14)>>>0)/4294967296; };
  }
  function create({RAPIER, nodes:sourceNodes, task:sourceTask, registry, worldPoint:kinematicPoint, rotatePoint, physicsNodes, physicsShapes}) {
    const original = clone(sourceNodes), task = clone(sourceTask);
    const dt=1/120, ticksPerAction=6, maxTicks=Math.ceil(task.episodeSeconds/dt), holdTicksNeeded=Math.ceil(task.holdSeconds/dt);
    let physics=null,nodes,descriptors,ticks=0,heldTicks=0,episodeJointTravelDegrees=0,done=true,disposed=false,commands=[],lastAngles=[],velocities=[];
    const topology='isolated-learning-rig';
    const encoder=scope.GhostLearningPolicy.createEncoder(task.joints);
    const rewardModel=scope.GhostLearningReward.create({targetIndex:task.targetIndex,holdSeconds:task.holdSeconds});
    let previousAction=null,jointMeasurements=[];
    const assertAlive=()=>{if(disposed)throw new Error("Training environment has been disposed.");};
    function worldPoint(items,index,point,shaft=false) {
      if(index===task.targetIndex) return point.map((value,i)=>value+task.targetWorld[i]);
      const node=items[index];
      if(!registry.getPhysics(node).real) {
        point=rotatePoint(point,registry.localPoseRotation(items,index,shaft));
        point=rotatePoint(point,registry.placementRotation(items,index,shaft)).map((value,i)=>value+node.position[i]);
        return node.parent===null?point:worldPoint(items,node.parent-1,registry.childMountPoint(items[node.parent-1],point),registry.attachment(items,index).parentSide==='shaft');
      }
      return physics.point(index,point,shaft) ?? kinematicPoint(items,index,point,shaft);
    }
    function angles() {
      return jointMeasurements.map(measurement=>{
        const {index,fixedShaft,movingAxis,reference,command,sign}=measurement;
        const origin=worldPoint(nodes,index,[0,0,0],fixedShaft),movingOrigin=worldPoint(nodes,index,[0,0,0],!fixedShaft);
        const x=sub(worldPoint(nodes,index,[1,0,0],fixedShaft),origin),z=sub(worldPoint(nodes,index,[0,0,1],fixedShaft),origin);
        const moving=sub(worldPoint(nodes,index,[0,1,2].map(axis=>axis===movingAxis?1:0),!fixedShaft),movingOrigin);
        const raw=Math.atan2(-dot(moving,z),dot(moving,x))-reference;
        // Unwrap relative to the preceding measured displacement, not a mount's orientation.
        const delta=measurement.delta+Math.atan2(Math.sin(raw-measurement.delta),Math.cos(raw-measurement.delta));
        measurement.delta=delta;return command+sign*delta*180/Math.PI;
      });
    }
    const reading=()=>scope.GhostSensor.read({nodes,index:task.sensorIndex,worldPoint,registry});
    function alignment(sample) {
      if(!sample.origin||!sample.direction)return 0;
      const delta=sub(task.targetWorld,sample.origin),length=Math.hypot(...delta);
      return length>1e-9?1-Math.acos(Math.max(-1,Math.min(1,dot(delta,sample.direction)/length)))/Math.PI:0;
    }
    function result(sample,reason=null,resetObservation=false) {
      const observation={jointAnglesDegrees:[...lastAngles],jointVelocitiesDegreesPerSecond:[...velocities],sensor:scope.GhostSensor.observation(sample)};
      observation.policyVector=encoder.encode(observation,previousAction,resetObservation);
      const scoring=rewardModel.snapshot();
      return {observation,
        reward:scoring.reward,terminated:done&&reason!=='time-limit',truncated:reason==='time-limit',
        info:{reason,episodeJointTravelDegrees,simulationSeconds:ticks*dt,physicsTicks:ticks,holdSeconds:heldTicks*dt,hit:sample.hit??null,commands:[...commands],rewardVersion:scoring.version,rewardTerms:scoring.terms,episodeReward:scoring.episodeReward,episodeRewardTerms:scoring.episodeTerms}};
    }
    const api={
      observationSchema:encoder.schema,
      actions:scope.GhostLearningPolicy.actions,
      reset(seed=0,{jitterDegrees=5,initialAngles=null}={}) {
        assertAlive();
        if(!Number.isInteger(seed)||!Number.isFinite(jitterDegrees)||jitterDegrees<0||jitterDegrees>30) throw new Error("Use an integer seed and startup jitter between 0 and 30 degrees.");
        if(initialAngles && (initialAngles.length!==2 || initialAngles.some((angle,i)=>!Number.isFinite(angle)||angle<task.joints[i].min||angle>task.joints[i].max))) throw new Error("Initial angles must respect the two joint limits.");
        physics?.destroy();physics=null;done=true;
        try {
          nodes=clone(original);const random=randomSeed(seed);
          commands=task.joints.map((joint,i)=>initialAngles?.[i]??Math.max(joint.min,Math.min(joint.max,joint.startup+(random()*2-1)*jitterDegrees)));
          // Snapshot all actuators at startup; only the selected joints accept actions.
          nodes.forEach(node=>{node.outputEnabled=node.enabled!==false;});
          task.joints.forEach((joint,i)=>{nodes[joint.index].angle=commands[i];nodes[joint.index].motion=null;});
          nodes[task.targetIndex].parent=null;nodes[task.targetIndex].position=[...task.targetWorld];nodes[task.targetIndex].rotation=[0,0,0];
          physics=scope.GhostPhysics.create(RAPIER,{fixedBaseIndex:task.rootIndex});
          descriptors=physicsNodes(nodes);
          for(const descriptor of descriptors) {
            descriptor.constraints=undefined;descriptor.rotationConstraints=undefined; // Only the fixed base supports this rig.
            const joint=task.joints.find(joint=>joint.index===descriptor.index);
            if(joint){descriptor.minTarget=(joint.min-90)*Math.PI/180;descriptor.maxTarget=(joint.max-90)*Math.PI/180;}
          }
          jointMeasurements=task.joints.map((joint,i)=>{
            const descriptor=descriptors.find(item=>item.index===joint.index),fixedShaft=descriptor.fixedSide==='shaft';
            const fixed=descriptor[fixedShaft?'shaft':'body'].axes,moving=descriptor[fixedShaft?'body':'shaft'].axes;
            const projected=moving.map(axis=>[dot(axis,fixed[0]),dot(axis,fixed[2])]);
            const lengths=projected.map(axis=>Math.hypot(...axis)),movingAxis=lengths.indexOf(Math.max(...lengths));
            return {index:joint.index,fixedShaft,movingAxis,reference:Math.atan2(-projected[movingAxis][1],projected[movingAxis][0]),command:commands[i],sign:fixedShaft?-1:1,delta:0};
          });
          physics.syncRobot(descriptors,physicsShapes(nodes),topology);
          // Settling is deterministic and excluded from episode time and success credit.
          physics.stepFixed(120);
          ticks=0;heldTicks=0;episodeJointTravelDegrees=0;done=false;previousAction=null;lastAngles=angles();velocities=[0,0];
          if(!lastAngles.every(Number.isFinite)) throw new Error("Non-finite joint state after reset.");
          const sample=reading();
          if(sample.reason==='invalid-ray')throw new Error("Invalid sensor state after reset.");
          rewardModel.reset(alignment(sample));
          return result(sample,null,true);
        } catch(error) {physics?.destroy();physics=null;done=true;throw error;}
      },
      step(action) {
        assertAlive();if(!physics||done)throw new Error("Reset the environment before stepping a new episode.");
        if(!Number.isInteger(action)||action<0||action>4)throw new Error("Action must be 0 hold, 1/2 pan -/+, or 3/4 tilt -/+.");
        previousAction=action;
        let commandTravel=0,limitFraction=0;
        if(action){
          const {joint,delta}=scope.GhostLearningPolicy.actions[action],before=commands[joint],requested=before+delta;
          commands[joint]=Math.max(task.joints[joint].min,Math.min(task.joints[joint].max,requested));
          commandTravel=Math.abs(commands[joint]-before);limitFraction=Math.abs(requested-commands[joint])/Math.abs(delta);
        }
        rewardModel.beginAction({commandTravel,limitFraction});
        let sample,reason=null;
        try {
          for(let tick=0;tick<ticksPerAction;tick++) {
            task.joints.forEach((joint,i)=>{
              const node=nodes[joint.index],difference=commands[i]-node.angle;
              node.angle+=Math.max(-60*dt,Math.min(60*dt,difference));
              descriptors.find(descriptor=>descriptor.index===joint.index).target=(node.angle-90)*Math.PI/180;
            });
            physics.syncRobot(descriptors,[],topology);physics.stepFixed(1);ticks++;
            const next=angles();sample=reading();
            const invalid=!next.every(Number.isFinite)||sample.reason==='invalid-ray';
            const actualTravel=invalid?0:next.reduce((total,angle,i)=>total+Math.abs(angle-lastAngles[i]),0);
            if(invalid)episodeJointTravelDegrees=null;else if(episodeJointTravelDegrees!==null)episodeJointTravelDegrees+=actualTravel;
            if(invalid){sample={...sample,valid:false,distanceMm:null,hit:null};velocities=[0,0];heldTicks=0;done=true;reason='invalid-state';}
            else {
              velocities=next.map((angle,i)=>(angle-lastAngles[i])/dt);lastAngles=next;
              heldTicks=sample.valid&&sample.hit?.kind==='component'&&sample.hit.index===task.targetIndex?heldTicks+1:0;
              if(heldTicks>=holdTicksNeeded){done=true;reason='success';}
              else if(ticks>=maxTicks){done=true;reason='time-limit';}
            }
            rewardModel.tick({reading:sample,elapsedSeconds:dt,actualTravel,heldSeconds:heldTicks*dt,alignment:alignment(sample),success:reason==='success',invalid});
            if(done)break;
          }
          return result(sample,reason);
        } catch(error){api.dispose();throw error;}
      },
      snapshot() {
        assertAlive();const items=nodes??original;
        const poses=items.map((node,index)=>Object.fromEntries([false,true].map(shaft=>{
          const origin=physics?worldPoint(items,index,[0,0,0],shaft):kinematicPoint(items,index,[0,0,0],shaft);
          const axes=[0,1,2].map(axis=>sub(physics?worldPoint(items,index,[0,1,2].map(i=>i===axis?1:0),shaft):kinematicPoint(items,index,[0,1,2].map(i=>i===axis?1:0),shaft),origin));
          return [shaft?'shaft':'body',{origin,axes}];
        })));
        return {nodes:clone(items),poses,targetWorld:[...task.targetWorld],baseWorld:physics?worldPoint(nodes,task.rootIndex,[0,0,0]):null,physicsTicks:ticks,sensorIndex:task.sensorIndex,targetIndex:task.targetIndex,reading:physics?reading():null,mode:'isolated'};
      },
      dispose() {if(disposed)return;physics?.destroy();physics=null;disposed=true;done=true;}
    };
    return api;
  }
  scope.GhostLearningEnvironment={create};
  if(typeof module!=="undefined"&&module.exports)module.exports=scope.GhostLearningEnvironment;
})(globalThis);
