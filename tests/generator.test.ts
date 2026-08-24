import { Chat, type GeneratorController } from "@lmstudio/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chatEndpoint,
  normalizeEndpoint,
  requestHeaders,
  toOpenAIMessages,
} from "../src/externalApi";
import { generate, parseSse } from "../src/generator";

afterEach(() => vi.unstubAllGlobals());

describe("external generator boundaries", () => {
  it("builds a safe OpenAI-compatible endpoint and optional Bearer header", () => {
    const connection = {
      endpoint: "http://127.0.0.1:8000/v1/",
      apiKey: "test-secret",
    };
    expect(chatEndpoint(connection).href).toBe(
      "http://127.0.0.1:8000/v1/chat/completions",
    );
    expect(requestHeaders(connection).get("Authorization")).toBe(
      "Bearer test-secret",
    );
    expect(() => normalizeEndpoint("https://secret@example.test/v1")).toThrow(
      /credentials/i,
    );
  });

  it("parses split SSE frames and ignores DONE", async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"hel'),
          );
          controller.enqueue(encoder.encode('lo"}}]}\n\ndata: [DONE]\n\n'));
          controller.close();
        },
      }),
    );
    const chunks = [];
    for await (const chunk of parseSse(response)) chunks.push(chunk);
    expect(chunks).toEqual([{ choices: [{ delta: { content: "hello" } }] }]);
  });

  it("streams a configured external completion through the LM Studio controller", async () => {
    const fragments: string[] = [];
    let requestBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: string | URL | Request, init?: RequestInit) => {
        if (typeof init?.body !== "string") {
          throw new Error("Expected a JSON string request body");
        }
        requestBody = JSON.parse(init.body) as unknown;
        return Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'),
        );
      }),
    );
    const values: Record<string, unknown> = {
      externalModel: "model-a",
      temperature: 0.25,
      maxOutputTokens: 2048,
    };
    const globalValues: Record<string, unknown> = {
      externalEndpoint: "http://provider.test/v1",
      externalApiKey: "",
    };
    const controller = {
      getPluginConfig: () => ({ get: (key: string) => values[key] }),
      getGlobalPluginConfig: () => ({
        get: (key: string) => globalValues[key],
      }),
      onAborted: () => undefined,
      getToolDefinitions: () => [],
      fragmentGenerated: (fragment: string) => fragments.push(fragment),
    } as unknown as GeneratorController;
    const chat = Chat.from([{ role: "user", content: "hi" }]);

    await generate(controller, chat);

    expect(fragments).toEqual(["hello"]);
    expect(requestBody).toMatchObject({
      model: "model-a",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.25,
      max_tokens: 2048,
      stream: true,
    });
    expect(toOpenAIMessages(chat)).toEqual([{ role: "user", content: "hi" }]);
  });
});
