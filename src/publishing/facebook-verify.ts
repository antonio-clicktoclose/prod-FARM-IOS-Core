import {visibleNativeNodes} from './native-xml.js';
import type { PostingInput } from './model.js';
import {WdaApp} from './wda-app.js';

export const normalizeCaption = (value: string) => value.replace(/\s+/g, ' ').trim();
/** Read-only verification on the configured Facebook Page. No composer or publishing actions. */
export class FacebookVerifier extends WdaApp {
    protected override async tapElement(using:string,value:string,what:string,ms=20_000) {
        const navigation=['tab-bar-item-190055527696468','Reels','back-button','feed-controls-menu-drag-handle','fbreels-description-collapse'];
        if(using!=='accessibility id'||(!navigation.includes(value)&&!value.startsWith('shorts-aggregation-video-component-')))
            return super.tapElement(using,value,what,ms);
        let r=await this.rect(using,value,what);
        if(value==='fbreels-description-collapse'){
            await this.sleep(1200);
            r=await this.rect(using,value,what);
        }
        if(r.x<0||r.y<45||r.x+r.width>431||r.y+r.height>925||r.width<=0||r.height<=0)
            throw Error('Facebook navigation control is outside the screen');
        // The collapsed row only expands from its visible More control at the right edge.
        const x=value==='fbreels-description-collapse'?r.x+r.width*.95:r.x+r.width/2;
        await this.tapPoint(x,r.y+r.height/2);await this.sleep(700);
    }
    async verifyPost(input: PostingInput, keepOpen = false) {
        const target=input.targets.find(t=>t.platform==='facebook');
        if(target?.account!=='https://www.facebook.com/profile.php?id=61584693917444') throw new Error('Facebook destination has not been mapped');
        await this.start('com.facebook.Facebook');
        // The Page tab can retain an old Reels collection after cross-posting.
        // Open the exact saved Page URL to load its current native collection.
        await this.request(this.session+'/url',{url:target.account});
        await this.request(this.session+'/appium/settings',{settings:{defaultActiveApplication:'com.facebook.Facebook'}});
        await this.waitFor('predicate string','label BEGINSWITH "Antonio Revenue" AND visible == 1','Antonio Revenue Page',15_000);
        const selector=await this.visible('accessibility id','navigation_bar_picker_title');
        if(selector && !String((await this.request(`${this.session}/element/${selector}/attribute/label`)).value).startsWith('Antonio Revenue,')) throw new Error('Wrong Facebook Page');
        // Locate the Reels tab without touching any creation or engagement controls.
        for(let n=0;n<4 && !await this.visible('accessibility id','Reels');n++) await this.scroll();
        await this.tapElement('accessibility id','Reels','Page Reels');
        const seen=new Set<string>();
        for(let page=0;page<4;page++) {
            await this.sleep(600);
            // Use one accessibility snapshot. Re-reading every cached element ID failed
            // when Facebook refreshed the grid between the displayed and rect requests.
            const names=[...new Set(visibleNativeNodes((await this.request(this.session+'/source')).value)
                .filter(n=>n.type==='XCUIElementTypeButton'&&n.name.startsWith('shorts-aggregation-video-component-')
                    &&n.y>=110&&n.y+n.height<=850)
                .map(n=>n.name))];
            for(const name of names) {
                if(seen.has(name))continue;seen.add(name);
                await this.tapElement('accessibility id',name,'Facebook Reel');
                if (!await this.visible('accessibility id','fbreels-description-expand')) await this.tapElement('accessibility id','fbreels-description-collapse','Expand Reel caption',10_000);
                const caption=await this.read('accessibility id','fbreels-description-expand','label','Facebook caption');
                if(normalizeCaption(caption)===normalizeCaption(input.caption)) {
                    const receipt={verified:true,source:'facebook_app',evidence:'Exact full caption matched in the Facebook app on Antonio Revenue > Reels',checkedAt:new Date().toISOString()};
                    if (!keepOpen) await this.tapElement('accessibility id','back-button','Leave Facebook Reel');
                    return receipt;
                }
                await this.tapElement('accessibility id','back-button','Back to Facebook Page');
            }
            await this.scroll();
        }
        throw new Error('Matching Reel not found in Facebook; linked sharing alone is not delivery proof');
    }
    private async scroll(){await this.request(this.session+'/wda/dragfromtoforduration',{fromX:215,fromY:790,toX:215,toY:290,duration:0.15});await this.sleep(600);}
}
