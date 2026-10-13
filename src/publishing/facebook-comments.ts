import sharp from 'sharp';
import {FacebookVerifier} from './facebook-verify.js';
import {visibleNativeNodes} from './native-xml.js';
import {recognizeWords} from '../tiktok/ocr.js';
import type {PostingInput} from './model.js';
import type {CommentResult} from './post-comments.js';

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
    /** One screen-tree snapshot. WDA's displayed flag reports on-screen Facebook comments as hidden (Oct 13),
     * so read visible="true" nodes from the source instead. Two copies of our comment stop everything for review. */
    private async commentSnapshot(text:string){
        const nodes=visibleNativeNodes((await this.request(this.session+'/source')).value);
        const bodies=nodes.filter(n=>n.name==='comment-body-text'&&n.label===text&&n.y>=50&&n.y+n.height<=900);
        if(bodies.length>1)throw new Error('Two copies of our Facebook comment are visible; review by hand');
        const body=bodies[0];
        if(body&&!nodes.some(n=>n.name==='comment-author-name'&&n.label.startsWith('Antonio Revenue')&&n.y<body.y&&body.y-n.y<45))throw new Error('Matching comment does not have the expected author');
        return {own:body?{x:body.x,y:body.y,width:body.width,height:body.height}:null,empty:!body&&nodes.some(n=>n.name==='no-comment-background')};
    }
    private async ownComment(text:string){return (await this.commentSnapshot(text)).own;}
    async commentOnPost(input:PostingInput,text:string,claim:()=>Promise<void>,existingOnly=false,postUrl?:string):Promise<CommentResult>{
        await this.verifyPost(input,true,false,postUrl);
        const count=await this.read('accessibility id','shorts-comment-top-button','label','Facebook comment count');
        await this.tapElement('accessibility id','shorts-comment-top-button','Facebook comments');
        const box='type == "XCUIElementTypeTextView" AND name == "comment-composer-text-area" AND label == "Comment as Antonio Revenue"';
        await this.waitFor('predicate string',box,'Comment as Antonio Revenue');
        // Oct 13: the composer appears before the comment list. A single check missed our comment one second
        // before it loaded. Wait for our comment or the empty-list marker before deciding anything.
        let own:Awaited<ReturnType<FacebookComments['ownComment']>>=null;let empty=false;let claimed=false;
        for(let n=0;n<15;n++){({own,empty}=await this.commentSnapshot(text));if(own||empty)break;await this.sleep(1000);}
        if(!own){
            if(existingOnly)throw new Error('Existing own comment not found; repair cannot create one');
            // Type only on a Reel with no comments at all, shown both on the Reel and in the loaded list.
            if(count!=='Comment, 0 comments'||!empty)throw new Error('Facebook Reel has comments but not ours, or the list did not load; not typed');
            await this.tapElement('predicate string',box,'Comment box');
            const existing=await this.read('predicate string',box,'value','Comment draft');
            if(existing.trim())throw new Error('Facebook comment draft is not empty');
            await this.request(this.session+'/wda/keys',{value:[text]});
            if(await this.read('predicate string',box,'value','Comment text')!==text)throw new Error('Facebook comment text readback failed');
            const send=await this.waitFor('accessibility id','comment-composer-confirm-button','Post comment');
            await claim();claimed=true;
            await this.request(`${this.session}/element/${send}/click`,{});
            // Oct 13: founderos's comment appeared after more than 15 s (uncertain_review although it was up). Wait 45 s.
            for(let n=0;n<45;n++){await this.sleep(1000);own=await this.ownComment(text);if(own&&!await this.visible('predicate string','name == "comment-timestamp" AND label == "Posting..."'))break;own=null;}
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
