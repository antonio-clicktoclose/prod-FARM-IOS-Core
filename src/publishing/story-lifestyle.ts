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
import sharp, { type OverlayOptions } from 'sharp';

export interface PoolPhoto { file: string; sha256: string; faceTop?: number | null; t?: number }
/** Under a proof card at the top, only photos with the face low (or not visible) keep the face clear. */
export const cardSafe = (p: PoolPhoto) => p.faceTop == null || p.faceTop > 0.5;
const W = 1080, H = 1920, IMAGE = /\.(jpe?g|png|heic)$/i;

export function loadPhotoPool(file = 'docs/stories/photo-pool.json'): PoolPhoto[] {
    const pool = JSON.parse(readFileSync(file, 'utf8')) as { autoApprovedFolder?: string; photos: PoolPhoto[]; videoStills?: PoolPhoto[] };
    const photos = [...pool.photos, ...(pool.videoStills ?? [])].filter(p => existsSync(p.file));
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
export function wrapLines(text: string, max = 26): string[] {
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

/** Video stills: the full-resolution frame at t seconds. HEIC goes through macOS sips; everything else straight to sharp. */
async function photoBuffer(file: string, t?: number): Promise<Buffer> {
    if (t !== undefined) return execFileSync('ffmpeg', ['-v', 'error', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '2', '-'], { maxBuffer: 128 << 20 });
    if (!/\.heic$/i.test(file)) return readFile(file);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'story-heic-'));
    try { const out = path.join(dir, 'p.jpg'); execFileSync('sips', ['-s', 'format', 'jpeg', file, '--out', out], { stdio: 'ignore' }); return await readFile(out); }
    finally { await rm(dir, { recursive: true, force: true }); }
}

export interface ProofCard { file: string; headline: string; source: string }
export function loadProofCards(file = 'docs/stories/proof-cards.json'): ProofCard[] {
    return (JSON.parse(readFileSync(file, 'utf8')) as { cards: ProofCard[] }).cards.filter(c => existsSync(c.file));
}

/** A big red hand-drawn arrow from beside the headline up to the proof card (as in the Highlights). */
function arrow(textTop: number, cardBottom: number): string {
    const x0 = 150, y0 = textTop - 20, x1 = 230, y1 = cardBottom + 10;
    return `<g stroke="#E8231F" stroke-width="14" stroke-linecap="round" fill="none">`
        + `<path d="M ${x0} ${y0} C ${x0 - 70} ${y0 - 70}, ${x1 - 120} ${y1 + 60}, ${x1} ${y1}"/>`
        + `<path d="M ${x1} ${y1} l -58 4 M ${x1} ${y1} l -18 52"/></g>`;
}

/** One bright, full-color 1080x1920 frame: the photo (EXIF-rotated, cover crop, lifted exposure and saturation), an optional
 * proof card at the top with a red arrow, and the text pills. Frames without a card put the text near the top. */
