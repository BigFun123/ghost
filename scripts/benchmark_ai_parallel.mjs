import {performance} from 'node:perf_hooks';
import {fixture} from './ai_fixture.mjs';
import '../data/ai-rig.js';
const f=fixture(),rig=GhostRig.forRegistry(f.registry);const results=[];
for(const count of [1,16]){
 const envs=[];let start=performance.now();
 try{
  for(let i=0;i<count;i++){const env=GhostLearningEnvironment.create({...f,...rig});envs.push(env);env.reset(100+i,{jitterDegrees:5});}
  const resetMs=performance.now()-start;start=performance.now();
  for(let tick=0;tick<16;tick++)for(const env of envs)env.step(0);
  const stepMs=performance.now()-start;start=performance.now();for(const env of envs)env.snapshot();
  results.push({count,resetMs:Math.round(resetMs),stepMs:Math.round(stepMs),snapshotMs:Math.round(performance.now()-start),samplesPerSecond:Math.round(count*16/stepMs*1000)});
 }finally{envs.forEach(env=>env.dispose());}
}
console.log(JSON.stringify(results));
