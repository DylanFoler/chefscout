import Anthropic from "@anthropic-ai/sdk";

// True when no usable key is configured. Routes check this up front so the UI
// can show "add your key and restart" instead of a generic failure.
export const MISSING_KEY = !process.env.ANTHROPIC_API_KEY?.trim();

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Maps any thrown error to a user-facing message + HTTP status. Auth problems
// (missing/typo'd/rejected key) get a specific, actionable message; everything
// else gets a generic fallback so we never leak internals to the client.
export function toErrorResponse(err: unknown, fallback: string) {
  const isAuth =
    err instanceof Anthropic.AuthenticationError ||
    (err instanceof Anthropic.APIError && err.status === 401);
  if (isAuth) {
    return {
      body: {
        error:
          "API key rejected. Check ANTHROPIC_API_KEY in .env.local and restart the dev server.",
      },
      status: 401,
    };
  }
  return { body: { error: fallback }, status: 500 };
}

export const MISSING_KEY_MESSAGE =
  "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart `npm run dev`.";
