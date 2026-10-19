/** The API VS Code gives a webview's page, which can be asked for once. */
type VsCodeApi = { postMessage: (message: unknown) => void }
declare function acquireVsCodeApi(): VsCodeApi

/** The way to talk to the VS Code extension that embeds this page, or undefined on any other page. */
export const vscode: VsCodeApi | undefined = 'acquireVsCodeApi' in window ? acquireVsCodeApi() : undefined
