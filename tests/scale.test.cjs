const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>\r?\n([\s\S]*?)<\/script>/)[1];
const reading = (overrides={}) => ({g:0,timer_s:0,running:false,cal:true,sensor_ok:true,pour_mode:false,pour_armed:false,pour_id:1,...overrides});
const response = data => ({ok:true,json:async()=>data});

function app(fetch = async () => response(reading())) {
  const elements = {};
  const timeouts=new Map(); let timerId=0;
  for(const [,id] of html.matchAll(/id="([^"]+)"/g)) elements[id] = {
    textContent:'',innerHTML:'',value:'',style:{},className:'',disabled:false,
    classList:{add(){},remove(){},toggle(){}},
  };
  const context = vm.createContext({document:{
    getElementById:id=>elements[id],querySelectorAll:()=>[],addEventListener(){},visibilityState:'visible',
  }, localStorage:{getItem(){return null;},setItem(){}},
  fetch,AbortController,URL,Date,TypeError,setTimeout(fn,ms){const id=++timerId;timeouts.set(id,{fn,ms});return id;},clearTimeout(id){timeouts.delete(id);},setInterval(){return 1;},clearInterval(){},
  NoSleep:class {async enable(){} disable(){}},window:{},navigator:{}});
  vm.runInContext(script,context);
  return {elements,run:code=>vm.runInContext(code,context),timeout:ms=>{
    for(const [id,t] of timeouts) if(t.ms===ms){timeouts.delete(id);t.fn();return;}
    throw new Error('No timeout for '+ms);
  }};
}

async function scaleBrew(p) {
  await p.run(`settings.brewMode='scale'; settings.scaleAddress='192.168.1.60'; scale.base='http://192.168.1.60'; scale.connected=true; scale.data=${JSON.stringify(reading())}; startBrew()`);
}

function feed(p, overrides) { p.run(`acceptScaleData(${JSON.stringify(reading(overrides))})`); }

test('accepts private WiFi IPs and rejects public URLs, credentials and paths', () => {
  const p=app();
  for(const ip of ['192.168.1.60','10.24.3.87','172.16.0.2','172.31.4.8']) assert.equal(p.run(`scaleURL('${ip}')`),'http://'+ip);
  for(const ip of ['8.8.8.8','172.32.0.1','127.0.0.1','coffeescale.local','https://192.168.1.60','http://x:y@192.168.1.60','http://192.168.1.60/api/weight']) assert.throws(()=>p.run(`scaleURL('${ip}')`));
});

test('connect saves the address, requests local network access, and validates firmware', async () => {
  let options;
  const p=app(async (url,opts)=>{assert.equal(url,'http://10.24.3.87/api/weight');options=opts;return response(reading());});
  p.run("settings.brewMode='scale'"); p.elements.scaleAddress.value='10.24.3.87';
  await p.run('connectScale()');
  assert.equal(p.run('settings.scaleAddress'),'10.24.3.87');
  assert.equal(options.targetAddressSpace,'local');
  assert.equal(options.credentials,'omit');
  assert.equal(p.run('scale.connected'),true);
  assert.throws(()=>p.run('checkScaleData({g:0,timer_s:0,running:false})'),/firmware update/);
  assert.throws(()=>p.run(`checkScaleData(${JSON.stringify(reading({cal:false}))})`),/Calibrate/);
  assert.throws(()=>p.run(`checkScaleData(${JSON.stringify(reading({sensor_ok:false}))})`),/sensor/);
});

test('tare & arm waits for the board to detect the first pour', async () => {
  const calls=[];
  const p=app(async (url,opts)=>{calls.push([url,opts.method]);return response(reading({pour_mode:true,pour_armed:true,pour_id:7}));});
  await scaleBrew(p); await p.run('handleBrewBtn()');
  assert.deepEqual(calls,[['http://192.168.1.60/api/pour/arm','POST']]);
  assert.equal(p.run('started'),false);
  assert.equal(p.run('scale.armed'),true);
  assert.match(p.elements.scaleGuidance.textContent,/begin pouring/);
  feed(p,{g:3,timer_s:0.4,running:true,pour_mode:true,pour_id:7});
  assert.equal(p.run('started'),true);
  assert.equal(p.elements.brewBtn.textContent,'Finish brew');
  assert.equal(p.elements.clock.textContent,'0:00');
});

