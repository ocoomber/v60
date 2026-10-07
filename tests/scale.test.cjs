const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>\r?\n([\s\S]*?)<\/script>/)[1];
const reading = (overrides={}) => ({g:0,timer_s:0,running:false,cal:true,sensor_ok:true,pour_mode:false,pour_armed:false,pour_id:1,...overrides});
const response = data => ({ok:true,json:async()=>data});

function app(fetch = async () => response(reading()), saved=null) {
  const elements = {};
  const timeouts=new Map(); let timerId=0;
  for(const [,id] of html.matchAll(/id="([^"]+)"/g)) elements[id] = {
    textContent:'',innerHTML:'',value:'',style:{},className:'',disabled:false,
    classList:{add(){},remove(){},toggle(){}},
  };
  const context = vm.createContext({document:{
    getElementById:id=>elements[id],querySelectorAll:()=>[],addEventListener(){},visibilityState:'visible',
  }, localStorage:{getItem(){return saved ? JSON.stringify(saved) : null;},setItem(){}},
  fetch,AbortController,URL,Date,TypeError,TextDecoder,setTimeout(fn,ms){const id=++timerId;timeouts.set(id,{fn,ms});return id;},clearTimeout(id){timeouts.delete(id);},setInterval(){return 1;},clearInterval(){},
  NoSleep:class {async enable(){} disable(){}},window:{},navigator:{}});
  vm.runInContext(script,context);
  return {elements,run:code=>vm.runInContext(code,context),setBluetooth:api=>context.navigator.bluetooth=api,timeout:ms=>{
    for(const [id,t] of timeouts) if(t.ms===ms){timeouts.delete(id);t.fn();return;}
    throw new Error('No timeout for '+ms);
  }};
}

async function scaleBrew(p) {
  await p.run(`settings.brewMode='scale'; settings.scaleAddress='192.168.1.60'; scale.base='http://192.168.1.60'; scale.connected=true; scale.data=${JSON.stringify(reading())}; startBrew()`);
}

function feed(p, overrides) { p.run(`acceptScaleData(${JSON.stringify(reading(overrides))})`); }

test('accepts private WiFi IPs and the scale local name, rejects other destinations', () => {
  const p=app();
  for(const ip of ['192.168.1.60','10.24.3.87','172.16.0.2','172.31.4.8']) assert.equal(p.run(`scaleURL('${ip}')`),'http://'+ip);
  assert.equal(p.run("scaleURL('coffeescale.local')"),'http://coffeescale.local');
  for(const ip of ['8.8.8.8','172.32.0.1','127.0.0.1','other.local','https://192.168.1.60','http://x:y@192.168.1.60','http://192.168.1.60/api/weight']) assert.throws(()=>p.run(`scaleURL('${ip}')`));
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
  assert.match(p.elements.scaleGuidance.textContent,/Begin pouring/);
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
  assert.match(p.elements.scaleRemaining.textContent,/25g to go/);
  assert.equal(p.elements.waterLbl.textContent,'Water: 100.0g / 240g');
  assert.equal(p.elements.waterFill.style.width,'42%');
});

test('guides early target, overshoot and late pours without skipping missed targets', async () => {
  const p=app(); await scaleBrew(p); p.run('scale.session=7');
  feed(p,{g:30,timer_s:12,running:true,pour_mode:true,pour_id:7});
  assert.match(p.elements.scaleNextValue.textContent,/In 0:33.*125g/);
  feed(p,{g:35,timer_s:15,running:true,pour_mode:true,pour_id:7});
  assert.match(p.elements.scaleRemaining.textContent,/5.0g over target/);
  feed(p,{g:20,timer_s:50,running:true,pour_mode:true,pour_id:7});
  assert.equal(p.elements.promptAction.textContent,'Pour to 30g');
  assert.match(p.elements.scaleRemaining.textContent,/10g to go/);
  feed(p,{g:30,timer_s:52,running:true,pour_mode:true,pour_id:7});
  assert.equal(p.elements.promptAction.textContent,'Pour to 125g');
  assert.match(p.elements.scaleRemaining.textContent,/95g to go/);
});

