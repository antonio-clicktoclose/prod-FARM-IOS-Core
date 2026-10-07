import sharp from 'sharp';
import {FacebookVerifier} from './facebook-verify.js';
import {recognizeWords} from '../tiktok/ocr.js';
import type {PostingInput} from './model.js';
import type {CommentResult} from './post-comments.js';
const q=(s:string)=>s.replace(/\\/g,'\\\\').replace(/"/g,'\\"');

/** Comments only. This driver never opens post settings or AI label controls. */
export class FacebookComments extends FacebookVerifier {
    async leaveVideo(){await this.exitApp('com.facebook.Facebook');}
    private async menuWords(){
        await this.waitFor('accessibility id','fds-glimpse-preview','Own comment menu');
        const image=Buffer.from((await this.request('/screenshot')).value,'base64');
        const meta=await sharp(image).metadata();if(meta.width!==1290||meta.height!==2796)throw new Error('Facebook comment screen size changed');
        const preview=await this.rect('accessibility id','fds-glimpse-preview','Comment preview');
        return (await recognizeWords(image)).filter(w=>w.x>600&&w.y>(preview.y+preview.height)*3);
    }
    private async more(){
        const words=await this.menuWords();const more=words.filter(w=>w.text==='More');
        if(more.length!==1)throw new Error('Facebook comment More menu is missing');
        const w=more[0];await this.tapPoint((w.x+w.width/2)/3,(w.y+w.height/2)/3);await this.sleep(400);
        return this.menuWords();
    }
    private async ownComment(text:string){
        const selector=`name == "comment-body-text" AND label == "${q(text)}" AND visible == 1`;
        if(!await this.visible('predicate string',selector))return null;
        const body=await this.rect('predicate string',selector,'Exact Facebook comment');
        const authors=(await this.request(this.session+'/elements',{using:'predicate string',value:'name == "comment-author-name" AND label BEGINSWITH "Antonio Revenue" AND visible == 1'})).value??[];
        for(const row of authors){const r=(await this.request(`${this.session}/element/${this.id(row)}/rect`)).value;if(r.y<body.y&&body.y-r.y<45)return body;}
        throw new Error('Matching comment does not have the expected author');
    }
    async commentOnPost(input:PostingInput,text:string,claim:()=>Promise<void>,existingOnly=false):Promise<CommentResult>{
        await this.verifyPost(input,true);
        await this.tapElement('accessibility id','shorts-comment-top-button','Facebook comments');
        const box='type == "XCUIElementTypeTextView" AND name == "comment-composer-text-area" AND label == "Comment as Antonio Revenue"';
        await this.waitFor('predicate string',box,'Comment as Antonio Revenue');
        let own=await this.ownComment(text);let claimed=false;
        if(!own){
            if(existingOnly)throw new Error('Existing own comment not found; repair cannot create one');
            await this.tapElement('predicate string',box,'Comment box');
            const existing=await this.read('predicate string',box,'value','Comment draft');
            if(existing.trim())throw new Error('Facebook comment draft is not empty');
            await this.request(this.session+'/wda/keys',{value:[text]});
            if(await this.read('predicate string',box,'value','Comment text')!==text)throw new Error('Facebook comment text readback failed');
            const send=await this.waitFor('accessibility id','comment-composer-confirm-button','Post comment');
            await claim();claimed=true;
            await this.request(`${this.session}/element/${send}/click`,{});
            for(let n=0;n<15;n++){await this.sleep(1000);own=await this.ownComment(text);if(own&&!await this.visible('predicate string','name == "comment-timestamp" AND label == "Posting..."'))break;own=null;}
            if(!own)throw new Error('Facebook comment receipt missing; never post again automatically');
        }
        await this.tapPoint(own.x+Math.min(own.width/2,150),own.y+own.height/2,900);
        const preview=await this.read('accessibility id','fds-glimpse-preview','label','Own comment preview');
        if(!preview.startsWith('Antonio Revenue')||!preview.includes(text))throw new Error('Comment menu belongs to another comment');
        let words=await this.more();
        if(words.some(w=>/^Unpin$/i.test(w.text)))return {status:'already_pinned',commentVerified:true,pinned:true,evidence:'Exact comment and author matched. Native menu offers Unpin Comment.'};
        const pin=words.filter(w=>w.text==='Pin'&&words.some(n=>n.text==='Comment'&&Math.abs(n.y-w.y)<25));
        if(pin.length!==1)throw new Error('Facebook Pin Comment is not available');
        if(!claimed)await claim();
        const w=pin[0];await this.tapPoint((w.x+w.width/2)/3,(w.y+w.height/2)/3);
        own=null;for(let n=0;n<15;n++){await this.sleep(1000);own=await this.ownComment(text);if(own)break;}if(!own)throw new Error('Pinned comment is not visible');
        await this.tapPoint(own.x+Math.min(own.width/2,150),own.y+own.height/2,900);
        words=await this.more();
        if(!words.some(w=>/^Unpin$/i.test(w.text)))throw new Error('Facebook pin readback failed');
        return {status:'pinned',commentVerified:true,pinned:true,evidence:'Exact comment and author matched. Reopened native menu offers Unpin Comment.'};
    }
}
