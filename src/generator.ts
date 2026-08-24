import type { Chat, GeneratorController } from "@lmstudio/sdk";
import { configSchematics, globalConfigSchematics } from "./config";
import {
  ExternalApiError,
  chatEndpoint,
  requestHeaders,
  toOpenAIMessages,
  type ExternalConnection,
} from "./externalApi";

type JsonObject = Record<string, unknown>;

interface ToolCallState {
  id: string;
  name: string;
  arguments: string;
  started: boolean;
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

export async function* parseSse(response: Response): AsyncGenerator<unknown> {
  if (response.body === null) {
    throw new ExternalApiError("Generation returned no response body.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "" || data === "[DONE]") continue;
      try {
        yield JSON.parse(data) as unknown;
      } catch (error) {
        throw new ExternalApiError(
          "Generation stream contained malformed JSON.",
          undefined,
          { cause: error },
        );
      }
    }
    if (done) break;
  }
}

function toolPayload(ctl: GeneratorController): unknown[] | undefined {
  const tools = ctl.getToolDefinitions().map((tool) => ({
    type: "function",
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters ?? {},
    },
  }));
  return tools.length === 0 ? undefined : tools;
}

function parseToolArguments(state: ToolCallState): Record<string, unknown> {
  if (state.arguments.trim() === "") return {};
  let value: unknown;
  try {
    value = JSON.parse(state.arguments) as unknown;
  } catch (error) {
    throw new ExternalApiError(
      `Tool "${state.name}" returned malformed arguments.`,
      undefined,
      { cause: error },
    );
  }
  const object = asObject(value);
  if (object === undefined) {
    throw new ExternalApiError(
      `Tool "${state.name}" arguments were not a JSON object.`,
    );
  }
  return object;
}

async function consumeStream(
  response: Response,
  ctl: GeneratorController,
): Promise<void> {
  const states = new Map<number, ToolCallState>();
  let thinking = false;
  let textBuffer = "";

  const emitContent = (fragment: string) => {
    textBuffer += fragment;
    while (textBuffer !== "") {
      if (!thinking) {
        const start = textBuffer.indexOf("<think>");
        if (start < 0) {
          ctl.fragmentGenerated(textBuffer);
          textBuffer = "";
          return;
        }
        if (start > 0) ctl.fragmentGenerated(textBuffer.slice(0, start));
        textBuffer = textBuffer.slice(start + 7);
        thinking = true;
      } else {
        const end = textBuffer.indexOf("</think>");
        if (end < 0) {
          ctl.fragmentGenerated(textBuffer, { reasoningType: "reasoning" });
          textBuffer = "";
          return;
        }
        if (end > 0) {
          ctl.fragmentGenerated(textBuffer.slice(0, end), {
            reasoningType: "reasoning",
          });
        }
        textBuffer = textBuffer.slice(end + 8);
        thinking = false;
      }
    }
  };

  for await (const chunk of parseSse(response)) {
    const root = asObject(chunk);
    const choices = Array.isArray(root?.choices) ? root.choices : [];
    const choice = asObject(choices[0]);
    const delta = asObject(choice?.delta);
    if (delta === undefined) continue;
    const reasoning =
      typeof delta.reasoning_content === "string"
        ? delta.reasoning_content
        : typeof delta.reasoning === "string"
          ? delta.reasoning
          : undefined;
    if (reasoning !== undefined) {
      ctl.fragmentGenerated(reasoning, { reasoningType: "reasoning" });
    }
    if (typeof delta.content === "string") emitContent(delta.content);

    const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const rawCall of calls) {
      const call = asObject(rawCall);
      if (call === undefined) continue;
      const index = typeof call.index === "number" ? call.index : 0;
      const fn = asObject(call.function);
      let state = states.get(index);
      if (state === undefined) {
        state = {
          id: typeof call.id === "string" ? call.id : `call-${index}`,
          name: "",
          arguments: "",
          started: false,
        };
        states.set(index, state);
      }
      if (!state.started) {
        ctl.toolCallGenerationStarted({ toolCallId: state.id });
        state.started = true;
      }
      if (typeof fn?.name === "string" && fn.name !== "") {
        state.name += fn.name;
        ctl.toolCallGenerationNameReceived(fn.name);
      }
      if (typeof fn?.arguments === "string" && fn.arguments !== "") {
        state.arguments += fn.arguments;
        ctl.toolCallGenerationArgumentFragmentGenerated(fn.arguments);
      }
    }
  }

  for (const state of states.values()) {
    try {
      if (state.name === "") {
        throw new ExternalApiError(
          "A streamed tool call had no function name.",
        );
      }
      ctl.toolCallGenerationEnded({
        type: "function",
        id: state.id,
        name: state.name,
        arguments: parseToolArguments(state),
      });
    } catch (error) {
      ctl.toolCallGenerationFailed(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}

export async function generate(
  ctl: GeneratorController,
  history: Chat,
): Promise<void> {
  const config = ctl.getPluginConfig(configSchematics);
  const globalConfig = ctl.getGlobalPluginConfig(globalConfigSchematics);
  const connection: ExternalConnection = {
    endpoint: globalConfig.get("externalEndpoint"),
    apiKey: globalConfig.get("externalApiKey"),
  };
  const model = config.get("externalModel").trim();
  const controller = new AbortController();
  ctl.onAborted(() => controller.abort());
  const tools = toolPayload(ctl);
  const payload = {
    ...(model === "" ? {} : { model }),
    messages: toOpenAIMessages(history),
    temperature: config.get("temperature"),
    max_tokens: config.get("maxOutputTokens"),
    stream: true,
    ...(tools === undefined ? {} : { tools }),
  };
  const response = await fetch(chatEndpoint(connection), {
    method: "POST",
    headers: requestHeaders(connection),
    body: JSON.stringify(payload),
    signal: controller.signal,
  });
  if (!response.ok) {
    const text = (await response.text()).slice(0, 2000);
    throw new ExternalApiError(
      `External generation failed with HTTP ${response.status}: ${text}`,
      response.status,
    );
  }
  await consumeStream(response, ctl);
}
