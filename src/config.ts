import { createConfigSchematics } from "@lmstudio/sdk";

export const globalConfigSchematics = createConfigSchematics()
  .field(
    "externalEndpoint",
    "string",
    {
      displayName: "External OpenAI-compatible endpoint",
      subtitle: "Base URL including /v1.",
      placeholder: "http://127.0.0.1:8000/v1",
    },
    "http://127.0.0.1:8000/v1",
  )
  .field(
    "externalApiKey",
    "string",
    {
      displayName: "External API key (optional)",
      subtitle:
        "Sent only as a Bearer token and stored by LM Studio as a protected value.",
      isProtected: true,
      placeholder: "Leave empty for an unauthenticated local endpoint",
    },
    "",
  )
  .build();

export const configSchematics = createConfigSchematics()
  .field(
    "externalModel",
    "string",
    {
      displayName: "External model (optional)",
      subtitle:
        "Exact /v1/models ID. Empty lets the provider choose its default model.",
      placeholder: "Qwen/Qwen3-32B",
    },
    "",
  )
  .field(
    "temperature",
    "numeric",
    {
      displayName: "Temperature",
      min: 0,
      max: 2,
      step: 0.05,
      precision: 2,
      slider: { min: 0, max: 2, step: 0.05 },
    },
    0.7,
  )
  .field(
    "maxOutputTokens",
    "numeric",
    {
      displayName: "Maximum output tokens",
      int: true,
      min: 128,
      max: 262144,
      step: 128,
    },
    8192,
  )
  .build();
