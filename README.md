# OpenAI-Compatible Generator

OpenAI-compatible generator companion for `dandyarise/context-compactor`.

LM Studio hides every plugin that registers a generator from the Integrations list and presents it
as a model instead. Keeping this generator in a separate artifact lets
`dandyarise/context-compactor` remain an activatable compaction integration while
`dandyarise/openai-compatible-generator` appears in the model selector.

## Installation

```powershell
Set-Location D:\Github\mcp\context-bridge-external
lms dev --install -y
```

Select `dandyarise/openai-compatible-generator` in the model picker, then open the chat configuration
tab (sliders icon). Enter the exact `/v1/models` ID and the plugin-wide endpoint and optional Bearer
key shown in the same panel. If the model field is empty and the endpoint advertises exactly one
model, it is selected automatically; if several are returned, generation stops with an error
listing the available IDs instead of silently choosing the wrong model.

Enable `dandyarise/context-compactor` as an integration and configure the same endpoint, model ID, and
optional API key there so token accounting matches generation.

## Verification

```powershell
pnpm install
pnpm run verify
lms dev --no-notify
```
