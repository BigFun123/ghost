// Fixed policy contract for the first pan-tilt task. No target geometry or hit IDs.
(function (scope) {
  const actions = Object.freeze([
    Object.freeze({name:'Hold',joint:null,delta:0}),
    Object.freeze({name:'Pan -',joint:0,delta:-2}),Object.freeze({name:'Pan +',joint:0,delta:2}),
    Object.freeze({name:'Tilt -',joint:1,delta:-2}),Object.freeze({name:'Tilt +',joint:1,delta:2})
  ]);
  const clamp=value=>Math.max(-1,Math.min(1,value));
  function createEncoder(joints) {
    const historyLength=4, frameSize=6, size=29;
    let history=[];
    function frame({jointAnglesDegrees, jointVelocitiesDegreesPerSecond, sensor}) {
      if(jointAnglesDegrees.length!==2||jointVelocitiesDegreesPerSecond.length!==2||![...jointAnglesDegrees,...jointVelocitiesDegreesPerSecond].every(Number.isFinite)) throw new Error('Policy requires two finite joint angles and velocities.');
      if(sensor.valid&&(!Number.isFinite(sensor.distanceMm)||sensor.distanceMm<0))throw new Error('Policy received an invalid sensor range.');
      return [...jointAnglesDegrees.map((angle,i)=>clamp(2*(angle-joints[i].min)/(joints[i].max-joints[i].min)-1)),
        ...jointVelocitiesDegreesPerSecond.map(velocity=>clamp(velocity/180)),
        sensor.valid?Math.max(0,Math.min(1,sensor.distanceMm/2000)):1,sensor.valid?1:0];
    }
    return {
      schema:Object.freeze({version:2,size,frameSize,historyLength,velocityScale:180,rangeScale:2000,actionCount:actions.length}),
      encode(observation,action=null,reset=false) {
        const current=frame(observation);
        if(action!==null&&(!Number.isInteger(action)||!actions[action]))throw new Error('Unknown policy action.');
        if(reset||!history.length)history=Array.from({length:historyLength},()=>[...current]);
        else {history.push(current);history.shift();}
        return [...history.flat(),...actions.map((_,i)=>action===i?1:0)];
      }
    };
  }
  scope.GhostLearningPolicy={actions,createEncoder};
  if(typeof module!=='undefined'&&module.exports)module.exports=scope.GhostLearningPolicy;
})(globalThis);
