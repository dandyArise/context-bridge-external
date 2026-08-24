import { Chat, type GeneratorController } from "@lmstudio/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chatEndpoint,
  listExternalModelIds,
  modelsEndpoint,
  normalizeEndpoint,
  requestHeaders,
  toOpenAIMessages,
} from "../src/externalApi";
import { generate, parseSse, resolveExternalModel } from "../src/generator";

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
    expect(modelsEndpoint(connection).href).toBe(
      "http://127.0.0.1:8000/v1/models",
    );
    expect(requestHeaders(connection).get("Authorization")).toBe(
      "Bearer test-secret",
    );
    expect(() => normalizeEndpoint("https://secret@example.test/v1")).toThrow(
      /credentials/i,
    );
  });

  it("uses a configured model without a discovery request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveExternalModel(" model-a ", {
        endpoint: "http://provider.test/v1",
        apiKey: "",
      }),
    ).resolves.toBe("model-a");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("discovers a sole external model and requires a choice when several exist", async () => {
    const connection = {
      endpoint: "http://provider.test/v1",
      apiKey: "test-secret",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ data: [{ id: "model-only" }] }))
        .mockResolvedValueOnce(
          Response.json({ data: [{ id: "model-a" }, { id: "model-b" }] }),
        ),
    );

    await expect(resolveExternalModel("", connection)).resolves.toBe(
      "model-only",
    );
    await expect(resolveExternalModel("", connection)).rejects.toThrow(
      /Model ID.*model-a.*model-b/,
    );
  });

  it("rejects malformed model discovery responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ data: [{ name: "missing-id" }] })),
    );
    await expect(
      listExternalModelIds({
        endpoint: "http://provider.test/v1",
        apiKey: "",
      }),
    ).rejects.toThrow(/no model IDs/i);
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
      externalEndpoint: "http://chat-provider.test/v1",
      externalApiKey: "chat-secret",
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
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      new URL("http://chat-provider.test/v1/chat/completions"),
    );
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization"),
    ).toBe("Bearer chat-secret");
    expect(toOpenAIMessages(chat)).toEqual([{ role: "user", content: "hi" }]);
  });
});
