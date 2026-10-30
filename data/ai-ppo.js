// Categorical PPO actor-critic, with explicit tensor ownership and episode-boundary GAE.
(function(scope){
  const defaults=Object.freeze({gamma:.99,lambda:.95,clip:.2,learningRate:.0003,epochs:4,batchSize:64,entropyCoefficient:.01,valueCoefficient:.5,maxGradientNorm:.5});
  function random(seed){let state=seed>>>0;return()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};}
  function advantages(rows,{gamma=.99,lambda=.95}={}){
    let nextAdvantage=0;const raw=Array(rows.length),returns=Array(rows.length);
    for(let i=rows.length-1;i>=0;i--){const row=rows[i];
      if(![row.reward,row.value,row.nextValue].every(Number.isFinite))throw new Error('Non-finite PPO rollout.');
      const delta=row.reward+gamma*(row.terminated?0:row.nextValue)-row.value;
      raw[i]=delta+gamma*lambda*(row.terminated||row.truncated?0:nextAdvantage);returns[i]=raw[i]+row.value;nextAdvantage=raw[i];
    }
    const mean=raw.reduce((a,b)=>a+b,0)/raw.length,variance=raw.reduce((a,b)=>a+(b-mean)**2,0)/raw.length;
    return {raw,returns,normalized:raw.map(value=>(value-mean)/Math.sqrt(variance+1e-8))};
  }
  function clippedSurrogate(ratio,advantage,clip=.2){return Math.min(ratio*advantage,Math.max(1-clip,Math.min(1+clip,ratio))*advantage);}
  function create({tf,inputSize=29,actionCount=5,seed=42,settings={}}){
    const config={...defaults,...settings};
    if(!Number.isInteger(inputSize)||inputSize<1||!Number.isInteger(actionCount)||actionCount<2||!Number.isInteger(seed))throw new Error('Invalid PPO network schema or seed.');
    if(!Object.values(config).every(Number.isFinite)||config.gamma<0||config.gamma>1||config.lambda<0||config.lambda>1||config.clip<=0||config.clip>=1||config.learningRate<=0||config.learningRate>.01||config.maxGradientNorm<=0||config.entropyCoefficient<0||config.valueCoefficient<0||!Number.isInteger(config.epochs)||config.epochs<1||config.epochs>10||!Number.isInteger(config.batchSize)||config.batchSize<1||config.batchSize>2048)throw new Error('Invalid PPO hyperparameters.');
    const rng=random(seed),input=tf.input({shape:[inputSize]});
    let hidden=tf.layers.dense({units:64,activation:'tanh',kernelInitializer:tf.initializers.glorotUniform({seed:seed+1})}).apply(input);
    hidden=tf.layers.dense({units:64,activation:'tanh',kernelInitializer:tf.initializers.glorotUniform({seed:seed+2})}).apply(hidden);
    const logits=tf.layers.dense({units:actionCount,kernelInitializer:tf.initializers.randomNormal({seed:seed+3,stddev:.01})}).apply(hidden);
    const values=tf.layers.dense({units:1,kernelInitializer:tf.initializers.glorotUniform({seed:seed+4})}).apply(hidden);
    const model=tf.model({inputs:input,outputs:[logits,values]}),optimizer=tf.train.adam(config.learningRate);
    let disposed=false,updating=false,optimizerSteps=0;
    const assertAlive=()=>{if(disposed)throw new Error('PPO policy has been disposed.');};
    function predict(vector){
      assertAlive();if(vector.length!==inputSize||!vector.every(Number.isFinite))throw new Error('PPO observation schema mismatch.');
      return tf.tidy(()=>{const [logits,value]=model.predict(tf.tensor2d([vector]));return {probabilities:Array.from(tf.softmax(logits).dataSync()),value:value.dataSync()[0]};});
    }
    function batchUpdate(rows,indices,gae){
      return tf.tidy(()=>{
        const xs=tf.tensor2d(indices.map(i=>rows[i].observation)),oneHot=tf.oneHot(tf.tensor1d(indices.map(i=>rows[i].action),'int32'),actionCount);
        const oldLog=tf.tensor1d(indices.map(i=>rows[i].logProbability)),advs=tf.tensor1d(indices.map(i=>gae.normalized[i])),targets=tf.tensor1d(indices.map(i=>gae.returns[i]));
        let metrics;
        const {value,grads}=tf.variableGrads(()=>{
          const [logits,predicted]=model.apply(xs,{training:true}),logs=tf.logSoftmax(logits),chosen=logs.mul(oneHot).sum(1),logRatio=chosen.sub(oldLog),ratio=logRatio.exp();
          const policyLoss=tf.minimum(ratio.mul(advs),ratio.clipByValue(1-config.clip,1+config.clip).mul(advs)).mean().neg();
          const valueLoss=targets.sub(predicted.reshape([-1])).square().mean().mul(.5);
          const entropy=logs.exp().mul(logs).sum(1).mean().neg();
          const kl=ratio.sub(1).sub(logRatio).mean(),clipFraction=ratio.sub(1).abs().greater(config.clip).toFloat().mean();
          metrics={policyLoss:policyLoss.dataSync()[0],valueLoss:valueLoss.dataSync()[0],entropy:entropy.dataSync()[0],approxKL:kl.dataSync()[0],clipFraction:clipFraction.dataSync()[0]};
          return policyLoss.add(valueLoss.mul(config.valueCoefficient)).sub(entropy.mul(config.entropyCoefficient));
        },model.trainableWeights.map(weight=>weight.val));
        const norm=tf.addN(Object.values(grads).map(gradient=>gradient.square().sum())).sqrt().dataSync()[0];
        const loss=value.dataSync()[0];if(![loss,norm,...Object.values(metrics)].every(Number.isFinite))throw new Error('Non-finite PPO loss or gradient; training stopped.');
        const scale=Math.min(1,config.maxGradientNorm/(norm+1e-8));
        optimizer.applyGradients(Object.fromEntries(Object.entries(grads).map(([name,gradient])=>[name,gradient.mul(scale)])));optimizerSteps++;
        return {...metrics,loss,gradientNorm:norm,clippedGradientNorm:norm*scale};
      });
    }
    return {
      schema:Object.freeze({version:1,inputSize,actionCount,hiddenUnits:[64,64],seed}),settings:Object.freeze({...config}),
      predict,
      value(vector){return predict(vector).value;},
      act(vector,deterministic=false){
        const prediction=predict(vector);let action=0;
        if(deterministic)action=prediction.probabilities.indexOf(Math.max(...prediction.probabilities));
        else{let sample=rng();action=actionCount-1;for(let i=0;i<actionCount;i++){sample-=prediction.probabilities[i];if(sample<=0){action=i;break;}}}
        return {action,value:prediction.value,logProbability:Math.log(Math.max(1e-12,prediction.probabilities[action]))};
      },
      async update(rows,{shouldStop=()=>false,yieldControl=async()=>{}}={}){
        assertAlive();if(updating)throw new Error('PPO update already running.');
        if(!rows.length||rows.some(row=>row.observation.length!==inputSize||!row.observation.every(Number.isFinite)||!Number.isInteger(row.action)||row.action<0||row.action>=actionCount||!Number.isFinite(row.logProbability)))throw new Error('Invalid PPO rollout data.');
        const gae=advantages(rows,config);let batches=0,last=null;updating=true;
        try{
          for(let epoch=0;epoch<config.epochs;epoch++){
            const order=rows.map((_,i)=>i);for(let i=order.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
            for(let offset=0;offset<order.length;offset+=config.batchSize){
              await yieldControl();if(shouldStop())return {cancelled:true,batches,...last};assertAlive();
              last=batchUpdate(rows,order.slice(offset,offset+config.batchSize),gae);batches++;
            }
          }
          return {cancelled:false,batches,...last};
        }finally{updating=false;}
      },
      exportWeights(){
        assertAlive();if(updating)throw new Error('Wait for the optimizer to stop before saving.');
        // LayerVariable.read() borrows the live variable; do not dispose it.
        return model.weights.map(weight=>({shape:[...weight.shape],values:Array.from(weight.read().dataSync())}));
      },
      importWeights(weights){
        assertAlive();if(updating||optimizerSteps)throw new Error('Load weights into a fresh, idle policy.');
        if(!Array.isArray(weights)||weights.length!==model.weights.length)throw new Error('Invalid policy weight count.');
        weights.forEach((weight,i)=>{
          if(JSON.stringify(weight?.shape)!==JSON.stringify(model.weights[i].shape)||!Array.isArray(weight.values)||weight.values.length!==model.weights[i].shape.reduce((a,b)=>a*b,1)||!weight.values.every(value=>typeof value==='number'&&Number.isFinite(Math.fround(value))))throw new Error('Invalid policy weights at layer '+i+'.');
        });
        const tensors=[];
        try{for(const weight of weights)tensors.push(tf.tensor(weight.values,weight.shape,'float32'));model.setWeights(tensors);}
        finally{tensors.forEach(tensor=>tensor.dispose());}
      },
      inspect(){assertAlive();return {optimizerSteps,tensors:tf.memory().numTensors};},
      dispose(){if(disposed)return;optimizer.dispose();model.dispose();disposed=true;}
    };
  }
  scope.GhostPPO={create,advantages,clippedSurrogate,defaults};
  if(typeof module!=='undefined'&&module.exports)module.exports=scope.GhostPPO;
})(globalThis);
