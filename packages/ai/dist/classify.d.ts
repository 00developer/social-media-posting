export type CommentClass = 'normal' | 'spam' | 'negative';
export declare function classifyComment(opts: {
    commentText: string;
    postCaption?: string;
}): Promise<CommentClass>;
