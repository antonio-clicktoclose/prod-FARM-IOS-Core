import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { DirectMediaStore } from './direct-media.js';
import { InstagramRelease } from './instagram-release.js';
import type { NativeStoryFrame } from './mirroring-stories.js';
import { liveStories, newStory, type LiveStory, type StoryState } from './story-receipts.js';

/** Music Antonio approved for the NORA Story (Oct 1), added in Instagram's "music only" style (no sticker). */
export const STORY_TRACK = { title: 'Stardust (Instrumental), Royalty Free', artist: 'Giulio Cercato', search: 'Stardust Giulio Cercato' } as const;
export const STORY_ACCOUNT = 'antoniorevenue';

type Tag = Record<string, string>;
/** Visible accessibility nodes with every attribute, including value (radio and style-cell state). */
export function visibleTags(xml: string): Tag[] {
    return [...xml.matchAll(/<XCUIElementType\w+\b[^>]*>/g)]
        .map(m => Object.fromEntries([...m[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(a => [a[1], a[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')])) as Tag)
        .filter(t => t.visible === 'true')
        .map(t => ({ type: '', name: '', label: '', value: '', ...t }));
}
const box = (t: Tag) => ({ x: Number(t.x), y: Number(t.y), w: Number(t.width), h: Number(t.height) });
const inside = (t: Tag, row: Tag) => { const a = box(t), b = box(row); return a.y >= b.y && a.y + a.h <= b.y + b.h; };

/** Share sheet mapped live 2026-10-07: Your story selected, its subtitle "And Facebook story", Close Friends off. */
export function storyShareSheetCheck(xml: string): { ok: boolean; reason: string } {
    const tags = visibleTags(xml);
    const row = (name: string) => tags.filter(t => t.type === 'XCUIElementTypeOther' && t.name === name);
    const yours = row('story-share-sheet-your-story'), friends = row('story-share-sheet-close-friends'), footer = row('stories-share-footer-button');
    if (yours.length !== 1 || friends.length !== 1 || footer.length !== 1) return { ok: false, reason: 'Story share sheet is not the mapped layout' };
    if (!tags.some(t => t.type === 'XCUIElementTypeButton' && t.name === 'Your story, And Facebook story' && inside(t, yours[0]!)))
        return { ok: false, reason: 'Facebook Story sharing is not on for Your story' };
    const radios = tags.filter(t => t.type === 'XCUIElementTypeButton' && t.name === 'Radio');
    const yourRadio = radios.filter(t => inside(t, yours[0]!)), friendRadio = radios.filter(t => inside(t, friends[0]!));
    if (yourRadio.length !== 1 || yourRadio[0]!.value !== '1') return { ok: false, reason: 'Your story is not selected' };
    if (friendRadio.length !== 1 || friendRadio[0]!.value === '1') return { ok: false, reason: 'Close Friends is selected' };
    const share = tags.filter(t => t.type === 'XCUIElementTypeButton' && t.name === 'Share');
    if (share.length !== 1 || !inside(share[0]!, footer[0]!)) return { ok: false, reason: 'The single Share button is missing or ambiguous' };
    return { ok: true, reason: 'Your story and Facebook story selected; Close Friends off; one Share button' };
}

/** Center of the Add-to-Story badge inside the own "Your story" tray cell (mapped 2026-10-07 at 68,174 25x25). */
export function storyAddBadgePoint(xml: string): { x: number; y: number } {
    const tags = visibleTags(xml), cells = tags.filter(t => t.type === 'XCUIElementTypeCell' && t.name === 'story-tray-cell-self');
    if (cells.length !== 1) throw new Error('Your story tray cell is missing or ambiguous');
    const c = box(cells[0]!), badges = tags.filter(t => t.name === 'Add-to-Story-24').map(box)
        .filter(b => b.x >= c.x && b.x + b.w <= c.x + c.w && b.y >= c.y && b.y + b.h <= c.y + c.h);
    if (badges.length !== 1 || c.y < 90 || c.y > 300) throw new Error('Add to story badge is missing or outside the Story tray');
    return { x: Math.round(badges[0]!.x + badges[0]!.w / 2), y: Math.round(badges[0]!.y + badges[0]!.h / 2) };
}

/** The exact approved track row in the audio browser. Returns the point that opens its editor (the subtitle line;
 * the title button only plays a preview). */
export function storyTrackPoint(xml: string): { x: number; y: number } {
    const tags = visibleTags(xml);
    const rows = tags.filter(t => t.type === 'XCUIElementTypeCell' && /^music-browser-audio-track--?\d+$/.test(t.name));
    const hits = rows.filter(r => tags.some(t => t.type === 'XCUIElementTypeButton' && t.name === STORY_TRACK.title && inside(t, r))
        && tags.some(t => t.type === 'XCUIElementTypeOther' && t.label.startsWith(STORY_TRACK.artist + ' · ') && inside(t, r)));
    if (hits.length !== 1) throw new Error('The approved Story track is missing or ambiguous');
    const sub = tags.find(t => t.type === 'XCUIElementTypeOther' && t.label.startsWith(STORY_TRACK.artist + ' · ') && inside(t, hits[0]!))!;
    const b = box(sub);
    if (b.y < 140 || b.y + b.h > 880) throw new Error('The approved Story track is outside the visible list');
    return { x: Math.round(b.x + Math.min(b.w, 200) / 2), y: Math.round(b.y + b.h / 2) };
}

/** Mean absolute pixel difference (0..1) between two equal-size raw images. */
export function pixelDistance(a: Buffer, b: Buffer): number {
    if (a.length !== b.length || !a.length) throw new Error('Images differ in size');
    let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i]! - b[i]!);
    return d / a.length / 255;
}

export interface StoryFrameReceipts {
    instagram: { verified: true; source: 'instagram_graph'; id: string; createdAt: string; url?: string };
    facebook: { verified: true; source: 'facebook_graph'; id: string; createdAt: string; url?: string };
}

/**
 * One Instagram Story frame on the iPhone 15 Pro Max, mapped live on 2026-10-07: Home Story tray > Add to story
 * gallery > exact PF- album photo > Audio (approved track, music only) > Text (Classic) > share options sheet.
 * The caller holds the phone advisory lock. The only public action is the single Share in publishFrame, after the
 * caller's per-frame claim. Before a claim, any failure closes Instagram; after it, the app is never closed.
 */
export class WdaStoryDriver extends InstagramRelease {
    private sheetReady = false;
    private shareAttempted = false;
    constructor(base: string, signal: AbortSignal, private storyImports: DirectMediaStore, private deviceUdid: string, private root: string) {
        super(base, signal, storyImports);
    }
    private async shot() { return Buffer.from((await this.request('/screenshot')).value, 'base64'); }
    private async proof(name: string) {
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        const png = await this.shot(), file = path.join(this.root, name + '.png');
        await writeFile(file, png, { mode: 0o600 });
        await writeFile(path.join(this.root, name + '.xml'), String((await this.request(this.session + '/source')).value), { mode: 0o600 });
        return { file, png };
    }
    private async crop(png: Buffer, r: { x: number; y: number; width: number; height: number }) {
        return sharp(png).extract({ left: Math.round(r.x * 3), top: Math.round(r.y * 3), width: Math.round(r.width * 3), height: Math.round(r.height * 3) }).removeAlpha().raw().toBuffer();
    }

    /** Builds one frame and stops on the share options sheet. Never taps Share. Returns the native editor preview. */
    async prepareFrame(frame: NativeStoryFrame, label: string): Promise<{ previewPath: string; previewSha256: string }> {
        this.sheetReady = false;
        const media = frame.media;
        if (media.mimeType !== 'image/png') throw new Error('Story frames must be reviewed PNG photos');
        if (createHash('sha256').update(await readFile(media.path)).digest('hex') !== media.sha256) throw new Error('Story frame image changed since review');
        if (!frame.text.trim() || frame.text.length > 300) throw new Error('Story frame text is empty or too long');
        const imported = await this.storyImports.ensure(this.deviceUdid, media, this.base, this.signal);
        if (imported.albumName !== 'PF-' + media.sha256.slice(0, 12)) throw new Error('Story import went to the wrong album');

        await this.start('com.burbn.instagram');
        await this.requireProfileForNewComposer();
        await this.dismissPromoSheets();
        await this.tapElement('accessibility id', 'profile-tab', 'Profile tab');
        const account = (await this.read('accessibility id', 'user-switch-title-button', 'label', 'active account')).replace(/^@/, '');
        if (account !== STORY_ACCOUNT) throw new Error(`Active Instagram account is ${account}, expected ${STORY_ACCOUNT}`);
        await this.tapElement('accessibility id', 'mainfeed-tab', 'Home feed');
        await this.openStoryGallery();

        await this.selectUploadAlbum(imported.albumName);
        await this.waitFor('accessibility id', 'gallery-photo-cell-0', 'Exact album photo');
        for (const other of ['gallery-photo-cell-1', 'gallery-video-cell-0', 'gallery-video-cell-1'])
            if (await this.visible('accessibility id', other)) throw new Error('The Story album does not contain exactly one photo');
        if ((await this.read('accessibility id', 'multi-select', 'label', 'selection mode')) !== 'Select') throw new Error('Story gallery is in multi-select mode');
        await this.tapElement('accessibility id', 'gallery-photo-cell-0', 'Exact imported photo');
        await this.waitFor('accessibility id', 'add-text-button', 'Story editor', 30_000);

        await this.addMusic();
        await this.addText(frame.text);
        const preview = await this.proof(label + '-native-draft');
        await this.openShareSheet(label);
        return { previewPath: preview.file, previewSha256: createHash('sha256').update(preview.png).digest('hex') };
    }

    /** The tray's add badge opens the Story gallery without a camera permission prompt. The Create menu's
     * Story mode asks for camera access, which this driver never grants. */
    private async openStoryGallery() {
        // The badge is in the screen tree but not reachable by element query (its tray cell owns accessibility).
        await this.waitFor('accessibility id', 'story-tray-cell-self', 'Your story tray cell');
        const badge = storyAddBadgePoint(String((await this.request(this.session + '/source')).value));
        await this.tapPoint(badge.x, badge.y);
        await this.waitFor('accessibility id', 'gallery-header-title', 'Add to story gallery', 15_000);
        if (await this.read('accessibility id', 'gallery-header-title', 'label', 'gallery title') !== 'Add to story') throw new Error('The Story gallery did not open');
    }

    private async addMusic() {
        const button = await this.rect('accessibility id', 'music-button', 'Audio button');
        const before = await this.crop(await this.shot(), button);
        // A tap right after the editor opens is sometimes ignored. Opening the browser is safe to retry once.
        let search: string | undefined;
        for (let attempt = 0; attempt < 2 && !search; attempt++) {
            await this.sleep(1500);
            await this.tapElement('accessibility id', 'music-button', 'Audio button');
            search = await this.waitFor('accessibility id', 'search-text-input', 'Audio search', 8_000).catch(error => { if (attempt) throw error; return undefined; });
        }
        await this.request(`${this.session}/element/${search!}/value`, { value: [STORY_TRACK.search] });
        // The first tap on a row plays a preview; a second tap on the same row opens its editor (mapped 2026-10-07).
        const style = 'type == "XCUIElementTypeCell" AND name == "music only" AND visible == 1';
        for (let tap = 0; tap < 2 && !await this.visible('predicate string', style); tap++) {
            let point: { x: number; y: number } | undefined;
            for (const deadline = Date.now() + 15_000; !point; await this.sleep(1000)) {
                try { point = storyTrackPoint(String((await this.request(this.session + '/source')).value)); }
                catch (error) { if (Date.now() >= deadline) throw error; }
            }
            await this.tapPoint(point.x, point.y);
            await this.waitFor('predicate string', style, 'Music only style', 4_000).catch(() => undefined);
        }
        await this.tapElement('predicate string', style, 'Music only style', 15_000);
        if (!(await this.read('predicate string', 'type == "XCUIElementTypeCell" AND name == "music only" AND visible == 1', 'value', 'music style')).startsWith('selected'))
            throw new Error('Music only style is not selected');
        await this.tapElement('predicate string', 'type == "XCUIElementTypeButton" AND name == "Done" AND visible == 1', 'Audio Done');
        await this.waitFor('accessibility id', 'add-text-button', 'Story editor after audio', 15_000);
        const after = await this.crop(await this.shot(), await this.rect('accessibility id', 'music-button', 'Audio button'));
        // The note icon becomes the track's album art once audio is attached (0.20 apart when mapped).
        if (pixelDistance(before, after) < 0.08) throw new Error('Story audio did not attach');
        if (await this.visible('predicate string', 'name BEGINSWITH "music-sticker" AND visible == 1')) throw new Error('A visible music sticker was added');
    }

    private async addText(text: string) {
        await this.tapElement('accessibility id', 'add-text-button', 'Text button');
        await this.waitFor('predicate string', 'type == "XCUIElementTypeTextView" AND name == "Text on your story" AND visible == 1', 'Story text entry', 15_000);
        await this.request(this.session + '/wda/keys', { value: [text] });
        await this.tapElement('predicate string', 'type == "XCUIElementTypeCell" AND name == "Classic text style" AND visible == 1', 'Classic text style');
        const typed = () => this.read('predicate string', 'type == "XCUIElementTypeTextView" AND name == "Text on your story" AND visible == 1', 'value', 'Story text');
        if (await typed() !== text) throw new Error('Story text readback does not match');
        await this.tapElement('accessibility id', 'text-entry-done-button', 'Text Done');
        await this.waitFor('accessibility id', 'add-text-button', 'Story editor after text', 15_000);
        if (await typed() !== text) throw new Error('Story text changed after Done');
    }

    private async openShareSheet(label: string) {
        await this.tapElement('accessibility id', 'send-to-button', 'Continue to share options');
        await this.waitFor('accessibility id', 'story-share-sheet-your-story', 'Story share sheet', 15_000);
        await this.sleep(800);
        const check = storyShareSheetCheck(String((await this.request(this.session + '/source')).value));
        if (!check.ok) throw new Error(check.reason);
        await this.proof(label + '-share-options');
        this.sheetReady = true;
    }

    /** Exactly one tap on the sheet's Share. The caller claims the frame first and never calls this twice. */
    private async shareStoryOnce() {
        if (!this.sheetReady || this.shareAttempted) throw new Error('Story Share is not ready or was already attempted');
        this.shareAttempted = true; this.sheetReady = false;
        const id = await this.waitFor('predicate string', 'type == "XCUIElementTypeButton" AND name == "Share" AND visible == 1', 'Story Share');
        await this.assertInputApp();
        const r = await this.raw(`${this.session}/element/${id}/click`, {});
        if (!r.ok || r.body.value?.error) throw new Error(`Story Share tap result is uncertain: ${r.body.value?.error ?? r.status}`);
    }

    private async receipts(before: StoryState, sharedAt: number, waitMs: number): Promise<StoryFrameReceipts> {
        const known = { instagram: new Set(before.instagram.map(s => s.id)), facebook: new Set(before.facebook.map(s => s.id)) };
        let ig: LiveStory | null = null, fb: LiveStory | null = null;
        for (const deadline = Date.now() + waitMs; ; await this.sleep(15_000)) {
            const now = await liveStories();
            ig ??= newStory(now.instagram, known.instagram, sharedAt);
            fb ??= newStory(now.facebook, known.facebook, sharedAt);
            if (ig && fb) break;
            if (Date.now() >= deadline) throw new Error(`Story receipt missing after one Share: Instagram ${ig ? 'found' : 'missing'}, Facebook ${fb ? 'found' : 'missing'}. Inspect; never share again`);
        }
        return {
            instagram: { verified: true, source: 'instagram_graph', id: ig.id, createdAt: new Date(ig.createdAt).toISOString(), url: ig.url },
            facebook: { verified: true, source: 'facebook_graph', id: fb.id, createdAt: new Date(fb.createdAt).toISOString(), url: fb.url },
        };
    }

    /** Draft only: build the frame, save the native preview, close Instagram. No claim, no Share. */
    async captureDraftFrame(frame: NativeStoryFrame, label = frame.sourceSha256.slice(0, 12)): Promise<NativeStoryFrame> {
        try {
            const preview = await this.prepareFrame(frame, label);
            return { ...frame, ...preview };
        } catch (error) {
            throw new Error(`${error instanceof Error ? error.message : String(error)} (evidence: ${await this.captureFailure('story-draft-' + label).catch(() => 'none')})`);
        } finally { await this.resetAfterFailure().catch(() => undefined); }
    }

    /** Build, claim, one Share, then Graph receipts on both destinations. */
    async publishFrame(frame: NativeStoryFrame, claim: () => Promise<void>, receiptWaitMs = 4 * 60_000): Promise<StoryFrameReceipts> {
        const label = frame.sourceSha256.slice(0, 12);
        let claimed = false;
        try {
            const before = await liveStories();
            await this.prepareFrame(frame, label);
            await claim(); claimed = true;
            const sharedAt = Date.now();
            await this.shareStoryOnce();
            for (const deadline = Date.now() + 60_000; await this.visible('accessibility id', 'story-share-sheet-your-story'); await this.sleep(1000))
                if (Date.now() >= deadline) throw new Error('Story share sheet stayed open after one Share; inspect, never share again');
            await this.proof(label + '-after-share');
            return await this.receipts(before, sharedAt, receiptWaitMs);
        } catch (error) {
            const evidence = await this.captureFailure('story-' + label).catch(() => 'none');
            // Closing Instagram after Share could cancel the upload. Only close it before a claim.
            if (!claimed) await this.resetAfterFailure().catch(() => undefined);
            throw new Error(`${error instanceof Error ? error.message : String(error)} (evidence: ${evidence})`);
        }
    }
}
