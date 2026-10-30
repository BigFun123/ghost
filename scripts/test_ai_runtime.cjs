const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const tf = require('../devserver/vendor/tensorflow-4.22.0/tf.min.js');
const runtime = require('../data/ai-runtime.js');

test('pinned runtime performs repeated training updates without tensor growth', async () => {
  assert.equal(tf.version.tfjs, '4.22.0');
  await tf.setBackend('cpu'); await tf.ready();
  const baseline = tf.memory().numTensors;
  for (let i = 0; i < 3; i++) {
    const result = await runtime.smokeTest(tf);
    assert(result.after < result.before);
    assert.equal(tf.memory().numTensors, baseline);
  }
});

test('lazy loader retries failed loads, caches success and falls back from WebGL', async () => {
  const scripts = [], messages = [];
  const fake = { version: { tfjs: '4.22.0' }, async setBackend(name) { if(name === 'webgl') throw new Error('No GPU'); return true; }, async ready() {}, getBackend: () => 'cpu' };
  const context = { setTimeout, clearTimeout, performance, document: { createElement() {return {remove() {}};}, head: {append(script) {scripts.push(script);}} } };
  vm.createContext(context); vm.runInContext(fs.readFileSync('data/ai-runtime.js', 'utf8'),context);
  const first = context.GhostTensorFlow.load(); scripts[0].onerror(); await assert.rejects(first,/Could not load/);
  const second = context.GhostTensorFlow.load(); context.tf = fake; scripts[1].onload(); assert.equal(await second,fake);
  assert.equal(await context.GhostTensorFlow.load(),fake); assert.equal(scripts.length,2);
  // Real numerical smoke checks above; exercise backend selection here with the same real CPU implementation.
  Object.assign(fake, { sequential: tf.sequential, layers: tf.layers, train: tf.train, tensor2d: tf.tensor2d, tidy: tf.tidy, memory: tf.memory, nextFrame: tf.nextFrame });
  const result = await context.GhostTensorFlow.initialize(message=>messages.push(message));
  assert.equal(result.backend,'cpu'); assert(messages.some(message=>message.includes('CPU fallback')));
});

test('scene changes during async initialization are rejected and controls recover', async () => {
  const elements = new Map();
  function element() { return { children: [], value:'cpu', append(child){this.children.push(child);}, replaceChildren(){this.children=[];}, addEventListener(name,fn){this[name]=fn;}, get childElementCount(){return this.children.length;} }; }
  let finish;
  const context = { Date, document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element}, currentRobotName:'PanTilt', offlineSimulation:true, servoPreview:{nodes:[{name:'Pan',objectType:'Servo',parent:null},{name:'Tilt',objectType:'Servo',parent:1},{name:'Sensor',objectType:'VL53L0X V2 Time of Flight Sensor',parent:2},{name:'Target',objectType:'Target',parent:null}]}, GhostTensorFlow:{initialize:()=>new Promise(resolve=>{finish=resolve;})},setText(id,value){context.document.getElementById(id).textContent=value;} };
  context.GhostLearningTask = { ancestry:require('../data/ai-task').ancestry, validate:()=>({sensorIndex:2,targetIndex:3,joints:[{name:'Pan',min:0,max:180,startup:90},{name:'Tilt',min:0,max:180,startup:90}],solution:{angles:[30,90],distanceMm:195},holdSeconds:0.5,episodeSeconds:10,notes:'Kinematic check'}) };
  context.servoWorldPoint=()=>{};context.componentRegistry={};context.previewRayDistance=()=>{};
  context.GhostLearningWorker={create:()=>({request:()=>context.GhostTensorFlow.initialize(),dispose(){}})};
  vm.createContext(context);vm.runInContext(fs.readFileSync('data/ai-learning.js','utf8'),context);
  const button=elements.get('aiLearningInitialize'); const pending=button.click(); assert.equal(button.disabled,true);
  context.offlineSimulation=false; finish({version:'4.22.0',backend:'cpu'});await pending;
  assert.match(elements.get('aiLearningStatus').textContent,/^Setup needs attention:/);assert.equal(button.disabled,false);
  await button.click(); assert(elements.get('aiLearningOutput').children.at(-1).textContent.includes('Enable Offline'));
});

test('AI Learning initializes, resets, steps and disposes its environment controls', async () => {
  const elements=new Map();
  function element(){return {children:[],value:'',append(child){this.children.push(child);},replaceChildren(){this.children=[];},addEventListener(name,fn){this[name]=fn;},get childElementCount(){return this.children.length;}};}
  let resets=0,steps=0,disposed=0;
  const result={observation:{jointAnglesDegrees:[90,90],sensor:{valid:false,distanceMm:null}},info:{simulationSeconds:0,holdSeconds:0,reason:null},terminated:false,truncated:false};
  const selectedTask={sensorIndex:2,targetIndex:3,joints:[{name:'Pan',min:0,max:180,startup:90},{name:'Tilt',min:0,max:180,startup:90}],solution:{angles:[30,90],distanceMm:195},holdSeconds:0.5,episodeSeconds:10,notes:'Kinematic check'};
  const context={Date,document:{getElementById(id){if(!elements.has(id)){const item=element();item.value=id==='aiLearningSeed'?'42':id==='aiLearningBackend'?'cpu':id==='aiLearningAction'?'0':'';elements.set(id,item);}return elements.get(id);},createElement:element},currentRobotName:'PanTilt',offlineSimulation:true,servoPreview:{configuration:{components:[]},nodes:[{name:'Pan',objectType:'Servo',parent:null},{name:'Tilt',objectType:'Servo',parent:1},{name:'Sensor',objectType:'VL53L0X V2 Time of Flight Sensor',parent:2},{name:'Target',objectType:'Target',parent:null}]},GhostTensorFlow:{initialize:async()=>({version:'4.22.0',backend:'cpu'})},GhostLearningTask:{ancestry:require('../data/ai-task').ancestry,validate:()=>selectedTask},GhostPhysics:{load:async()=>({})},GhostLearningEnvironment:{create:()=>({reset(seed){assert.equal(seed,42);resets++;return result;},step(action){assert.equal(action,0);steps++;return result;},dispose(){disposed++;}})},servoWorldPoint(){},rotateServoPoint(){},collectPreviewPhysicsNodes(){},collectPreviewPhysicsShapes(){},componentRegistry:{},setText(id,value){context.document.getElementById(id).textContent=value;}};
  context.GhostLearningWorker={create:()=>({request:()=>context.GhostTensorFlow.initialize(),dispose(){}})};
  vm.createContext(context);vm.runInContext(fs.readFileSync('data/ai-learning.js','utf8'),context);
  await elements.get('aiLearningInitialize').click();
  assert.equal(resets,1);assert.equal(elements.get('aiLearningStep').disabled,false);
  elements.get('aiLearningReset').click();elements.get('aiLearningStep').click();assert.equal(resets,2);assert.equal(steps,1);
  context.offlineSimulation=false;context.GhostLearning.refresh();assert.equal(disposed,1);assert.equal(elements.get('aiLearningStep').disabled,true);
});
