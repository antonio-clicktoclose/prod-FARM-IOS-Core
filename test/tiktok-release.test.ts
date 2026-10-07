import test from 'node:test';import assert from 'node:assert/strict';
import {matchesTikTokPost} from '../src/publishing/tiktok-release.js';
test('TikTok receipt matches the full published caption, not a draft or prefix',()=>{
 const caption='First paragraph.\n\nComment EDIT.\n\n#video';
 assert.equal(matchesTikTokPost('First paragraph. Comment EDIT. #video. Video. 0 views.',caption),true);
 assert.equal(matchesTikTokPost('First paragraph. Comment OTHER. #video. Video. 0 views.',caption),false);
 assert.equal(matchesTikTokPost('Drafts: '+caption,caption),false);
 assert.equal(matchesTikTokPost('First paragraph. Video. 0 views.',caption),false);
});

test('an uncertain TikTok Post response cannot trigger a second tap',async()=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');
 const driver=new TikTokRelease('http://unused',new AbortController().signal) as any;
 let taps=0;
 driver.prepared=true;
 driver.waitFor=async()=> 'post-button';
 driver.assertInputApp=async()=>{};
 driver.request=async()=>{taps++;throw new Error('Lost response after Post');};
 await assert.rejects(driver.shareOnce(),/Lost response/);
 await assert.rejects(driver.shareOnce(),/preflight is required/);
 assert.equal(taps,1);
});

test('TikTok publication checks open the profile once while waiting for a receipt',async()=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');
 const driver=new TikTokRelease('http://unused',new AbortController().signal) as any;
 let profileVisits=0,reads=0;
 driver.input={targets:[{platform:'tiktok',account:'antoniorevenue'}]};
 driver.profile=async()=>{profileVisits++;};
 driver.matchingPost=async()=>++reads===3?'published-video':null;
 driver.sleep=async()=>{};
 const receipt=await driver.verify();
 assert.equal(profileVisits,1);assert.equal(reads,3);
 assert.equal(receipt.tiktok.verified,true);
});

test('TikTok account transition waits without repeating profile taps',async()=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');
 const driver=new TikTokRelease('http://unused',new AbortController().signal) as any;
 driver.input={targets:[{platform:'tiktok',account:'antoniorevenue'}]};
 const taps:string[]=[];let reads=0;
 driver.depth=async()=>{};driver.sleep=async()=>{};
 driver.tapElement=async(_using:string,name:string)=>{taps.push(name);};
 driver.read=async()=>++reads===1?'':'@antoniorevenue';
 await driver.profile();
 assert.equal(reads,2);
 assert.deepEqual(taps,['a11y_vo_profile','profile_tab_public_post']);
});

test('TikTok reveals the exact offscreen album once without blind page swipes',async()=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');
 const driver=new TikTokRelease('http://unused',new AbortController().signal) as any;
 driver.session='/session/test';driver.depth=async()=>{};const calls:string[]=[];
 driver.request=async(route:string)=>{calls.push(route);return {value:route.endsWith('/elements')?[{ELEMENT:'exact-album'}]:false};};
 driver.rect=async()=>({x:100,y:660,width:310,height:18});
 await driver.revealAlbum('PF-reviewed-hash');
 assert.equal(calls.filter(r=>r.endsWith('/scrollTo')).length,1);
 assert.ok(calls.includes('/session/test/wda/element/exact-album/scrollTo'));
});
test('TikTok stops on ambiguous albums or unsafe album bounds',async()=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');
 const driver=new TikTokRelease('http://unused',new AbortController().signal) as any;
 driver.depth=async()=>{};driver.request=async()=>({value:[{ELEMENT:'one'},{ELEMENT:'two'}]});
 await assert.rejects(driver.revealAlbum('PF-hash'),/ambiguous/);
 driver.request=async(route:string)=>({value:route.endsWith('/elements')?[{ELEMENT:'one'}]:true});
 driver.rect=async()=>({x:100,y:900,width:310,height:18});
 await assert.rejects(driver.revealAlbum('PF-hash'),/outside/);
});

test('TikTok comment navigation taps the exact matched bounds once and stops on an uncertain viewer',async()=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');
 const d=new TikTokRelease('http://unused',new AbortController().signal) as any;
 d.session='/session/test';d.depth=async()=>{};d.sleep=async()=>{};d.matchingPost=async()=>'exact-post';
 let taps=0;d.request=async()=>({value:{x:0,y:300,width:143,height:200}});
 d.tapPoint=async(x:number,y:number)=>{assert.equal(x,71.5);assert.equal(y,400);taps++};
 d.waitFor=async()=>{throw Error('Viewer missing')};
 await assert.rejects(d.openMatchedPost(),/Viewer missing/);assert.equal(taps,1);
 d.request=async()=>({value:{x:0,y:800,width:143,height:200}});
 await assert.rejects(d.openMatchedPost(),/outside/);assert.equal(taps,1);
});

test('TikTok sends no viewer touch when a profile refresh moves the matched tile',async()=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');const d=new TikTokRelease('http://unused',new AbortController().signal) as any;
 d.depth=async()=>{};d.sleep=async()=>{};d.matchingPost=async()=>'post';let reads=0,taps=0;
 d.request=async()=>({value:{x:143,y:++reads===1?375:410,width:144,height:190}});d.tapPoint=async()=>{taps++};
 await assert.rejects(d.openMatchedPost(),/moved/);assert.equal(taps,0);
});


test('TikTok waits for an album to appear using reads only, then reveals it once',async()=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');
 const d=new TikTokRelease('http://unused',new AbortController().signal) as any;
 d.session='/session/test';d.depth=async(n:number)=>{assert.equal(n,60)};let reads=0,waits=0,scrolls=0;
 d.sleep=async()=>{waits++};
 d.request=async(route:string)=>{
  if(route.endsWith('/elements'))return {value:++reads<3?[]:[{ELEMENT:'album'}]};
  if(route.endsWith('/displayed'))return {value:false};
  assert.ok(route.endsWith('/scrollTo'));scrolls++;return {value:null};
 };
 d.rect=async()=>({x:100,y:660,width:310,height:18});
 await d.revealAlbum('PF-reviewed');assert.equal(reads,3);assert.equal(waits,2);assert.equal(scrolls,1);
});

test('TikTok missing and ambiguous albums stop without any input or import',async()=>{
 const {TikTokRelease}=await import('../src/publishing/tiktok-release.js');
 const d=new TikTokRelease('http://unused',new AbortController().signal) as any;
 let reads=0;d.depth=async()=>{};d.sleep=async()=>{};
 d.request=async(route:string)=>{assert.ok(route.endsWith('/elements'));reads++;return {value:[]};};
 await assert.rejects(d.revealAlbum('PF-reviewed'),/missing: PF-reviewed .*0 matches after 3 reads/);assert.equal(reads,3);
 reads=0;d.request=async(route:string)=>{assert.ok(route.endsWith('/elements'));reads++;return {value:[{ELEMENT:'a'},{ELEMENT:'b'}]};};
 await assert.rejects(d.revealAlbum('PF-reviewed'),/ambiguous: PF-reviewed .*2 matches/);assert.equal(reads,1);
});
