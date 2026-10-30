const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../data/ai-reward');
const target={valid:true,distanceMm:100,hit:{kind:'component',index:7}};
const other={valid:true,distanceMm:1,hit:{kind:'component',index:8}};
function tick(model,overrides={}) {model.tick({reading:target,elapsedSeconds:.05,actualTravel:0,heldSeconds:.05,alignment:.5,...overrides});}
test('success has an inspectable bonus, terms sum exactly and reset clears episode credit',()=>{
  const model=create({targetIndex:7,holdSeconds:.5});assert.equal(model.reset(.5).episodeReward,0);
  for(let i=1;i<=10;i++){model.beginAction();tick(model,{heldSeconds:i*.05,success:i===10});}
  const result=model.snapshot();assert.equal(result.episodeTerms.detection,.25);assert.equal(result.terms.success,10);assert.equal(result.episodeTerms.hold,1);
  assert(result.episodeReward>11);assert.equal(result.reward,Object.values(result.terms).reduce((a,b)=>a+b,0));
  assert.throws(()=>model.beginAction(),/Reset/);model.reset(.5);model.beginAction();tick(model);assert.equal(model.snapshot().terms.detection,.25);
});
test('floor, robot and missing returns cannot earn detection, hold or success',()=>{
  for(const reading of [other,{...other,hit:{kind:'floor'}},{valid:false,distanceMm:null,hit:null}]) {
    const model=create({targetIndex:7,holdSeconds:.5});model.reset(.5);model.beginAction();tick(model,{reading,heldSeconds:1,success:true});
    const {terms}=model.snapshot();assert.equal(terms.detection,0);assert.equal(terms.hold,0);assert.equal(terms.success,0);assert(model.snapshot().reward<0);
  }
});
test('repeated detection/loss cannot farm detection or hold progress',()=>{
  const model=create({targetIndex:7,holdSeconds:.5});model.reset(.5);
  for(let i=0;i<100;i++) {
    model.beginAction();tick(model,{heldSeconds:.45});model.beginAction();tick(model,{reading:other,heldSeconds:0});
  }
  const result=model.snapshot();assert.equal(result.episodeTerms.detection,.25);assert(Math.abs(result.episodeTerms.hold)<1e-12);
  assert(result.episodeReward<0,'time costs outweigh repeatedly dropping target lock');
});
test('alignment potential telescopes; movement and repeated limit pushing cost reward',()=>{
  const model=create({targetIndex:7,holdSeconds:.5});model.reset(0);
  for(let i=0;i<100;i++) {model.beginAction({commandTravel:2});tick(model,{reading:other,actualTravel:2,heldSeconds:0,alignment:1});model.beginAction({commandTravel:2,limitFraction:1});tick(model,{reading:other,actualTravel:2,heldSeconds:0,alignment:0});}
  const result=model.snapshot();assert(Math.abs(result.episodeTerms.alignment)<1e-12);assert(result.episodeTerms.limit<-4.9);assert(result.episodeTerms.movement<0);assert(result.episodeReward<0);
  model.reset(0);model.beginAction();tick(model,{reading:other,heldSeconds:0,alignment:1});assert.equal(model.snapshot().terms.alignment,4);
});
test('invalid state terminates reward credit with a penalty and no success bonus',()=>{
  const model=create({targetIndex:7,holdSeconds:.5});model.reset(.5);model.beginAction();tick(model,{invalid:true,success:true,heldSeconds:1});
  assert.equal(model.snapshot().terms.invalid,-5);assert.equal(model.snapshot().terms.success,0);assert.equal(model.snapshot().terms.detection,0);assert.throws(()=>tick(model),/ended/);
});
