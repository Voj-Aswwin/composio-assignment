// Whether the agent has any Notion tools to use.
import tools from "./tools/index.js";

export const notionConnected = () => tools.some((t) => t.app === "notion");
