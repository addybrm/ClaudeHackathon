export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
/** Live Claude features need credentials; without them the app runs a clearly labelled demo mode. */
export const liveAiAvailable = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