test('uses the board clock and resumes at the right recipe cue after a connection gap', async () => {
  const p=app(); await scaleBrew(p);
  p.run('scale.session=7;scale.armed=true');
  feed(p,{g:30,timer_s:10,running:true,pour_mode:true,pour_id:7});
  assert.equal(p.elements.clock.textContent,'0:10');
  p.run("scaleError(new TypeError('offline'));tick()");
  assert.equal(p.elements.scaleWeight.textContent,'— g');
  assert.equal(p.elements.clock.textContent,'0:10');
  feed(p,{g:100,timer_s:55.9,running:true,pour_mode:true,pour_id:7});
  assert.equal(p.elements.clock.textContent,'0:55');
  assert.match(p.elements.scaleGuidance.textContent,/25g to go/);
  assert.equal(p.elements.waterLbl.textContent,'Water: 100.0g / 240g');
  assert.equal(p.elements.waterFill.style.width,'42%');
});

test('guides early target, overshoot and late pours without skipping missed targets', async () => {
  const p=app(); await scaleBrew(p); p.run('scale.session=7');
  feed(p,{g:30,timer_s:12,running:true,pour_mode:true,pour_id:7});
  assert.match(p.elements.scaleGuidance.textContent,/Target reached.*0:45 \(33s\)/);
  feed(p,{g:35,timer_s:15,running:true,pour_mode:true,pour_id:7});
  assert.match(p.elements.scaleGuidance.textContent,/5.0g over target/);
  feed(p,{g:20,timer_s:50,running:true,pour_mode:true,pour_id:7});
  assert.equal(p.elements.promptAction.textContent,'Pour to 30g');
  assert.match(p.elements.scaleGuidance.textContent,/10g to go.*behind schedule/);
  feed(p,{g:30,timer_s:52,running:true,pour_mode:true,pour_id:7});
  assert.equal(p.elements.promptAction.textContent,'Pour to 125g');
  assert.match(p.elements.scaleGuidance.textContent,/95g to go/);
});

test('all built-in and custom methods use measured cumulative water targets', async () => {
  for(const method of ['balanced','hoffmann','kasuya','custom']) {
    const p=app(); p.run(`settings.method='${method}'`); await scaleBrew(p); p.run('scale.session=7');
    const target=p.run('cues[0].water');
    feed(p,{g:target-5,timer_s:5,running:true,pour_mode:true,pour_id:7});
    assert.match(p.elements.scaleGuidance.textContent,/5g to go/);
    feed(p,{g:target,timer_s:10,running:true,pour_mode:true,pour_id:7});
    assert.match(p.elements.scaleGuidance.textContent,/Target reached/);
  }
});

test('recipe finish time does not stop a slow scale brew or discard its missing water', async () => {
  const p=app(); await scaleBrew(p); p.run('scale.session=7');
  feed(p,{g:200,timer_s:250,running:true,pour_mode:true,pour_id:7});
  assert.equal(p.run('finished'),false);
  assert.equal(p.elements.promptAction.textContent,'Pour to 240g');
  assert.match(p.elements.scaleGuidance.textContent,/40g to go/);
  assert.equal(p.elements.clock.textContent,'4:10');
});

test('a scale reset invalidates the session and requires deliberate rearming', async () => {
  const p=app(); await scaleBrew(p); p.run('scale.session=7;scale.armed=true');
  feed(p,{g:500,pour_mode:false,pour_id:8});
  assert.equal(p.run('scale.session'),null);
  assert.equal(p.run('started'),false);
  assert.match(p.elements.scaleGuidance.textContent,/reset/);
  assert.equal(p.elements.brewBtn.textContent,'Tare & arm');
});

test('finish/cancel ends the board session and settings also disarms an armed brew', async () => {
  const calls=[];
  const p=app(async (url,opts)=>{calls.push([url,opts.method]);return response({ok:true});});
  await scaleBrew(p);p.run('scale.session=7;scale.armed=true');
  await p.run('backToSettings()');
  assert.deepEqual(calls,[['http://192.168.1.60/api/pour/end','POST']]);
  assert.equal(p.run('scale.session'),null);
  assert.equal(p.run('scale.armed'),false);
});

