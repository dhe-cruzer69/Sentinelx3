export const MAX_BODY_BYTES = 8_192;
export const MAX_PROMPT_CHARS = 4_000;
export const MAX_STORED_MESSAGES = 20;
export const MAX_STORED_MESSAGE_CHARS = 8_000;

const POST_ONLY_PATHS = new Set([
  "/increment",
  "/decrement",
  "/reset",
  "/chat",
  "/image",
]);

export class RequestValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "RequestValidationError";
    this.statusCode = statusCode;
  }
}

export function isPostOnlyPath(path) {
  return POST_ONLY_PATHS.has(path);
}

export async function parsePromptRequest(request) {
  const rawLength = request.headers.get("content-length");
  let declaredLength;

  if (rawLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(rawLength)) {
      throw new RequestValidationError("Content-Length must be a non-negative integer");
    }
    declaredLength = Number(rawLength);
    if (!Number.isSafeInteger(declaredLength)) {
      throw new RequestValidationError("Content-Length is outside the safe integer range");
    }
    if (declaredLength <= 0) {
      throw new RequestValidationError("Request body must not be empty");
    }
    if (declaredLength > MAX_BODY_BYTES) {
      throw new RequestValidationError("Request body exceeds the 8192-byte limit", 413);
    }
  }

  const reader = request.body?.getReader();
  if (!reader) {
    throw new RequestValidationError("A JSON request body is required");
  }

  const chunks = [];
  let totalBytes = 0;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;

    totalBytes += value.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // The request is already rejected; cancellation is best-effort.
      }
      throw new RequestValidationError("Request body exceeds the 8192-byte limit", 413);
    }
    chunks.push(value);
  }

  if (declaredLength !== undefined && declaredLength !== totalBytes) {
    throw new RequestValidationError("Content-Length does not match the received body");
  }
  if (totalBytes === 0) {
    throw new RequestValidationError("Request body must not be empty");
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RequestValidationError("Request body must be valid UTF-8 JSON");
  }

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RequestValidationError("Request JSON must be an object");
  }

  const prompt = payload.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new RequestValidationError("prompt must be a non-empty string");
  }
  if (Array.from(prompt).length > MAX_PROMPT_CHARS) {
    throw new RequestValidationError("prompt exceeds the 4000-character limit", 413);
  }

  return { prompt: prompt.trim() };
}

export function retainRecentMessages(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((message) =>
      message !== null &&
      typeof message === "object" &&
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" &&
      message.content.length <= MAX_STORED_MESSAGE_CHARS
    )
    .slice(-MAX_STORED_MESSAGES);
}
