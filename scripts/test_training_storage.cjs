const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const tf=require('../devserver/vendor/tensorflow-4.22.0/tf.min.js');
require('../data/ai-ppo');const files=require('../data/ai-policy-file');
const {createServer}=require('../devserver/server');
const {savePolicy}=require('../devserver/training-storage');

test('local policy saves keep a stable name, back up the previous version, and reject malformed or unsafe requests',async()=>{
  await tf.setBackend('cpu');await tf.ready();
  const agent=GhostPPO.create({tf}),policy=files.save({agent,context:{fixture:true}});agent.dispose();
  const workspace=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(workspace,'.tmp-training-'));
  const data=path.join(root,'data'),training=path.join(root,'training');fs.mkdirSync(data);fs.writeFileSync(path.join(data,'config.json'),JSON.stringify({components:[]}));
  const server=createServer(data,'https://epistemic.co.za',{trainingDirectory:training});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const save=(body,headers={})=>fetch(base+'/api/training/policies',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  try{
    assert.equal((await(await fetch(base+'/api/devserver')).json()).trainingPolicyStorage,true);
    const first=await save({name:'PanTilt',policy});assert.equal(first.status,201);const one=await first.json();
    const newest={...policy,summary:{...policy.summary,successPercent:92,status:'Improving / unstable'},training:{completedUpdates:12}};
    const second=await save({name:'PanTilt',policy:newest});assert.equal(second.status,201);const two=await second.json();
    assert.equal(one.filename,'PanTilt.json');assert.equal(two.filename,'PanTilt.json');assert.equal(one.filename,two.filename);assert.equal(one.backup,null);assert(two.backup.startsWith('training/backups/PanTilt--'));assert.deepEqual(JSON.parse(fs.readFileSync(path.join(training,'backups',path.basename(two.backup)),'utf8')),policy);assert.equal(one.path,'training/'+one.filename);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(training,one.filename),'utf8')),newest);
    const listed=await(await fetch(base+'/api/training/policies')).json();assert.deepEqual(listed.map(item=>item.filename),['PanTilt.json']);
    assert.deepEqual(await(await fetch(base+'/api/training/policy?file='+encodeURIComponent(one.filename))).json(),newest);
    assert.equal((await fetch(base+'/api/training/policy?file=../config.json')).status,400);
    const aiSequence={loop:false,finish:true,steps:[{type:'ai',policy:'file:PanTilt.json'}]};
    assert.equal((await fetch(base+'/api/sequence/a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(aiSequence)})).status,200);
    assert.deepEqual((await(await fetch(base+'/api/sequence/a')).json()).steps,aiSequence.steps);
    assert.equal((await fetch(base+'/api/sequence/a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...aiSequence,steps:[{type:'ai',policy:'../escape'}]})})).status,400);
    assert.equal((await save({name:'../escape',policy})).status,400);
    const bad=structuredClone(policy);bad.network.weights[0].values[0]=1e100;
    assert.equal((await save({name:'PanTilt',policy:bad})).status,400);
    assert.equal((await save({name:'PanTilt',policy:{format:'invalid'}})).status,400);
    assert.equal((await save({name:'PanTilt',policy},{Origin:'https://example.com'})).status,403);
    assert.equal((await save({name:'PanTilt',policy},{'Content-Type':'text/plain'})).status,415);
    const malformed=await fetch(base+'/api/training/policies',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});assert.equal(malformed.status,400);
    assert.equal((await save({name:'PanTilt',policy,padding:'x'.repeat(2*1024*1024)})).status,413);
    assert.equal(fs.readdirSync(training).length,2);
    for(const operation of ['copyFileSync','renameSync']){
      const original=fs[operation];fs[operation]=()=>{throw new Error('Simulated save failure');};
      try{assert.throws(()=>savePolicy(training,'PanTilt',policy),/Simulated save failure/);}finally{fs[operation]=original;}
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(training,'PanTilt.json'),'utf8')),newest,'failed replacement preserves the current policy');
      assert(!fs.readdirSync(training).some(name=>name.startsWith('.policy-')),'temporary files are cleaned');
    }
    assert.equal((await fetch(base+'/'+one.path)).status,404,'Artifacts are not served from the controller assets root');
    assert.throws(()=>savePolicy(training,'C:\\escape',policy),/Invalid policy name/);
    for(const name of ['CON','LPT1.json','../escape',''])assert.throws(()=>savePolicy(training,name,policy),/Invalid policy name/);
    assert.equal(savePolicy(training,'My policy.json',policy).filename,'My policy.json');
  }finally{
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    assert.equal(path.dirname(path.resolve(root)),workspace);fs.rmSync(root,{recursive:true,force:true});
  }
});