test('a failed end retains the session so the user can retry without silently resetting it', async () => {
  const p=app(async ()=>{throw new TypeError('offline');}); await scaleBrew(p);p.run('scale.session=7;scale.armed=true');
  assert.equal(await p.run('endScaleBrew()'),false);
  assert.equal(p.run('scale.session'),7);
  assert.match(p.elements.scaleGuidance.textContent,/unreachable/);
});

test('a lost arm response recovers the new board session on the next reading', async () => {
  const p=app(async()=>{throw new TypeError('response lost');}); await scaleBrew(p);
  await p.run('handleBrewBtn()');
  assert.equal(p.run('scale.armPending'),1);
  feed(p,{g:5,timer_s:2,running:true,pour_mode:true,pour_id:2});
  assert.equal(p.run('scale.session'),2);
  assert.equal(p.run('scale.armPending'),null);
  assert.equal(p.run('started'),true);
  assert.equal(p.elements.clock.textContent,'0:02');
});

test('an arm request that never reached the scale requires another deliberate tap', async () => {
  const p=app(async()=>{throw new TypeError('offline');}); await scaleBrew(p);
  await p.run('handleBrewBtn()');feed(p,{});
  assert.equal(p.run('scale.session'),null);
  assert.equal(p.run('scale.armPending'),null);
  assert.equal(p.run('started'),false);
  assert.equal(p.elements.brewBtn.textContent,'Tare & arm');
});

test('a command waits for a poll instead of overlapping HTTP requests', async () => {
  let resolvePoll,active=0,maxActive=0;
  const p=app(async (url)=>{
    active++;maxActive=Math.max(maxActive,active);
    if(url.endsWith('/api/weight')) await new Promise(resolve=>{resolvePoll=resolve;});
    active--;return response(url.endsWith('/api/weight')?reading():{ok:true});
  });
  await scaleBrew(p);
  const poll=p.run('pollScale()');
  const command=p.run("scaleCommand('/api/pour/end')");
  assert.equal(active,1);resolvePoll();await Promise.all([poll,command]);
  assert.equal(maxActive,1);
});

test('a hung poll aborts, clears its busy guard and allows a later reading', async () => {
  let calls=0;
  const p=app(async (url,options)=>{
    if(++calls===1) return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('timeout'),{name:'AbortError'}))));
    return response(reading({g:12}));
  });await scaleBrew(p);
  const poll=p.run('pollScale()');await p.run('pollScale()');assert.equal(calls,1);
  p.timeout(3000);await poll;
  assert.equal(p.run('scale.pending'),null);assert.equal(p.run('scale.connected'),false);
  await p.run('pollScale()');assert.equal(p.run('scale.connected'),true);
  assert.equal(p.elements.scaleWeight.textContent,'12.0 g');
});

test('switching to manual discards an in-flight scale response', async () => {
  let resolve;
  const p=app(()=>new Promise(r=>{resolve=r;}));await scaleBrew(p);
  const poll=p.run('pollScale()');p.run("setBrewMode('manual')");
  resolve(response(reading({g:500})));await poll;
  assert.equal(p.run('scale.connected'),false);assert.equal(p.run('scale.data'),null);
});

test('manual mode still starts, pauses, resumes and finishes by time', async () => {
  const p=app();await p.run('startBrew();');p.run('getAudioCtx=()=>({})');await p.run('handleBrewBtn()');
  assert.equal(p.run('started'),true);
  p.run('handlePauseBtn()');assert.equal(p.run('paused'),true);
  p.run('handlePauseBtn()');assert.equal(p.run('paused'),false);
  p.run('startTs=Date.now()-211000;tick()');assert.equal(p.run('finished'),true);
  assert.equal(p.elements.brewBtn.textContent,'Brew again');
});

test('private-mode localStorage errors leave manual and scale controls usable', async () => {
  const p=app();p.run("localStorage.getItem=()=>{throw new Error('blocked')};localStorage.setItem=localStorage.getItem;loadSettings();saveSettings()");
  await scaleBrew(p);
  assert.equal(p.elements.brewBtn.textContent,'Tare & arm');
});
