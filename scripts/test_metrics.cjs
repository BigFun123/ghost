const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');

let now = 0, timer, disconnected = false, clearCalled = false;

const calls = [];

const ctx = Object.fromEntries(['translate','setTransform','clearRect','beginPath','moveTo','lineTo','stroke','fillText','save','rect','clip','restore'].map(name => [name, (...args) => calls.push([name, ...args])]));

const canvas = {clientWidth: 600, clientHeight: 140, getContext: () => ctx};

const legend = {children: [], replaceChildren(){this.children=[];}, append(button){this.children.push(button);}};

const document = {hidden: false, createElement: () => ({style:{setProperty(){}}, attributes:{}, listeners:{}, setAttribute(key,value){this.attributes[key]=value;}, addEventListener(key,fn){this.listeners[key]=fn;}, remove(){legend.children.splice(legend.children.indexOf(this),1);}})};

const context = {document,window:{devicePixelRatio:2},performance:{now:()=>now},setInterval:fn=>{timer=fn;return 1;},clearInterval:()=>clearCalled=true,ResizeObserver:class{observe(){} disconnect(){disconnected=true;}}};

vm.createContext(context);vm.runInContext(fs.readFileSync('data/metrics.js','utf8'),context);

const id = {}, robot = {};

let state = {robot,servos:[{id,name:'Servo 1',angle:90,continuous:false}]};

let hiddenClass = false;

document.body = {classList:{toggle(name, value){assert.equal(name,'metrics-hidden');hiddenClass=value;}}};

const panel = {hidden:false};

const toggle = {attributes:{},setAttribute(key,value){this.attributes[key]=value;},addEventListener(type,fn){this.click=fn;},removeEventListener(){}};

const categoryButtons = ['rotation','gyro','motion','compass','barometer','temperature','velocity','power'].map(category => ({

 dataset:{metricCategory:category}, attributes:{}, setAttribute(key,value){this.attributes[key]=value;},

 addEventListener(type,fn){this.click=fn;}, removeEventListener(){this.removed=true;}

}));

const metrics = context.createServoMetrics({canvas,legend,read:()=>state,toggle,panel,categoryButtons});

assert.deepEqual(categoryButtons.map(button=>button.attributes['aria-pressed']), ['true','false','false','false','false','false','false','false']);



toggle.click();assert.equal(panel.hidden,true);assert.equal(toggle.attributes['aria-expanded'],'false');assert.equal(hiddenClass,true);

toggle.click();assert.equal(panel.hidden,false);assert.equal(toggle.attributes['aria-expanded'],'true');assert.equal(hiddenClass,false);

assert.equal(canvas.width,1200);assert.equal(legend.children[0].textContent,'Servo 1: 90.0°');

for(let i=1;i<=400;i++){now=i*100;metrics.sample(now);}

calls.length=0;metrics.sample(now+100);

const lines=calls.filter(call=>call[0]==='lineTo').length;

assert.ok(lines<=312,'history stays bounded');assert.ok(lines>290,'recent history retained');

legend.children[0].listeners.click();assert.equal(legend.children[0].attributes['aria-pressed'],'false');

calls.length=0;metrics.sample(now+200);assert.equal(calls.filter(call=>call[0]==='lineTo').length,12,'hidden trace omitted');

legend.children[0].listeners.click();state.servos[0].angle=null;metrics.sample(now+300);assert.equal(legend.children[0].textContent,'Servo 1: —');

state={robot:{},servos:[{id:{},name:'New servo',angle:180,continuous:true}]};calls.length=0;metrics.sample(now+400);

assert.equal(legend.children.length,1);assert.equal(legend.children[0].textContent,'New servo: 180.0°');

assert.equal(calls.filter(call=>call[0]==='lineTo').length,12,'robot switch clears old history');

assert.ok(calls.some(call=>call[0]==='fillText'&&call[1]==='360°'));

