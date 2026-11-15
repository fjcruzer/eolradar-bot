import { isUpcomingWindow, type UpcomingWindow } from "./types";

export type SlashCommand =
  | { type: "list" }
  | { type: "help"; reason?: string }
  | { type: "upcoming"; window: UpcomingWindow }
  | { type: "service"; query: string };

const LIST_WORDS = new Set(["", "list", "services"]);

/** Parse the text that follows `/eol`. */
export function parseCommand(text: string): SlashCommand {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (LIST_WORDS.has(trimmed.toLowerCase())) return { type: "list" };
  if (trimmed.toLowerCase() === "help") return { type: "help" };

  const [head, ...rest] = trimmed.split(" ");
  if (head?.toLowerCase() === "upcoming") {
    if (rest.length === 0) return { type: "upcoming", window: 90 };
    const windowText = rest[0] ?? "";
    if (rest.length > 1 || !isUpcomingWindow(windowText)) {
      return {
        type: "help",
        reason: "Usage: /eol upcoming, or /eol upcoming 30, 90, or 180.",
      };
    }
    const window: UpcomingWindow = windowText === "30" ? 30 : windowText === "90" ? 90 : 180;
    return { type: "upcoming", window };
  }

  return { type: "service", query: trimmed };
}
