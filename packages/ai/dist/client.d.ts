export declare const CLASSIFY_MODEL: string;
export declare const GENERATE_MODEL: string;
export declare class AiNotConfiguredError extends Error {
    constructor();
}
export type Message = {
    role: 'user' | 'assistant';
    content: string | Array<{
        type: 'text';
        text: string;
    } | {
        type: 'image';
        source: {
            type: 'url';
            url: string;
        };
    }>;
};
/** Calls the Messages API and returns the concatenated text of the response. Throws AiNotConfiguredError if no key. */
export declare function complete(opts: {
    model: string;
    system: string;
    messages: Message[];
    maxTokens?: number;
}): Promise<string>;
/** Parses the model's reply as JSON, tolerating a ```json fence around it (models add one fairly often). */
export declare function parseJson<T>(text: string): T;
