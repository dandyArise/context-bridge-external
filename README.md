# Context Bridge External

OpenAI-compatible generator companion for `dandyarise/context-bridge`.

LM Studio hides every plugin that registers a generator from the Integrations list and presents it
as a model instead. Keeping this generator in a separate artifact lets
`dandyarise/context-bridge` remain an activatable compaction integration while this plugin appears
in the model selector.

## Installation

```powershell
Set-Location D:\Github\mcp\context-bridge-external
lms dev --install -y
```

Select `Context Bridge External` as the model and enable `dandyarise/context-bridge` as an integration.
Configure the same endpoint, model ID, and optional API key in both artifacts so token accounting
matches generation.

## Verification

```powershell
pnpm install
pnpm run verify
lms dev --no-notify
```
