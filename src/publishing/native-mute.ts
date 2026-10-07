import {WdaApp} from './wda-app.js';
/** Empty Control Center background below every visible control. On iOS 27 a tap there closes it; Home and edge swipes did not. */
export function controlCenterBlankPoint(xml:string){
 let bottom=0,screenW=430,screenH=932;
 for(const m of xml.matchAll(/<XCUIElementType\w+\b[^>]*>/g)){
  const a=Object.fromEntries([...m[0].matchAll(/(\w+)="([^"]*)"/g)].map(v=>[v[1],v[2]]));
  const y=Number(a.y),w=Number(a.width),h=Number(a.height);
  if(a.type==='XCUIElementTypeApplication'&&w>0&&h>0){screenW=w;screenH=h;}
  if(a.visible!=='true'||!Number.isFinite(y+w+h)||w>=screenW*0.9)continue;
  bottom=Math.max(bottom,y+h);
 }
 const floor=screenH-32;// keep clear of the home indicator
 if(!bottom||floor-bottom<60)throw Error('No empty Control Center area to tap; no app playback allowed');
 return{x:Math.round(screenW/2),y:Math.round((bottom+floor)/2)};
}
/** Caller holds the phone advisory lock. Never changes Mac or meeting audio. */
export class NativeMuteGuard extends WdaApp {
 private checkedAt=0;
 async prepare(options:{preserveForeground?:boolean}={}){
  if((await this.request('/wda/locked')).value!==false)throw Error('Unlock the iPhone before checking media volume');
  const id=(await this.request('/status')).sessionId;
  if(id)this.session='/session/'+id;
  else {if(options.preserveForeground)throw Error('Cannot preserve the composer without an active native session');await this.start('com.apple.springboard');}
  await this.request(this.session+'/appium/settings',{settings:{defaultActiveApplication:'com.apple.springboard',waitForIdleTimeout:0,animationCoolOffTimeout:0,snapshotMaxDepth:20}});
  if(!options.preserveForeground)await this.request('/wda/homescreen',{});await this.sleep(600);
  const initial=String((await this.request(this.session+'/source')).value);
  if(!initial.includes('Add Controls')||!initial.includes('Power'))await this.request('/wda/absolute-actions',{actions:[{type:'pointer',id:'mute-check',parameters:{pointerType:'touch'},actions:[{type:'pointerMove',duration:0,x:415,y:5,origin:'viewport'},{type:'pointerDown',button:0},{type:'pointerMove',duration:350,x:415,y:280,origin:'viewport'},{type:'pointerUp',button:0}]}]});
  await this.sleep(500);
  try{
   let xml='';
   for(let read=0;read<3;read++){xml=String((await this.request(this.session+'/source')).value);if(xml.includes('Add Controls')&&xml.includes('Power'))break;await this.sleep(500);}
   if(!xml.includes('Add Controls')||!xml.includes('Power'))throw Error('Control Center did not open; no volume change sent');
   const tags=[...xml.matchAll(/<XCUIElementType\w+\b[^>]*>/g)].map(m=>Object.fromEntries([...m[0].matchAll(/(\w+)="([^"]*)"/g)].map(a=>[a[1],a[2]])));
   const volumes=tags.filter(a=>a.visible==='true'&&(a.name==='cc-volume-slider'||a.type==='XCUIElementTypeSlider'&&a.name==='Volume'));
   if(volumes.length!==1)throw Error('The media volume control is missing or ambiguous');
   if(volumes[0]!.value!=='0%'){
    const rows=(await this.request(this.session+'/elements',{using:'accessibility id',value:volumes[0]!.name})).value;
    if(rows.length!==1)throw Error('The media volume control is ambiguous');
    const row=this.id(rows[0]),rect=(await this.request(this.session+'/element/'+row+'/rect')).value;
    if(rect.x<20||rect.x+rect.width>431||rect.y<120||rect.y+rect.height>800)throw Error('Media volume control moved; no volume adjustment sent');
    await this.request(this.session+'/element/'+row+'/value',{value:['0']});
    if(String((await this.request(this.session+'/element/'+row+'/attribute/value')).value)!=='0%')throw Error('Native media volume is not zero');
   }
   this.checkedAt=Date.now();
  }finally{
   // Tap empty background. The top status area can open Privacy; Home and the home-indicator swipe leave it open.
   const overlay=String((await this.request(this.session+'/source')).value);
   if(overlay.includes('Add Controls')&&overlay.includes('Power')){
    const blank=controlCenterBlankPoint(overlay);
    await this.request('/wda/absolute-actions',{actions:[{type:'pointer',id:'mute-dismiss',parameters:{pointerType:'touch'},actions:[{type:'pointerMove',duration:0,x:blank.x,y:blank.y,origin:'viewport'},{type:'pointerDown',button:0},{type:'pause',duration:80},{type:'pointerUp',button:0}]}]});
    await this.request(this.session+'/appium/settings',{settings:{defaultActiveApplication:'auto'}});
    let closed=false;for(let n=0;n<3;n++){await this.sleep(800);if(!String((await this.request(this.session+'/source')).value).includes('Add Controls')){closed=true;break;}}
    if(!closed)throw Error('Control Center did not close; no app playback allowed');
   }
   await this.request(this.session+'/appium/settings',{settings:{defaultActiveApplication:'auto'}});
   if(!options.preserveForeground)await this.request('/wda/homescreen',{});
  }
 }
 async verify(){if(!this.checkedAt||Date.now()-this.checkedAt>10*60000)throw Error('Fresh native zero-volume check is required');if((await this.request('/wda/locked')).value!==false)throw Error('The iPhone locked; no Story input sent');}
}
