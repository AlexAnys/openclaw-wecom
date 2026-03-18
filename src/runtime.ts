/**
 * Plugin runtime store — same pattern as feishu/src/runtime.ts.
 */

export interface WeComPluginRuntime {
  channel: {
    text: {
      chunkMarkdownText: (text: string, limit: number) => string[];
      convertMarkdownTables: (text: string, mode: string) => string;
      resolveMarkdownTableMode: (params: {
        cfg: unknown;
        channel: string;
      }) => string;
    };
  };
}

let _runtime: WeComPluginRuntime | null = null;

export function setWeComRuntime(runtime: WeComPluginRuntime): void {
  _runtime = runtime;
}

export function getWeComRuntime(): WeComPluginRuntime {
  if (!_runtime) {
    throw new Error("WeCom runtime not initialized");
  }
  return _runtime;
}
