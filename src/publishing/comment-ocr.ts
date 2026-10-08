export interface ScreenWord {text:string;x:number;y:number;width:number;height:number}
const token=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
/** Full word sequence in a bounded region. Only the known AI/Al OCR confusion is allowed. */
export function locateComment(words:ScreenWord[],text:string,minY:number,maxY:number) {
 const expected=text.split(/\s+/).map(token).filter(Boolean);
 const candidates=words.filter(w=>w.y>=minY&&w.y<=maxY&&w.x>=150&&token(w.text));
 for(let i=0;i<=candidates.length-expected.length;i++) {
  // OCR reads a capital I after A as a lowercase l, also inside words ("Al-built", Oct 7): read "Al" not followed by a lowercase letter as "AI".
  if(expected.every((t,n)=>token(candidates[i+n].text)===t || token(candidates[i+n].text.replace(/Al(?![a-z])/g,'AI'))===t))return candidates.slice(i,i+expected.length);
 }
 return null;
}