test('all built-in and custom methods use measured cumulative water targets', async () => {
  for(const method of ['balanced','hoffmann','kasuya','custom']) {
    const p=app(); p.run(`settings.method='${method}'`); await scaleBrew(p); p.run('scale.session=7');
    const target=p.run('cues[0].water');
    feed(p,{g:target-5,timer_s:5,running:true,pour_mode:true,pour_id:7});
    assert.match(p.elements.scaleRemaining.textContent,/5g to go/);
    feed(p,{g:target,timer_s:10,running:true,pour_mode:true,pour_id:7});
    assert.match(p.elements.scaleRemaining.textContent,/Target reached/);
  }
});

test('visible instructions change from setup to pouring, waiting and the next pour', async () => {
  const p=app();await scaleBrew(p);
  assert.equal(p.elements.scaleAction.textContent,'Set up your V60');
  assert.match(p.elements.scaleCoffeeStep.textContent,/15g/);
  assert.equal(p.elements.scaleMeasurements.style.display,'none');
  p.run('scale.session=7;scale.armed=true');
  feed(p,{pour_mode:true,pour_armed:true,pour_id:7});
  assert.equal(p.elements.scaleAction.textContent,'Start pouring');
  assert.equal(p.elements.scaleTarget.textContent,'30 g');
  feed(p,{g:20,timer_s:10,running:true,pour_mode:true,pour_id:7});
  assert.equal(p.elements.scaleAction.textContent,'Keep pouring');
  assert.equal(p.elements.scaleRemaining.textContent,'10g to go');
  feed(p,{g:30,timer_s:12,running:true,pour_mode:true,pour_id:7});
  assert.equal(p.elements.scaleAction.textContent,'Stop pouring');
  assert.equal(p.elements.scaleTargetLabel.textContent,'Target reached');
  assert.equal(p.elements.scaleNextValue.textContent,'In 0:33 · pour to 125g');
  feed(p,{g:30,timer_s:45,running:true,pour_mode:true,pour_id:7});
  assert.equal(p.elements.scaleAction.textContent,'Keep pouring');
  assert.equal(p.elements.scaleTarget.textContent,'125 g');
  assert.equal(p.elements.scaleClock.textContent,'0:45');
});

test('late pours keep their target and never ask the user to wait for a time already passed', async () => {
  const p=app();await scaleBrew(p);p.run('scale.session=7');
  feed(p,{g:20,timer_s:100,running:true,pour_mode:true,pour_id:7});
  assert.equal(p.elements.scaleTarget.textContent,'30 g');
  assert.equal(p.elements.scaleAction.textContent,'Keep pouring');
  assert.match(p.elements.scaleGuidance.textContent,/Finish this pour/);
  assert.equal(p.elements.scaleNextValue.textContent,'Then pour to 125g.');
});

test('final water starts drawdown, and only the user finishing completes the brew', async () => {
  const p=app();await scaleBrew(p);p.run('scale.session=7');
  feed(p,{g:240,timer_s:120,running:true,pour_mode:true,pour_id:7});
  assert.equal(p.elements.scaleAction.textContent,'Let it drain');
  assert.match(p.elements.scaleGuidance.textContent,/Finish brew when/);
  feed(p,{g:240,timer_s:250,running:true,pour_mode:true,pour_id:7});
  assert.equal(p.elements.scaleAction.textContent,'Let it drain');
  assert.equal(p.run('finished'),false);
  await p.run('endScaleBrew()');
  assert.equal(p.elements.scaleAction.textContent,'Enjoy your coffee');
  assert.equal(p.elements.scaleClock.textContent,'4:10');
});

test('cancelling before the first pour reports cancellation and can prepare a fresh brew', async () => {
  const p=app();await scaleBrew(p);p.run('scale.session=7;scale.armed=true');
  await p.run('endScaleBrew()');
  assert.equal(p.elements.scaleStage.textContent,'Brew cancelled');
  assert.equal(p.elements.scaleAction.textContent,'Ready when you are');
  assert.equal(p.elements.brewBtn.textContent,'Brew again');
  await p.run('startBrew()');
  assert.equal(p.elements.scaleAction.textContent,'Set up your V60');
  assert.equal(p.run('scale.cancelled'),false);
});

