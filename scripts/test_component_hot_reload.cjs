const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const loader=require('../devserver/component-registry');
const originalLoader=loader.loadComponentRegistry;
let newModelAvailable=false;
loader.loadComponentRegistry=(...args)=>{
 const registry=originalLoader(...args);
 if(newModelAvailable)registry.register({objectType:'Hot reload sensor',draw(){}});
 return registry;
};
const {createServer}=require('../devserver/server');
const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/robots/Walker/config.json'),'utf8'));
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'robot-model-reload-'));
fs.writeFileSync(path.join(directory,'config.json'),JSON.stringify(config));
let server;
async function open(){server=createServer(directory);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+server.address().port;}
(async()=>{try{
 let base=await open();
 const changed=structuredClone(config);
 changed.components.push({name:'Aluminium Extrusion 20x20x100 mm 1',objectType:'Aluminium Extrusion 20x20x100 mm',massGrams:120,parent:null,position:{x:20,y:50,z:30},rotation:{x:90,y:0,z:0}});
 changed.components.push({name:'Saved GY-801',objectType:'GY-801',massGrams:7.5,parent:null,position:{x:12,y:25,z:4},rotation:{x:0,y:90,z:0}});
 changed.components.push({name:'New sensor',objectType:'Hot reload sensor',parent:null,position:{x:0,y:25,z:0},rotation:{x:0,y:0,z:0}});
 const save=()=>fetch(base+'/api/config/local',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({robot:'Robot',configuration:changed,originalNames:config.components.map(c=>c.name)})});
 let response=await save();assert.equal(response.status,400);assert.match(await response.text(),/Unknown component/);
 newModelAvailable=true;
 response=await save();assert.equal(response.status,200,await response.text());
 let restored=await(await fetch(base+'/config.json')).json();assert.equal(restored.components.at(-1).objectType,'Hot reload sensor');
 await new Promise(resolve=>server.close(resolve));base=await open();
 restored=await(await fetch(base+'/config.json')).json();assert.equal(restored.components.at(-1).name,'New sensor');
 const extrusion=restored.components.find(c=>c.objectType==='Aluminium Extrusion 20x20x100 mm');assert.equal(extrusion.name,'Aluminium Extrusion 20x20x100 mm 1');assert.equal(extrusion.massGrams,120);assert.equal(extrusion.position.y,50);assert.equal(extrusion.rotation.x,90);
 const gyro=restored.components.find(c=>c.objectType==='GY-801');assert.equal(gyro.name,'Saved GY-801');assert.deepEqual(gyro.position,{x:12,y:25,z:4});assert.equal(gyro.rotation.y,90);assert.equal(gyro.massGrams,7.5);
 console.log('Model reload passed: running server discovers new definitions, saves and reloads their component configuration across restart.');
}finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));loader.loadComponentRegistry=originalLoader;fs.rmSync(directory,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1;});
