import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_BODY_BYTES,
  MAX_PROMPT_CHARS,
  MAX_STORED_MESSAGES,
  RequestValidationError,
  isPostOnlyPath,
  parsePromptRequest,
  retainRecentMessages,
} from "../src/request-validation.mjs";

const request = (body, headers = {}) =>
  new Request("https://worker.test/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });

test("state-changing routes require POST", () => {
  for (const path of ["/increment", "/decrement", "/reset"]) {
    assert.equal(isPostOnlyPath(path), true, path);
  }
  assert.equal(isPostOnlyPath("/"), false);
});

test("chat and image routes require POST", () => {
  assert.equal(isPostOnlyPath("/chat"), true);
  assert.equal(isPostOnlyPath("/image"), true);
});

test("parses a valid prompt request", async () => {
  assert.deepEqual(await parsePromptRequest(request(JSON.stringify({ prompt: "hello" }))), {
    prompt: "hello",
  });
});

test("rejects a missing body", async () => {
  const req = new Request("https://worker.test/chat", { method: "POST" });
  await assert.rejects(
    parsePromptRequest(req),
    (error) => error instanceof RequestValidationError && error.statusCode === 400,
  );
});

test("rejects malformed JSON", async () => {
  await assert.rejects(
    parsePromptRequest(request("{")),
    (error) => error instanceof RequestValidationError && error.statusCode === 400,
  );
});

test("rejects array JSON", async () => {
  await assert.rejects(
    parsePromptRequest(request("[]")),
    (error) => error instanceof RequestValidationError && error.statusCode === 400,
  );
});

test("rejects missing and blank prompts", async () => {
  for (const body of [{}, { prompt: "" }, { prompt: "   " }, { prompt: 42 }]) {
    await assert.rejects(
      parsePromptRequest(request(JSON.stringify(body))),
      (error) => error instanceof RequestValidationError && error.statusCode === 400,
    );
  }
});

test("rejects an oversized Content-Length before reading", async () => {
  await assert.rejects(
    parsePromptRequest(request("{}", { "content-length": String(MAX_BODY_BYTES + 1) })),
    (error) => error instanceof RequestValidationError && error.statusCode === 413,
  );
});

test("rejects oversized streamed bodies", async () => {
  const body = JSON.stringify({ prompt: "x".repeat(MAX_BODY_BYTES + 10) });
  await assert.rejects(
    parsePromptRequest(request(body)),
    (error) => error instanceof RequestValidationError && error.statusCode === 413,
  );
});

test("rejects overlong prompts", async () => {
  await assert.rejects(
    parsePromptRequest(request(JSON.stringify({ prompt: "x".repeat(MAX_PROMPT_CHARS + 1) }))),
    (error) => error instanceof RequestValidationError && error.statusCode === 413,
  );
});

test("bounds durable conversation history and validates stored messages", () => {
  const prior = Array.from({ length: MAX_STORED_MESSAGES + 5 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: String(index),
  }));
  prior.push({ role: "system", content: "untrusted" });
  const kept = retainRecentMessages(prior);
  assert.equal(kept.length, MAX_STORED_MESSAGES);
  assert.ok(kept.every((message) => message.role === "user" || message.role === "assistant"));
});

test("invalid stored history becomes an empty list", () => {
  assert.deepEqual(retainRecentMessages({ unexpected: true }), []);
});