test('Hoffmann keeps its timed stir and swirl between pouring and drawdown', async () => {
  const p=app();p.run("settings.method='hoffmann'");await scaleBrew(p);p.run('scale.session=7');
  const total=p.run('totalWater()');
  feed(p,{g:total,timer_s:90,running:true,pour_mode:true,pour_id:7});
  assert.equal(p.elements.scaleAction.textContent,'Let it drain');
  assert.equal(p.elements.scaleNextValue.textContent,'In 0:15 · Stir, then swirl');
  feed(p,{g:total,timer_s:105,running:true,pour_mode:true,pour_id:7});
  assert.equal(p.elements.scaleAction.textContent,'Stir, then swirl');
  feed(p,{g:total,timer_s:195,running:true,pour_mode:true,pour_id:7});
  assert.equal(p.elements.scaleAction.textContent,'Let it drain');
});

test('disconnection replaces the pour instruction and countdown, then resumes with fresh readings', async () => {
  const p=app();await scaleBrew(p);p.run('scale.session=7');
  feed(p,{g:20,timer_s:10,running:true,pour_mode:true,pour_id:7});
  p.run("scaleError(new TypeError('offline'))");
  assert.equal(p.elements.scaleAction.textContent,'Stop pouring');
  assert.equal(p.elements.scaleClock.textContent,'—');
  assert.equal(p.elements.scaleWeight.textContent,'— g');
  assert.match(p.elements.scaleNextValue.textContent,/reconnects/);
  feed(p,{g:30,timer_s:20,running:true,pour_mode:true,pour_id:7});
  assert.equal(p.elements.scaleNextValue.textContent,'In 0:25 · pour to 125g');
  assert.equal(p.elements.scaleClock.textContent,'0:20');
});

test('recipe finish time does not stop a slow scale brew or discard its missing water', async () => {
  const p=app(); await scaleBrew(p); p.run('scale.session=7');
  feed(p,{g:200,timer_s:250,running:true,pour_mode:true,pour_id:7});
  assert.equal(p.run('finished'),false);
  assert.equal(p.elements.promptAction.textContent,'Pour to 240g');
  assert.match(p.elements.scaleRemaining.textContent,/40g to go/);
  assert.equal(p.elements.clock.textContent,'4:10');
});

test('a scale reset invalidates the session and requires deliberate rearming', async () => {
  const p=app(); await scaleBrew(p); p.run('scale.session=7;scale.armed=true');
  feed(p,{g:500,pour_mode:false,pour_id:8});
  assert.equal(p.run('scale.session'),null);
  assert.equal(p.run('started'),false);
  assert.match(p.elements.scaleGuidance.textContent,/reset/);
  assert.equal(p.elements.brewBtn.textContent,'Zero scale & get ready');
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
  assert.match(p.elements.scaleGuidance.textContent,/Waiting for CoffeeScale/);
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
  assert.equal(p.elements.brewBtn.textContent,'Zero scale & get ready');
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
  assert.equal(p.elements.brewBtn.textContent,'Zero scale & get ready');
});

const pairedId='aabbccddeeff';
const pairing = (overrides={}) => ({ip:'10.24.3.87',host:'coffeescale.local',id:pairedId,...overrides});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function bluetoothDevice(data) {
  let disconnects=0;
  const bytes=new TextEncoder().encode(JSON.stringify(data));
  return {name:'CoffeeScale',get disconnects(){return disconnects;},gatt:{
    async connect(){return {async getPrimaryService(uuid){
      assert.equal(uuid,'72cf0001-5dc4-4a38-8f16-7b63ad328a20');
      return {async getCharacteristic(uuid){
        assert.equal(uuid,'72cf0002-5dc4-4a38-8f16-7b63ad328a20');
        return {async readValue(){return new DataView(bytes.buffer);}};
      }};
    }};},disconnect(){disconnects++;},
  }};
}

test('Find scale pairs once, learns the address, disconnects Bluetooth and uses WiFi', async () => {
  const calls=[];const device=bluetoothDevice(pairing());let pickers=0;
  const p=app(async(url)=>{calls.push(url);return response(reading({device_id:pairedId,ip:'10.24.3.87'}));});
  p.setBluetooth({async requestDevice(options){pickers++;assert.equal(options.filters[0].services[0],'72cf0001-5dc4-4a38-8f16-7b63ad328a20');return device;}});
  await p.run('findScale()');
  assert.equal(pickers,1);assert.equal(device.disconnects,1);
  assert.equal(p.run('settings.scaleId'),pairedId);assert.equal(p.run('settings.scaleAddress'),'10.24.3.87');
  assert.equal(p.run('settings.brewMode'),'scale');assert.equal(p.run('scale.connected'),true);
  assert.deepEqual(calls,['http://10.24.3.87/api/weight']);
  await p.run('pollScale()');assert.equal(pickers,1,'weight polling does not reopen Bluetooth');
});

