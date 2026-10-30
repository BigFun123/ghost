// Request IDs route bounded worker events; terminating rejects pending work and ignores late messages.
(function(scope){
  function create({workerFactory,onFatal=()=>{}}={}){
    const worker=workerFactory?workerFactory('./ai-worker.js'):new Worker(new URL('./ai-worker.js',document.baseURI));
    const pending=new Map();let serial=0,disposed=false;
    function dispose(reason='Learning worker stopped.'){
      if(disposed)return;disposed=true;worker.terminate();
      for(const request of pending.values()){clearTimeout(request.timeout);request.reject(new Error(reason));}pending.clear();
    }
    worker.onmessage=({data})=>{
      if(disposed)return;
      const request=pending.get(data.id);if(!request)return;
      if(data.event){request.onEvent?.(data.event,data.data);return;}
      pending.delete(data.id);clearTimeout(request.timeout);
      if(data.error)request.reject(new Error(data.error));else request.resolve(data.result);
    };
    worker.onerror=event=>{if(disposed)return;const message=event.message||'Learning worker failed.';dispose(message);onFatal(message);};
    worker.onmessageerror=()=>{if(disposed)return;dispose('Could not decode a learning worker message.');onFatal('Could not decode a learning worker message.');};
    function request(type,payload={},onEvent){
      if(disposed)return Promise.reject(new Error('Learning worker is stopped. Initialize again.'));
      return new Promise((resolve,reject)=>{
        const id=++serial,entry={resolve,reject,onEvent};pending.set(id,entry);
        if(!['train','evaluate','test','monitor','qualify'].includes(type))entry.timeout=setTimeout(()=>{dispose('Learning worker timed out. Initialize again.');onFatal('Learning worker timed out. Initialize again.');},60000);
        try{worker.postMessage({id,type,payload});}catch(error){pending.delete(id);clearTimeout(entry.timeout);reject(error);}
      });
    }
    return {request,dispose};
  }
  scope.GhostLearningWorker={create};
  if(typeof module!=='undefined'&&module.exports)module.exports=scope.GhostLearningWorker;
})(globalThis);
