/** Draft review only. Passing this policy never authorizes or performs publication. */
export const storyPolicy = {
    version: 2,
    stages: ['moment', 'problem', 'proof', 'lesson', 'reply'],
    nativeText: true,
    distinctImagesRequired: 5, // Legacy version 1
    distinctAssetsRequired: 5,
    supportedVersions: [1, 2],
    formats: ['proof_led', 'post_led'],
    musicStyle: 'music_only',
    publication: 'approval_required',
    automaticPublishingReady: false,
    reference: 'https://www.instagram.com/niksetting/',
} as const;
export function reviewStoryDraft(value: unknown) {
    const draft = value as any;
    const errors: string[] = [];
    if (!draft || typeof draft !== 'object') return { valid: false, errors: ['A Story draft is required.'], policyVersion: 1 };
    const v2 = draft.policyVersion === 2;
    if (![1, 2].includes(draft.policyVersion)) errors.push('Use Story policy version 1 or 2.');
    if (v2 && !['proof_led', 'post_led'].includes(draft.format)) errors.push('Choose proof_led or post_led format.');
    const stages = v2 && draft.format === 'post_led' ? ['problem', 'mechanism', 'post', 'lesson', 'reply'] : storyPolicy.stages;
    if (draft.nativeText !== true) errors.push('Use native Instagram text.');
    if (draft.musicStyle !== 'music_only') errors.push('Use background music without a visible sticker.');
    const frames = Array.isArray(draft.frames) ? draft.frames : [];
    const imageRefs = frames.map((frame: any) => typeof frame?.assetRef === 'string' ? frame.assetRef.trim() : '');
    if (new Set(imageRefs).size !== 5 || imageRefs.some((ref: string) => !ref)) errors.push('Use five different reviewed assets, one for each frame. Different filenames for the same image do not count.');
    if (frames.length !== 5) errors.push('Include all five frames for the selected format.');
    for (const [index, stage] of stages.entries()) {
        const frame = frames[index];
        if (!frame || frame.stage !== stage) { errors.push(`Frame ${index + 1} must cover ${stage}.`); continue; }
        if (typeof frame.text !== 'string' || !frame.text.trim() || frame.text.trim().split(/\s+/).length > 45) errors.push(`Frame ${index + 1} needs 1 to 45 words.`);
        if (!['gallery_photo', 'work_photo', 'dashboard', 'workflow', 'testimonial', ...(v2 ? ['b_roll', 'native_reel'] : [])].includes(frame.assetKind)) errors.push(`Frame ${index + 1} needs a real photo or evidence asset.`);
        if (v2 && frame.assetKind === 'b_roll' && (!Number.isFinite(frame.clipStartSeconds) || frame.clipStartSeconds < 0 || !Number.isFinite(frame.clipEndSeconds) || frame.clipEndSeconds - frame.clipStartSeconds < 3 || frame.clipEndSeconds - frame.clipStartSeconds > 12)) errors.push(`Frame ${index + 1} needs an exact B-roll trim of 3 to 12 seconds.`);
        if (v2 && frame.assetKind === 'native_reel' && (typeof frame.assetRef !== 'string' || !/^https:\/\/(www\.)?instagram\.com\/reel\/[A-Za-z0-9_-]+\/?$/.test(frame.assetRef))) errors.push(`Frame ${index + 1} needs the exact published Reel URL.`);
        if (v2 && stage === 'post' && (frame.assetKind !== 'native_reel' || frame.claimReview !== 'source_checked')) errors.push('The post frame needs a checked native Reel share.');
        if (typeof frame.assetRef !== 'string' || !frame.assetRef.trim()) errors.push(`Frame ${index + 1} needs an asset reference.`);
        if (frame.visualReviewed !== true) errors.push(`Frame ${index + 1} needs a visual check for text space, relevance and privacy.`);
        if (!['no_factual_claim', 'source_checked'].includes(frame.claimReview)) errors.push(`Frame ${index + 1} needs a claim review.`);
        if (frame.claimReview === 'source_checked' && (typeof frame.sourceRef !== 'string' || !frame.sourceRef.trim())) errors.push(`Frame ${index + 1} needs its claim source.`);
        if (stage === 'proof' && (!['dashboard', 'workflow', 'testimonial'].includes(frame.assetKind) || frame.claimReview !== 'source_checked')) errors.push('The proof frame needs a checked dashboard, workflow or approved testimonial.');
    }
    if (!frames.some((f:any) => ['gallery_photo', 'work_photo', ...(v2 ? ['b_roll'] : [])].includes(f?.assetKind))) errors.push('Include a real personal or work photo.');
    return { valid: errors.length === 0, errors, policyVersion: draft.policyVersion, publicationAllowed: false };
}