test('opening a paired app automatically reconnects over WiFi without a Bluetooth picker', async () => {
  let calls=0,pickers=0;
  const p=app(async url=>{calls++;assert.equal(url,'http://10.24.3.87/api/weight');return response(reading({device_id:pairedId}));},
    {brewMode:'scale',scaleAddress:'10.24.3.87',scaleId:pairedId});
  p.setBluetooth({requestDevice(){pickers++;throw new Error('must not use Bluetooth');}});
  await flush();assert.equal(calls,1);assert.equal(pickers,0);assert.equal(p.run('scale.connected'),true);
});

test('an offline scale reconnects by local name after DHCP changes, without Bluetooth', async () => {
  const calls=[];let pickers=0;
  const p=app(async url=>{
    calls.push(url);
    if(calls.length===1) throw new TypeError('off');
    return response(reading({device_id:pairedId,ip:'10.24.3.99',g:8}));
  },{brewMode:'scale',scaleAddress:'10.24.3.87',scaleId:pairedId});
  p.setBluetooth({requestDevice(){pickers++;throw new Error('must not use Bluetooth');}});
  await flush();assert.equal(p.run('scale.connected'),false);
  await p.run('pollScale()');
  assert.deepEqual(calls,['http://10.24.3.87/api/weight','http://coffeescale.local/api/weight']);
  assert.equal(p.run('settings.scaleAddress'),'10.24.3.99');assert.equal(p.run('scale.base'),'http://10.24.3.99');
  assert.equal(p.run('scale.connected'),true);assert.equal(pickers,0);
});

test('a different scale at the old IP cannot supply readings for the paired scale', async () => {
  const p=app(async()=>response(reading({device_id:'112233445566',g:500})),
    {brewMode:'scale',scaleAddress:'10.24.3.87',scaleId:pairedId});
  await flush();assert.equal(p.run('scale.connected'),false);assert.equal(p.run('scale.data'),null);
  assert.match(p.elements.scaleStatus.textContent,/different scale/);
  assert.equal(p.elements.scaleWeight.textContent,'— g');
});

test('cancelled pairing leaves the saved scale unchanged and resumes WiFi polling', async () => {
  const p=app();p.run("settings.scaleAddress='192.168.1.60';settings.scaleId='aabbccddeeff'");
  p.setBluetooth({async requestDevice(){throw Object.assign(new Error('cancel'),{name:'NotFoundError'});}});
  await p.run('findScale()');
  assert.equal(p.run('settings.scaleAddress'),'192.168.1.60');assert.equal(p.run('settings.scaleId'),pairedId);
  assert.equal(p.elements.scaleFindBtn.disabled,false);assert.equal(p.run('scale.finding'),false);
  assert.match(p.elements.scaleStatus.textContent,/cancelled/);
});

test('a found scale without router WiFi gives a setup message instead of saving a zero address', async () => {
  const p=app();const device=bluetoothDevice(pairing({ip:'0.0.0.0'}));
  p.setBluetooth({async requestDevice(){return device;}});await p.run('findScale()');
  assert.equal(p.run('settings.scaleAddress'),'');assert.equal(device.disconnects,1);
  assert.match(p.elements.scaleStatus.textContent,/CoffeeScale-Setup/);
});

test('a hung Bluetooth connection times out and releases the discovery controls', async () => {
  const p=app();let disconnects=0;
  p.setBluetooth({async requestDevice(){return {gatt:{connect:()=>new Promise(()=>{}),disconnect(){disconnects++;}}};}});
  const finding=p.run('findScale()');await flush();p.timeout(10000);await finding;
  assert.match(p.elements.scaleStatus.textContent,/timed out/);assert.equal(p.run('scale.finding'),false);
  assert.equal(p.elements.scaleFindBtn.disabled,false);assert.ok(disconnects>=1);
});

test('Find scale reports unsupported browsers without changing a working WiFi connection', async () => {
  const p=app();await scaleBrew(p);await p.run('findScale()');
  assert.match(p.elements.scaleStatus.textContent,/Chrome on Android/);assert.equal(p.run('scale.connected'),true);
});
