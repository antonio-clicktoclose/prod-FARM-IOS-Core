/** Lifestyle Story frames (Antonio, Oct 15 2026): "not the images of the reel itself. Just drop the reel in the end, add some
 * color, some life, add my gallery images that sell". Four of his approved photos, full color, with text in the style of his
 * profile Highlights (white pills, one red line), then the Reel itself as the last frame. No model: photos rotate least
 * recently used from docs/stories/photo-pool.json plus the auto-approved Dropbox Stories folder; text comes from the Reel. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

export interface PoolPhoto { file: string; sha256: string }
const W = 1080, H = 1920, IMAGE = /\.(jpe?g|png|heic)$/i;

export function loadPhotoPool(file = 'docs/stories/photo-pool.json'): PoolPhoto[] {
    const pool = JSON.parse(readFileSync(file, 'utf8')) as { autoApprovedFolder?: string; photos: PoolPhoto[] };
    const photos = pool.photos.filter(p => existsSync(p.file));
    const folder = pool.autoApprovedFolder;
    if (folder && existsSync(folder))
        for (const name of readdirSync(folder).filter(n => IMAGE.test(n)).sort()) {
            const file = path.join(folder, name);
            photos.push({ file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') });
        }
    const seen = new Set<string>();
    return photos.filter(p => !seen.has(p.sha256) && seen.add(p.sha256));
}

/** The n photos used longest ago (never used first), in a stable order. */
export function pickPhotos(pool: PoolPhoto[], lastUsed: ReadonlyMap<string, number>, n = 4): PoolPhoto[] {
    if (pool.length < n) throw Error(`The Story photo pool has ${pool.length} photos; ${n} are needed`);
    return [...pool].sort((a, b) => (lastUsed.get(a.sha256) ?? 0) - (lastUsed.get(b.sha256) ?? 0) || a.sha256.localeCompare(b.sha256)).slice(0, n);
}

/** Greedy wrap to about `max` characters per line. */
export function wrapLines(text: string, max = 24): string[] {
    const lines: string[] = [];
    for (const word of text.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').split(/\s+/).filter(Boolean)) {
        const last = lines[lines.length - 1];
        if (last && (last + ' ' + word).length <= max) lines[lines.length - 1] = last + ' ' + word;
        else lines.push(word);
    }
    return lines;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Highlight style: one white rounded pill per line, black bold text; the `red` line is red. */
export function textOverlay(lines: string[], { top = 300, size = 58, red = -1 } = {}): Buffer {
    const step = Math.round(size * 1.42);
    const pills = lines.map((line, i) => {
        const y = top + i * step, w = Math.min(W - 60, Math.round(line.length * size * 0.56 + size * 1.1));
        return `<rect x="${(W - w) / 2}" y="${y - size}" width="${w}" height="${Math.round(size * 1.32)}" rx="16" fill="#fff"/>`
            + `<text x="${W / 2}" y="${y}" font-family="Helvetica Neue, Helvetica, Arial" font-weight="700" font-size="${size}" text-anchor="middle" fill="${i === red ? '#E8231F' : '#111'}">${esc(line)}</text>`;
    }).join('');
    return Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${pills}</svg>`);
}

/** HEIC goes through macOS sips; everything else straight to sharp. */
async function photoBuffer(file: string): Promise<Buffer> {
    if (!/\.heic$/i.test(file)) return readFile(file);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'story-heic-'));
    try { const out = path.join(dir, 'p.jpg'); execFileSync('sips', ['-s', 'format', 'jpeg', file, '--out', out], { stdio: 'ignore' }); return await readFile(out); }
    finally { await rm(dir, { recursive: true, force: true }); }
}

/** One full-color 1080x1920 frame: the photo (EXIF-rotated, cover crop, a touch more saturation) plus the text pills. */
export async function lifestyleFrame(photo: PoolPhoto, text: string, red = false): Promise<Buffer> {
    const lines = wrapLines(text);
    const bg = await sharp(await photoBuffer(photo.file), { failOn: 'none' }).rotate().resize(W, H, { fit: 'cover', position: 'attention' })
        .modulate({ saturation: 1.12, brightness: 1.02 }).toBuffer();
    return sharp(bg).composite([{ input: textOverlay(lines, { red: red ? lines.length - 1 : -1 }) }]).removeAlpha().png().toBuffer();
}

/** Frame texts from the Reel caption: up to three short caption sentences (three lines max each), then the keyword CTA. */
export function lifestyleTexts(spotlight: string[], fallbacks: readonly string[]): string[] {
    const short = (s: string) => wrapLines(s).length <= 3;
    const picked = spotlight.slice(0, 4).filter(short).slice(0, 3);
    for (const f of fallbacks) if (picked.length < 3 && !picked.includes(f)) picked.push(f);
    const cta = spotlight[4] ?? '';
    const keyword = cta.match(/^Comment (\S+) /)?.[1];
    return [...picked, keyword ? `Comment ${keyword} on this reel` : 'The full reel is next'];
}
