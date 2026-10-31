const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup({blockTrain=false,downloadsOnly=false}={}){
 const elements=new Map(),calls=[],saves=[],history=[],downloads=[];
 const defaults={aiPolicyName:'my-trained-policy',aiAutoBatches:'4',aiTrainingUpdates:'1',aiTrainingRollout:'64',aiLearningSeed:'42',aiTrainingSeed:'42',aiLearningBackend:'cpu',aiTrainingStage:'nearby',aiTrainingEnvironments:'4',aiBaselineCount:'1'};
 function element(){let value='';return {children:[],get value(){return value;},set value(next){value=String(next);},checked:true,append(child){this.children.push(child);child.remove=()=>{this.children.splice(this.children.indexOf(child),1);};},replaceChildren(){this.children=[];},addEventListener(name,fn){this[name]=fn;},get firstElementChild(){return this.children[0];},get childElementCount(){return this.children.length;}};}
 let updates=0,release;
 const episode={reason:'success',seconds:1,reward:2,jointTravelDegrees:10,falseTargetDetections:0,falseHoldAttempts:0,actionCounts:[1,1,0,0,0],clippedActionCount:0};
 const policy=()=>({completedUpdates:updates,settings:{}});
 const task={sensorIndex:2,targetIndex:3,joints:[{name:'Pan',min:0,max:180,startup:90},{name:'Tilt',min:0,max:180,startup:90}],solution:{angles:[30,90],distanceMm:195},holdSeconds:.5,episodeSeconds:10};
 const initial={observation:{jointAnglesDegrees:[90,90],sensor:{valid:false,distanceMm:null}},info:{simulationSeconds:0,holdSeconds:0,reason:null},terminated:false,truncated:false};
 const context={Date,setTimeout,document:{getElementById(id){if(!elements.has(id)){const e=element();e.value=defaults[id]??'';elements.set(id,e);}return elements.get(id);},createElement(tag){const e=element();if(tag==='a')e.click=()=>downloads.push(e.download);return e;}},currentRobotName:'PanTilt',offlineSimulation:true,localConfigServer:!downloadsOnly,Blob,URL:{createObjectURL:()=>'blob:test',revokeObjectURL(){}},servoPreview:{configuration:{components:[]},nodes:[{name:'Pan',objectType:'Servo',parent:null},{name:'Tilt',objectType:'Servo',parent:1},{name:'Sensor',objectType:'VL53L0X V2 Time of Flight Sensor',parent:2},{name:'Target',objectType:'Target',parent:null},{name:'Target Two',objectType:'Target',parent:null}]},GhostLearningTask:{ancestry:require('../data/ai-task').ancestry,validate:args=>({...task,targetIndex:args.targetIndex??3})},GhostPhysics:{load:async()=>({})},GhostLearningEnvironment:{create:()=>({reset:()=>initial,dispose(){}})},GhostAutoTraining:require('../data/ai-auto-training'),GhostBaselineEvaluation:require('../data/ai-evaluation'),GhostTestProgress:{clear(){history.length=0;},record(row){history.push(row);}},servoWorldPoint(){},rotateServoPoint(){},collectPreviewPhysicsNodes(){},collectPreviewPhysicsShapes(){},componentRegistry:{},setText(id,value){context.document.getElementById(id).textContent=value;},fetch:async(url,options)=>{if(options)saves.push(JSON.parse(options.body));return {ok:true,json:async()=>options?{path:'training/test.json'}:{trainingPolicyStorage:true}};}};
 context.GhostLearningWorker={create:()=>({dispose(){},async request(type,payload){calls.push({type,payload});if(type==='init')return {version:'4.22.0',backend:'cpu'};if(type==='create')return policy();if(type==='pause'||type==='resume')return {paused:type==='pause'};if(type==='retarget')return {...policy(),targetChanged:true,convergence:{rows:[],rate:null,windows:0,status:'Stale / target changed',converged:false}};if(type==='train'){if(blockTrain)await new Promise(resolve=>{release=resolve;});updates++;return {policy:policy(),steps:64,updates:1,cancelled:false};}if(type==='monitor'||type==='qualify')return {episodes:Array.from({length:50},(_,i)=>({...episode,seed:200003+i})),cancelled:false,qualified:type==='qualify',convergence:{rows:[],rate:1,status:'Converged (validation)',windows:Math.min(3,updates),passed:Math.min(3,updates),converged:updates>=3}};if(type==='test')return {episodes:[{...episode,seed:42}],cancelled:false};if(type==='save')return {training:{completedUpdates:updates}};return {};}})};
 vm.createContext(context);vm.runInContext(fs.readFileSync('data/ai-learning.js','utf8'),context);
 return {elements,calls,saves,history,downloads,context,release:()=>release()};
}
test('Full Auto initializes, monitors fifty cases, tests startup, qualifies and saves',async()=>{
 const f=setup();await f.elements.get('aiTrainingAuto').click();
 assert.equal(f.calls.filter(row=>row.type==='train').length,3,f.elements.get('aiAutoProgress').textContent+' / '+f.elements.get('aiTrainingProgress').textContent+' / '+f.elements.get('aiTestStatus').textContent);
 for(const row of f.calls.filter(row=>row.type==='train')){assert.equal(row.payload.warm,true);assert.equal(row.payload.progressive,true);assert.equal(row.payload.environmentCount,4);}
 for(const row of f.calls.filter(row=>row.type==='monitor'))assert.equal(row.payload.count,50);
 for(const row of f.calls.filter(row=>row.type==='test'))assert.deepEqual(Array.from(row.payload.angles),[90,90]);
 assert.equal(f.history.length,3);assert.equal(f.saves.length,1);assert.equal(f.saves[0].name,'my-trained-policy');assert.equal(f.saves[0].policy.training.completedUpdates,3);
 assert.equal(f.elements.get('aiLearningTabSpinner').hidden,true);assert.match(f.elements.get('aiAutoProgress').textContent,/Qualification passed/);assert.equal(f.elements.get('aiTrainingAuto').disabled,false);
 assert.equal(f.elements.get('aiLearningTargetSelect').disabled,false);assert.match(f.elements.get('aiPolicyFileStatus').textContent,/training\/test.json/);
});
test('Stop auto train cancels the loop, retains policy and prevents saving',async()=>{
 const f=setup({blockTrain:true});const pending=f.elements.get('aiTrainingAuto').click();
 while(!f.calls.some(row=>row.type==='train'))await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.elements.get('aiLearningTabSpinner').hidden,false);
 f.elements.get('aiTrainingStop').click();assert.equal(f.elements.get('aiLearningTabSpinner').hidden,true);f.release();await pending;
 assert.equal(f.calls.filter(row=>row.type==='train').length,1);assert.equal(f.calls.some(row=>row.type==='monitor'),false);assert.equal(f.saves.length,0);
 assert.equal(f.elements.get('aiTrainingSave').disabled,false);assert.match(f.elements.get('aiAutoProgress').textContent,/stopped/);
});
test('scene disposal cancels auto work and prevents a stale policy or save',async()=>{
 const f=setup({blockTrain:true});const pending=f.elements.get('aiTrainingAuto').click();
 while(!f.calls.some(row=>row.type==='train'))await new Promise(resolve=>setImmediate(resolve));
 f.context.GhostLearning.stopEnvironment();f.release();await pending;
 assert.equal(f.saves.length,0);assert.equal(f.calls.some(row=>row.type==='monitor'),false);
 assert.equal(f.elements.get('aiTrainingSave').disabled,true);assert.equal(f.elements.get('aiTrainingAuto').disabled,false);
 assert.match(f.elements.get('aiAutoProgress').textContent,/cancelled/);
});

