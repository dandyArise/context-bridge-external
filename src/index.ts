import type { PluginContext } from "@lmstudio/sdk";
import { configSchematics, globalConfigSchematics } from "./config";
import { generate } from "./generator";

export function main(context: PluginContext): Promise<void> {
  context
    .withGlobalConfigSchematics(globalConfigSchematics)
    .withConfigSchematics(configSchematics)
    .withGenerator(generate);
  return Promise.resolve();
}
