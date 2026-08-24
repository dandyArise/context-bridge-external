import type { Chat, ChatMessage } from "@lmstudio/sdk";

export interface ExternalConnection {
  endpoint: string;
  apiKey: string;
}

export class ExternalApiError extends Error {
  public constructor(
    message: string,
    public readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ExternalApiError";
  }
}

export function normalizeEndpoint(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch (error) {
    throw new ExternalApiError(
      "External endpoint is not a valid URL.",
      undefined,
      {
        cause: error,
      },
    );
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new ExternalApiError(
      "External endpoint must use http:// or https://.",
    );
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new ExternalApiError(
      "External endpoint must not contain credentials, a query string, or a fragment.",
    );
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

export function chatEndpoint(connection: ExternalConnection): URL {
  return new URL("chat/completions", normalizeEndpoint(connection.endpoint));
}

export function modelsEndpoint(connection: ExternalConnection): URL {
  return new URL("models", normalizeEndpoint(connection.endpoint));
}

export function requestHeaders(connection: ExternalConnection): Headers {
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  if (connection.apiKey.trim() !== "") {
    headers.set("Authorization", `Bearer ${connection.apiKey.trim()}`);
  }
  return headers;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export async function listExternalModelIds(
  connection: ExternalConnection,
  signal?: AbortSignal,
): Promise<string[]> {
  const response = await fetch(modelsEndpoint(connection), {
    headers: requestHeaders(connection),
    ...(signal === undefined ? {} : { signal }),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new ExternalApiError(
      "Model discovery returned invalid JSON.",
      response.status,
      {
        cause: error,
      },
    );
  }
  if (!response.ok) {
    throw new ExternalApiError(
      `Model discovery failed with HTTP ${response.status}.`,
      response.status,
    );
  }
  const root = asObject(body);
  const data = Array.isArray(root?.data) ? root.data : [];
  const ids = data.flatMap((entry) => {
    const id = asObject(entry)?.id;
    return typeof id === "string" && id.trim() !== "" ? [id.trim()] : [];
  });
  if (ids.length === 0) {
    throw new ExternalApiError("Model discovery returned no model IDs.");
  }
  return [...new Set(ids)];
}

export function toOpenAIMessages(history: Chat | ChatMessage[]): unknown[] {
  const messages = Array.isArray(history)
    ? history
    : history.getMessagesArray();
  const output: unknown[] = [];
  for (const message of messages) {
    switch (message.getRole()) {
      case "system":
      case "user":
        output.push({ role: message.getRole(), content: message.getText() });
        break;
      case "assistant": {
        const toolCalls = message.getToolCallRequests().map((call) => ({
          id: call.id ?? "",
          type: "function",
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments ?? {}),
          },
        }));
        output.push({
          role: "assistant",
          content: message.getText(),
          ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
        });
        break;
      }
      case "tool":
        output.push(
          ...message.getToolCallResults().map((result) => ({
            role: "tool",
            tool_call_id: result.toolCallId ?? "",
            content: String(result.content),
          })),
        );
        break;
    }
  }
  return output;
}
