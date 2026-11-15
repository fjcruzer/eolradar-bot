import type { EolClient } from "./client";
import { EolApiError } from "./errors";
import { resolveService } from "./match";
import type { BotMessage } from "./message";
import { parseCommand } from "./parse";
import {
  presentAmbiguous,
  presentApiError,
  presentHelp,
  presentNoMatch,
  presentService,
  presentServiceList,
  presentUpcoming,
} from "./present";

/** Run one `/eol` invocation against the API client. Slack and Teams both call this. */
export async function runCommand(text: string, client: EolClient): Promise<BotMessage> {
  try {
    const command = parseCommand(text);
    switch (command.type) {
      case "list":
        return presentServiceList(await client.listServices());
      case "help":
        return presentHelp(command.reason);
      case "upcoming":
        return presentUpcoming(await client.upcoming(), command.window);
      case "service": {
        const index = await client.listServices();
        const resolved = resolveService(command.query, index.services);
        if (resolved.type === "none") return presentNoMatch(command.query, resolved.suggestions);
        if (resolved.type === "ambiguous") {
          return presentAmbiguous(command.query, resolved.matches, resolved.total);
        }
        return presentService(await client.getService(resolved.service.slug));
      }
    }
  } catch (error) {
    if (error instanceof EolApiError) return presentApiError(error);
    throw error;
  }
}