export async function lifestyleFrame(source: PoolPhoto | Buffer, text: string, { red = false, card }: { red?: boolean; card?: ProofCard } = {}): Promise<Buffer> {
    const lines = wrapLines(text);
    const raw = Buffer.isBuffer(source) ? source : await photoBuffer(source.file, source.t);
    const bg = await sharp(raw, { failOn: 'none' }).rotate().resize(W, H, { fit: 'cover', position: 'attention' })
        .modulate({ saturation: 1.18, brightness: 1.12 }).linear(1.04, 6).toBuffer();
    const layers: OverlayOptions[] = [];
    let textTop = 300;
    if (card) {
        const img = await sharp(card.file).resize(960, 620, { fit: 'inside' }).png().toBuffer(), meta = await sharp(img).metadata();
        const framed = await sharp({ create: { width: meta.width! + 24, height: meta.height! + 24, channels: 4, background: '#ffffff' } })
            .composite([{ input: img, left: 12, top: 12 }]).png().toBuffer();
        layers.push({ input: framed, left: Math.round((W - meta.width! - 24) / 2), top: 190 });
        const cardBottom = 190 + meta.height! + 24;
        textTop = cardBottom + 230;
        layers.push({ input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${arrow(textTop, cardBottom)}</svg>`) });
    }
    layers.push({ input: textOverlay(lines, { top: textTop, red: red || card ? lines.length - 1 : -1 }) });
    return sharp(bg).composite(layers).removeAlpha().png().toBuffer();
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

/** Quality gate before a picture is used: enough pixels for a full-screen Story, sharp (variance of a Laplacian on a
 * 512 px copy) and not too dark or blown out. */
export async function imageQuality(raw: Buffer): Promise<{ ok: boolean; sharpness: number; brightness: number; width: number; height: number }> {
    const img = sharp(raw, { failOn: 'none' }).rotate(), meta = await img.metadata();
    const width = meta.autoOrient?.width ?? meta.width ?? 0, height = meta.autoOrient?.height ?? meta.height ?? 0;
    const grey = await img.clone().resize(512, 512, { fit: 'inside' }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const { data, info } = grey, w = info.width, h = info.height;
    let sum = 0, sum2 = 0, n = 0, lum = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x, v = 4 * data[i]! - data[i - 1]! - data[i + 1]! - data[i - w]! - data[i + w]!;
        sum += v; sum2 += v * v; n++; lum += data[i]!;
    }
    const sharpness = sum2 / n - (sum / n) ** 2, brightness = lum / n;
    const ok = Math.min(width, height) >= 1080 && sharpness >= 60 && brightness >= 45 && brightness <= 215;
    return { ok, sharpness: Math.round(sharpness), brightness: Math.round(brightness), width, height };
}

/** Clean, minimal frame (Antonio, Oct 15: "the edit has to be clean, minimal"): the full-color picture, at most two lines
 * of white text with a soft shadow in the lower third, and for proof frames the real dashboard screenshot with rounded
 * corners and a soft shadow near the top. No pills, arrows or marker strokes. */
export async function minimalFrame(source: PoolPhoto | Buffer, text: string, { card }: { card?: ProofCard } = {}): Promise<Buffer> {
    const raw = Buffer.isBuffer(source) ? source : await photoBuffer(source.file, source.t);
    const bg = await sharp(raw, { failOn: 'none' }).rotate().resize(W, H, { fit: 'cover', position: 'attention' })
        .modulate({ saturation: 1.1, brightness: 1.06 }).toBuffer();
    const layers: OverlayOptions[] = [];
    if (card) {
        const img = await sharp(card.file).resize(940, 600, { fit: 'inside' }).png().toBuffer(), m = await sharp(img).metadata();
        const r = 22, mask = Buffer.from(`<svg width="${m.width}" height="${m.height}"><rect width="${m.width}" height="${m.height}" rx="${r}" fill="#fff"/></svg>`);
        const rounded = await sharp(img).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
        const pad = 60, shadow = await sharp({ create: { width: m.width! + pad * 2, height: m.height! + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
            .composite([{ input: Buffer.from(`<svg width="${m.width! + pad * 2}" height="${m.height! + pad * 2}"><rect x="${pad}" y="${pad + 14}" width="${m.width}" height="${m.height}" rx="${r}" fill="#000" opacity="0.45"/></svg>`) }]).blur(24).png().toBuffer();
        const left = Math.round((W - m.width!) / 2), top = 260;
        layers.push({ input: shadow, left: left - pad, top: top - pad }, { input: rounded, left, top });
    }
    const lines = wrapLines(text, 28).slice(0, 2), size = 58, base = H - 520;
    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><filter id="s" x="-20%" y="-50%" width="140%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="9" flood-color="#000" flood-opacity="0.55"/></filter></defs>`
        + lines.map((l, i) => `<text x="${W / 2}" y="${base + i * size * 1.22}" font-family="SF Pro Display, Helvetica Neue, Helvetica, Arial" font-weight="600" font-size="${size}" text-anchor="middle" fill="#fff" filter="url(#s)">${esc(l)}</text>`).join('') + '</svg>';
    layers.push({ input: Buffer.from(svg) });
    return sharp(bg).composite(layers).removeAlpha().png().toBuffer();
}
