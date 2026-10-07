import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import type {PostingInput} from './model.js';

export const reviewedRelatedReel = 'https://www.instagram.com/reel/Dd7K1yvCIgq/';
const reference = new URL('../../docs/evidence/hourly-recovery-2026-10-05/chatcut-b-ig/related-picker-reference.png',import.meta.url);

/** Identify the reviewed cover, even after a new Reel shifts the grid. Never select by rank alone. */
export function uniqueCoverMatch(scores:number[]) {
    const ranked=scores.map((score,index)=>({score,index})).sort((a,b)=>a.score-b.score);
    if(!ranked[0]||!Number.isFinite(ranked[0].score)||ranked[0].score>.045
       ||ranked[1]&&ranked[1].score-ranked[0].score<.035)
        throw Error('Related Reel cover is missing or ambiguous; no Reel selected');
    return ranked[0].index;
}
export async function locateRelatedCover(png:Buffer,related:NonNullable<PostingInput['instagramRelatedReel']>) {
    if(related.url!==reviewedRelatedReel)throw Error('This related Reel needs its own reviewed cover reference');
    const meta=await sharp(png).metadata();
    if(meta.width!==1290||meta.height!==2796)throw Error('Related Reel screen size changed');
    const crop=(bytes:Buffer,left:number,top:number)=>sharp(bytes).extract({left,top,width:420,height:610}).resize(32,48).removeAlpha().raw().toBuffer();
    const target=await crop(await readFile(reference),0,402);
    const positions=[0,1,2].flatMap(row=>[0,1,2].map(col=>({left:col*430,top:402+row*760})));
    const scores=[];
    for(const p of positions){
        const bytes=await crop(png,p.left,p.top);let total=0;
        for(let i=0;i<target.length;i++)total+=Math.abs(target[i]!-bytes[i]!);
        scores.push(total/(target.length*255));
    }
    const index=uniqueCoverMatch(scores),p=positions[index]!;
    return {x:(p.left+210)/3,y:(p.top+290)/3,difference:scores[index]};
}
