const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('data/app.js','utf8');
async function run(cancel,single=false){
 const events=[];let release,entered;const gate=new Promise(resolve=>{entered=resolve;});
 const context={offlineSimulation:true,commandModeRevision:0,servoPreview:{nodes:[],configuration:{}},componentRegistry:{},servoWorldPoint(){},sequenceSaving:false,sequenceLoading:false,sequenceApplying:false,sequenceLoaded:true,controllerRebooting:false,sequencePlaying:false,sweepRunning:false,sequence:{finish:true,steps:[{type:'ai',policy:'file:hunter.json'},{type:'delay',durationMs:12}]},selectedSequenceSlot:'a',playbackRateInput:{value:'1'},servoControls:[],sequenceLiveOverrides:new Map(),sequenceRunId:0,sweepButton:{},sweepAllButton:{},centerButton:{},stopSweepButton:{},performance:{now:()=>0},setText(){},setServoPlaybackLock(){},updateSequencerControls(){},renderSequence(){},stopContinuousServos(){},applySequenceStep:async step=>events.push(step.type),waitForStep:async()=>events.push('wait'),activeStepMotionEnds:()=>[],GhostSequenceAI:{run:async()=>{events.push('ai');entered();await new Promise(resolve=>{release=resolve;});events.push('ai-ended');}}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function sequenceStepWaitMilliseconds('),source.indexOf('function stopSequence(')),context);
 if(single)context.sequence.steps.unshift({type:'sequence',slot:'b'});
 const playback=context.playSequence(single?1:null);await gate;assert.deepEqual(events,['ai'],'following step waits for policy completion');if(cancel)context.sequenceRunId++;release();await playback;return events;
}
test('sequencer awaits an AI episode before running the next step',async()=>assert.deepEqual(await run(false),['ai','ai-ended','delay','wait']));
test('a stopped AI sequence cannot advance to its next step',async()=>assert.deepEqual(await run(true),['ai','ai-ended']));

test('clicking an AI step runs only that policy, skipping sequence calls and subsequent steps',async()=>assert.deepEqual(await run(false,true),['ai','ai-ended']));
