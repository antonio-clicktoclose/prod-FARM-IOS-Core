import test from'node:test';import assert from'node:assert/strict';import{InstagramRelease}from'../src/publishing/instagram-release.js';
test('Instagram never falls back to newest media when its album is missing or ambiguous',async()=>{
 for(const rows of [[],[{ELEMENT:'a'},{ELEMENT:'b'}]]){
  const d:any=new InstagramRelease('http://unused',new AbortController().signal),touches:string[]=[];
  d.visible=async()=>null;d.tapElement=async()=>{touches.push('album-menu')};d.request=async()=>({value:rows});d.tapPoint=async()=>touches.push('video');
  await assert.rejects(d.selectUploadAlbum('PF-123456789abc'),/missing or ambiguous/);assert.deepEqual(touches,['album-menu','album-menu']);
 }
});
test('Instagram reveals one exact album and requires its selected header',async()=>{
 const d:any=new InstagramRelease('http://unused',new AbortController().signal),routes:string[]=[];let header='';
 d.visible=async()=>null;d.tapElement=async()=>{};d.tapPoint=async()=>{};d.waitFor=async(_u:string,q:string)=>{header=q};
 d.request=async(p:string)=>{routes.push(p);return{value:p.endsWith('/elements')?[{ELEMENT:'a'}]:p.endsWith('/displayed')?false:p.endsWith('/rect')?{x:0,y:150,width:430,height:60}:{}}};
 await d.selectUploadAlbum('PF-123456789abc');assert.equal(routes.filter(p=>p.endsWith('/scrollTo')).length,1);assert.match(header,/Gallery Selection, PF-123456789abc selected/);
});