test('custom policy name is used for downloads and strips a supplied JSON extension once',async()=>{const f=setup({downloadsOnly:true});await f.elements.get('aiTrainingAuto').click();assert.deepEqual(f.downloads,['my-trained-policy.json']);f.elements.get('aiPolicyName').value='  renamed policy.json  ';await f.elements.get('aiTrainingSave').click();assert.equal(f.downloads.at(-1),'renamed policy.json');assert.match(f.elements.get('aiPolicyFileStatus').textContent,/Exported renamed policy.json/);});
test('unsafe policy names are rejected before writing any checkpoint',async()=>{const f=setup();await f.elements.get('aiTrainingAuto').click();const writes=f.saves.length;f.elements.get('aiPolicyName').value='../escape';await f.elements.get('aiTrainingSave').click();assert.equal(f.saves.length,writes);assert.match(f.elements.get('aiPolicyFileStatus').textContent,/Save failed: Enter a policy file name/);});

test('switching target retains learned weights and enables testing without another training run',async()=>{const f=setup();await f.elements.get('aiTrainingAuto').click();const trains=f.calls.filter(c=>c.type==='train').length;f.elements.get('aiLearningTargetSelect').value='4';await f.elements.get('aiLearningTargetSelect').change();assert.equal(f.elements.get('aiTestRun').disabled,false);assert.equal(f.elements.get('aiPolicyState').textContent,'POLICY READY');assert.equal(f.calls.find(c=>c.type==='retarget').payload.task.targetIndex,4);assert.match(f.elements.get('aiConvergenceStatus').textContent,/Stale/);await f.elements.get('aiTestRun').click();assert.equal(f.calls.filter(c=>c.type==='train').length,trains);assert.equal(f.history.length,1);assert.match(f.elements.get('aiTestStatus').textContent,/success/);});
test('invalid target changes leave the previous target and policy usable',async()=>{const f=setup();await f.elements.get('aiTrainingAuto').click();f.context.GhostLearningTask.validate=()=>{throw new Error('Target unreachable');};f.elements.get('aiLearningTargetSelect').value='4';await f.elements.get('aiLearningTargetSelect').change();assert.equal(f.elements.get('aiLearningTargetSelect').value,'3');assert.equal(f.elements.get('aiTestRun').disabled,false);assert.match(f.elements.get('aiLearningStatus').textContent,/Target change rejected/);});

test('tab indicator pauses and resumes with manual training and clears after stop',async()=>{const f=setup({blockTrain:true});await f.elements.get('aiLearningInitialize').click();const spinner=f.elements.get('aiLearningTabSpinner');spinner.classList={toggle(name,value){this[name]=value;}};const pending=f.elements.get('aiTrainingStart').click();while(!f.calls.some(c=>c.type==='train'))await new Promise(resolve=>setImmediate(resolve));assert.equal(spinner.hidden,false);await f.elements.get('aiTrainingPause').click();assert.equal(spinner.hidden,false);assert.equal(spinner.classList['is-paused'],true);assert.match(f.elements.get('aiLearningTab').title,/paused/);await f.elements.get('aiTrainingPause').click();assert.equal(spinner.classList['is-paused'],false);f.elements.get('aiTrainingStop').click();f.release();await pending;assert.equal(spinner.hidden,true);});
