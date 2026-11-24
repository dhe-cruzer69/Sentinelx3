import { DurableObject } from "cloudflare:workers";
import {
  isPostOnlyPath,
  parsePromptRequest,
  RequestValidationError,
  retainRecentMessages,
} from "./request-validation.mjs";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Env {
  MY_DURABLE_OBJECT: DurableObjectNamespace<MyDurableObject>;
  AI: any;
}

export class MyDurableObject extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (isPostOnlyPath(path) && request.method !== "POST") {
      return this.json(
        { error: "Method not allowed" },
        405,
        { Allow: "POST" },
      );
    }

    const storedCount = await this.ctx.storage.get<number>("count");
    const count = Number.isSafeInteger(storedCount) ? storedCount : 0;

    if (path === "/increment") {
      const next = count + 1;
      await this.ctx.storage.put("count", next);
      return this.json({ action: "increment", count: next });
    }
    if (path === "/decrement") {
      const next = count - 1;
      await this.ctx.storage.put("count", next);
      return this.json({ action: "decrement", count: next });
    }
    if (path === "/reset") {
      await this.ctx.storage.put("count", 0);
      return this.json({ action: "reset", count: 0 });
    }

    if (path === "/chat") {
      try {
        const body = await parsePromptRequest(request);
        const history = retainRecentMessages(
          await this.ctx.storage.get<unknown>("messages"),
        );
        const userMessage: ChatMessage = { role: "user", content: body.prompt };
        const response = await this.env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: "You are Arise GenOps assistant." },
              ...history.slice(-10),
              userMessage,
            ],
          },
        );
        const reply =
          response !== null && typeof response.response === "string"
            ? response.response
            : "No response";
        const messages = retainRecentMessages([
          ...history,
          userMessage,
          { role: "assistant", content: reply },
        ]);
        await this.ctx.storage.put("messages", messages);

        return this.json({ response: reply, history_length: messages.length });
      } catch (error) {
        if (error instanceof RequestValidationError) {
          return this.json({ error: error.message }, error.statusCode);
        }
        console.error("chat request failed", error);
        return this.json({ error: "Chat request failed" }, 502);
      }
    }

    if (path === "/image") {
      try {
        const body = await parsePromptRequest(request);
        const response = await this.env.AI.run(
          "@cf/stabilityai/stable-diffusion-xl-base-1.0",
          { prompt: body.prompt },
        );
        if (!(response?.image instanceof ArrayBuffer)) {
          return this.json({ error: "Image provider returned an invalid response" }, 502);
        }
        return new Response(response.image, {
          headers: {
            "Content-Type": "image/png",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (error) {
        if (error instanceof RequestValidationError) {
          return this.json({ error: error.message }, error.statusCode);
        }
        console.error("image request failed", error);
        return this.json({ error: "Image request failed" }, 502);
      }
    }

    return this.json({
      status: "online",
      service: "Arise GenOps Core",
      count,
      endpoints: ["/increment", "/decrement", "/reset", "/chat", "/image"],
      docs: "https://github.com/dhe-cruzer69/arise-genops-core",
    });
  }

  private json(
    data: unknown,
    status = 200,
    extraHeaders: Record<string, string> = {},
  ): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        ...extraHeaders,
      },
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const name = url.searchParams.get("name") || "default";
    const id = env.MY_DURABLE_OBJECT.idFromName(name);
    return env.MY_DURABLE_OBJECT.get(id).fetch(request);
  },
} satisfies ExportedHandler<Env>;