state.servos=[];metrics.sample(now+500);assert.equal(legend.children.length,0);

const owner={};

state.series=[{owner,id:'gyroX',name:'IMU gyro X (sim)',value:-90,unit:'°/s'}, {owner,id:'pressure',name:'IMU pressure (sim)',value:1013.25,unit:'hPa'}];

metrics.sample(now+600);

assert.equal(legend.children.length,2);

assert.equal(legend.children[0].hidden,true);assert.equal(legend.children[1].hidden,true);

categoryButtons[6].click();

assert.equal(legend.children[0].hidden,false);assert.equal(legend.children[1].hidden,true);

assert.equal(legend.children[0].textContent,'IMU gyro X (sim): -90.0\u00b0/s');

categoryButtons[4].click();

assert.equal(legend.children[0].hidden,false);assert.equal(legend.children[1].hidden,false);

assert.equal(legend.children[1].textContent,'IMU pressure (sim): 1013.25hPa');

categoryButtons[6].click();

assert.equal(legend.children[0].hidden,true);assert.equal(legend.children[1].hidden,false);

state.series.push({owner,id:'heading',name:'Compass',value:90,unit:'\u00b0'});

metrics.sample(now+650);

assert.equal(legend.children[2].hidden,true,'compass heading is separate from rotation');

categoryButtons[3].click();

assert.equal(legend.children[2].hidden,false);

state.series.pop();

state.series[1].value=1013.24;metrics.sample(now+700);assert.equal(legend.children.length,2,'stable sensor ids retain history');

state.series=[];metrics.sample(now+800);assert.equal(legend.children.length,0);

state.servos=[{id:{},name:'Servo',angle:90}];
state.series=[{owner:{},id:'rotationX',name:'GY-801 rotation X',value:10,unit:'\u00b0'}];
metrics.sample(now+900);
assert.equal(legend.children[0].attributes['aria-pressed'],'true','servo rotation starts enabled');
assert.equal(legend.children[1].hidden,true,'sensor rotation button is absent from the default rotation view');
categoryButtons[1].click();
assert.equal(legend.children[1].hidden,false,'Gyro reveals the sensor rotation button');
state.series.push({owner:{},id:'gyroY',name:'Angular velocity Y',value:45,unit:'\u00b0/s'});
metrics.sample(now+950);
assert.equal(legend.children[2].hidden,true,'Gyro does not show angular velocity');
categoryButtons[6].click();
assert.equal(legend.children[2].hidden,false,'Velocity reveals angular velocity');

assert.equal(legend.children[1].attributes['aria-pressed'],'true','sensor rotation is enabled in the Gyro view');
metrics.sample(now+1000);
assert.equal(legend.children[1].hidden,false,'sensor rotation remains in the Gyro view');
categoryButtons[1].click();
assert.equal(legend.children[1].hidden,true,'turning Gyro off hides its sensor rotation button');
state.series.push({owner:{},id:'power',category:'power',name:'Servo power (estimated)',value:2.5,unit:'W',range:[0,10]});
state.series.push({owner:{},id:'power',category:'power',name:'Controller power (not calibrated)',value:null,unit:'W'});
metrics.sample(now+1100);
assert.equal(legend.children[3].hidden,true,'power is hidden by default');
categoryButtons[7].click();
assert.equal(legend.children[3].hidden,false);
assert.equal(legend.children[4].hidden,false,'each component has its own power trace');
assert.equal(legend.children[3].textContent,'Servo power (estimated): 2.5W');
assert(legend.children[4].textContent.startsWith('Controller power (not calibrated):'));
categoryButtons[7].click();
assert.equal(legend.children[3].hidden,true);
metrics.destroy();assert.ok(clearCalled&&disconnected);assert.ok(categoryButtons.every(button=>button.removed));

console.log('Metrics passed: sampling, legend toggles, bounded history, unavailable angles, robot replacement/removal, continuous scale, resize and cleanup.');

