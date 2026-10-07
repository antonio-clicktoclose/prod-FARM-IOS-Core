import test from'node:test';import assert from'node:assert/strict';import{NativeMuteGuard}from'../src/publishing/native-mute.js';
test('native mute guard cannot admit playback from an old or missing check',async()=>{const d=new NativeMuteGuard('http://unused',new AbortController().signal)as any;d.request=async()=>({value:false});await assert.rejects(d.verify(),/Fresh/);d.checkedAt=Date.now()-11*60000;await assert.rejects(d.verify(),/Fresh/);d.checkedAt=Date.now();await d.verify();d.request=async()=>({value:true});await assert.rejects(d.verify(),/locked/);});
test('native volume check reads zero without changing the volume or locking the phone',async()=>{const d=new NativeMuteGuard('http://unused',new AbortController().signal)as any;const routes:string[]=[];let dismiss=false;d.sleep=async()=>{};d.request=async(p:string)=>{routes.push(p);if(p==='/wda/locked')return{value:false};if(p==='/status')return{sessionId:'synthetic'};if(p==='/wda/absolute-actions'&&routes.filter(p=>p==='/wda/absolute-actions').length===1)dismiss=true;if(p.endsWith('/source'))return{value:dismiss?'Home':'<XCUIElementTypeOther type="XCUIElementTypeOther" name="cc-volume-slider" visible="true" value="0%"/> Add Controls Power'};if(p.endsWith('/elements'))return{value:[{ELEMENT:'volume'}]};if(p.endsWith('/rect'))return{value:{x:280,y:300,width:145,height:150}};if(p.endsWith('/attribute/value'))return{value:'0%'};return{value:null};};await d.prepare();await d.verify();assert.ok(!routes.some(p=>p.endsWith('/value')&&!p.endsWith('/attribute/value')));assert.ok(!routes.includes('/wda/lock'));assert.equal(routes.at(-2),'/wda/homescreen');});
test('mute check creates a safe SpringBoard session after WDA restarts',async()=>{
 const d=new NativeMuteGuard('http://unused',new AbortController().signal)as any;
 let started='',dismiss=false;d.sleep=async()=>{};
 d.start=async(bundle:string)=>{started=bundle;d.session='/session/fresh';};
 d.request=async(p:string)=>{
  if(p==='/wda/locked')return{value:false};if(p==='/status')return{sessionId:null};
  if(p==='/wda/absolute-actions')dismiss=true;
  if(p.endsWith('/source'))return{value:dismiss?'Home':'<XCUIElementTypeOther type="XCUIElementTypeOther" name="cc-volume-slider" visible="true" value="0%"/> Add Controls Power'};
  return{value:null};
 };
 await d.prepare();await d.verify();assert.equal(started,'com.apple.springboard');
});

test('preserving a composer checks volume without sending Home',async()=>{
 const d=new NativeMuteGuard('http://unused',new AbortController().signal)as any;const routes:string[]=[];let dismissed=false;d.sleep=async()=>{};
 d.request=async(p:string)=>{routes.push(p);if(p==='/wda/locked')return{value:false};if(p==='/status')return{sessionId:'existing'};if(p==='/wda/absolute-actions')dismissed=true;if(p.endsWith('/source'))return{value:dismissed?'Composer':'<XCUIElementTypeOther type="XCUIElementTypeOther" name="cc-volume-slider" visible="true" value="0%"/> Add Controls Power'};return{value:null};};
 await d.prepare({preserveForeground:true});await d.verify();assert.ok(!routes.includes('/wda/homescreen'));
 d.request=async(p:string)=>p==='/wda/locked'?{value:false}:{sessionId:null};await assert.rejects(d.prepare({preserveForeground:true}),/active native session/);
});

test('Control Center dismissal avoids the privacy indicator',async()=>{
 const d=new NativeMuteGuard('http://unused',new AbortController().signal)as any;let dismissed=false;let action:any;d.sleep=async()=>{};
 d.request=async(p:string,b:any)=>{if(p==='/wda/locked')return{value:false};if(p==='/status')return{sessionId:'existing'};if(p==='/wda/absolute-actions'){action=b.actions[0].actions;dismissed=true;}if(p.endsWith('/source'))return{value:dismissed?'Composer':'<XCUIElementTypeOther type="XCUIElementTypeOther" name="cc-volume-slider" visible="true" value="0%"/> Add Controls Power'};return{value:null};};
 await d.prepare({preserveForeground:true});assert.equal(action[0].y,925);assert.equal(action[2].type,'pointerMove');assert.equal(action[2].y,500);
});
