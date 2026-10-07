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
