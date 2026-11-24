export type ChatRole = "user" | "assistant";

export interface StoredMessage {
  role: ChatRole;
  content: string;
}

export interface PromptPayload {
  prompt: string;
}

export declare const MAX_BODY_BYTES: number;
export declare const MAX_PROMPT_CHARS: number;
export declare const MAX_STORED_MESSAGES: number;
export declare const MAX_STORED_MESSAGE_CHARS: number;

export declare class RequestValidationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode?: number);
}

export declare function isPostOnlyPath(path: string): boolean;
export declare function parsePromptRequest(request: Request): Promise<PromptPayload>;
export declare function retainRecentMessages(value: unknown): StoredMessage[];
