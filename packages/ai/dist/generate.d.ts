export type CaptionResult = {
    caption: string;
    paragraph: string;
    hashtags: string[];
};
export declare function generateCaption(opts: {
    prompt: string;
    mediaDescription?: string;
    platform?: string;
}): Promise<CaptionResult>;
/** Same as generateCaption, but also gives the model a look at the attached thumbnail/image (vision input). */
export declare function generateCaptionFromImage(opts: {
    prompt: string;
    imageUrl: string;
    platform?: string;
}): Promise<CaptionResult>;
export declare function generateReply(opts: {
    commentText: string;
    authorName?: string;
    postCaption?: string;
}): Promise<string>;
