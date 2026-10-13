import test from 'node:test';
import assert from 'node:assert/strict';
import {FacebookVerifier} from '../src/publishing/facebook-verify.js';
test('Facebook receipt reads grid names and bounds in one snapshot without stale element IDs',async()=>{
 const d=new FacebookVerifier('http://unused',new AbortController().signal) as any;
 const taps:string[]=[];d.session='/session/test';d.start=async()=>{};d.sleep=async()=>{};d.waitFor=async()=> 'ok';
 d.visible=async()=> 'visible';d.tapElement=async(_using:string,value:string)=>{taps.push(value);};
 d.read=async(_using:string,value:string)=>value==='navigation_bar_picker_title'?'Antonio Revenue, Page':'Exact full caption';
 d.request=async(route:string,body:any)=>{
  if(route==='/session/test/url'){assert.deepEqual(body,{url:'https://www.facebook.com/profile.php?id=61584693917444'});taps.push('exact-page-url');return{value:null};}
  if(route.endsWith('/appium/settings'))return{value:null};
  if(route.endsWith('/wda/dragfromtoforduration'))return{value:null};
  if(route==='/session/test/element/visible/attribute/label')return {value:'Antonio Revenue, Page'};
  assert.equal(route,'/session/test/source');
  return {value:'<XCUIElementTypeButton type="XCUIElementTypeButton" visible="true" name="shorts-aggregation-video-component-1" x="143" y="200" width="143" height="254"/><XCUIElementTypeButton type="XCUIElementTypeButton" visible="true" name="shorts-aggregation-video-component-2" x="287" y="800" width="143" height="254"/>'};
 };
 const receipt=await d.verifyPost({caption:'Exact full caption',targets:[{platform:'facebook',account:'https://www.facebook.com/profile.php?id=61584693917444'}]},true);
 assert.equal(receipt.verified,true);assert.equal(receipt.source,'facebook_app');
 assert.deepEqual(taps,['exact-page-url','Reels','shorts-aggregation-video-component-1']);
});

test('Facebook waits for the caption row to settle before touching More',async()=>{
 const d=new FacebookVerifier('http://unused',new AbortController().signal)as any;let reads=0;let touched:number[]=[];
 d.rect=async()=>({x:12,y:reads++?770:730,width:362,height:19});d.sleep=async()=>{};d.tapPoint=async(x:number,y:number)=>{touched=[x,y];};
 await d.tapElement('accessibility id','fbreels-description-collapse','More');assert.equal(reads,2);assert.deepEqual(touched,[12+362*.95,779.5]);
});

test('Facebook cover match picks one clear tile or none',async()=>{
 const {uniqueTile}=await import('../src/publishing/facebook-match.js');
 assert.equal(uniqueTile([{name:'a',score:.02},{name:'b',score:.2}])?.name,'a');
 assert.equal(uniqueTile([{name:'a',score:.02},{name:'b',score:.04}]),null);
 assert.equal(uniqueTile([{name:'a',score:.3}]),null);
 assert.equal(uniqueTile([]),null);
});

test('Facebook opens the receipt link first and never touches the Page grid when the caption matches',async()=>{
 const d=new FacebookVerifier('http://unused',new AbortController().signal) as any;
 const urls:string[]=[];const taps:string[]=[];d.session='/session/test';d.start=async()=>{};d.sleep=async()=>{};d.waitFor=async()=> 'ok';
 d.visible=async(_u:string,v:string)=>v==='fbreels-description-expand'?'expanded':null;d.tapElement=async(_u:string,v:string)=>{taps.push(v);};
 d.read=async()=> 'Exact full caption';
 d.request=async(route:string,body:any)=>{if(route==='/session/test/url')urls.push(body.url);return {value:route.endsWith('/source')?'':null};};
 const input={caption:'Exact full caption',targets:[{platform:'facebook',account:'https://www.facebook.com/profile.php?id=61584693917444'}]};
 const receipt=await d.verifyPost(input,true,false,'https://www.facebook.com/reel/1085849050989750/');
 assert.equal(receipt.verified,true);assert.deepEqual(urls,['https://www.facebook.com/reel/1085849050989750/']);assert.deepEqual(taps,[]);
 d.read=async()=> 'Another caption';urls.length=0;
 await assert.rejects(d.verifyPost(input,true,false,'https://www.facebook.com/reel/1085849050989750/'),/link: Facebook Reel opened by link has a different caption/);
 assert.equal(urls[1],'https://www.facebook.com/profile.php?id=61584693917444');
 await assert.rejects(d.verifyPost(input,true,false,'https://evil.example/reel/1/'),/link: Facebook receipt link is not a Reel link/);
});

test('Facebook comments wait for the list and never type on a Reel that already has comments',async()=>{
 const {FacebookComments}=await import('../src/publishing/facebook-comments.js');
 const make=(count:string,ownAfter:number)=>{const d=new FacebookComments('http://unused',new AbortController().signal) as any;const routes:string[]=[];let polls=0;
  d.verifyPost=async()=>({verified:true});d.read=async()=>count;d.tapElement=async()=>{};d.waitFor=async()=> 'box';d.sleep=async()=>{};d.visible=async()=>null;
  d.ownComment=async()=>++polls>=ownAfter?{x:60,y:400,width:300,height:40}:null;d.request=async(route:string)=>{routes.push(route);return {value:null};};
  d.tapPoint=async()=>{throw new Error('stop after finding own comment');};return {d,routes,get polls(){return polls;}};};
 const late=make('Comment, 1 comments',3);
 await assert.rejects(late.d.commentOnPost({},'Hi',async()=>{},true),/stop after finding own comment/);assert.equal(late.polls,3);
 const others=make('Comment, 2 comments',99);
 await assert.rejects(others.d.commentOnPost({},'Hi',async()=>{assert.fail('claimed');}),/not typed/);
 assert.equal(others.routes.some(r=>r.endsWith('/wda/keys')),false);
});
