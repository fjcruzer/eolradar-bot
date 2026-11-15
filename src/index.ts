import { handleBotRequest, runConfiguredDigest } from "./app";
import { cloudflareHttpCache } from "./cloudflare-cache";
import { createEolClient } from "./core/client";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    console.log(JSON.stringify({ message: "request", method: request.method, path: url.pathname }));
    return handleBotRequest(request, {
      signingSecret: asString(env.SLACK_SIGNING_SECRET),
      createClient: () =>
        createEolClient({
          baseUrl: env.EOL_API_BASE,
          cache: cloudflareHttpCache(),
        }),
    });
  },

  async scheduled(controller, env): Promise<void> {
    console.log(
      JSON.stringify({
        message: "digest_start",
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      }),
    );
    try {
      const token = asString(env.SLACK_BOT_TOKEN);
      const result = await runConfiguredDigest({
        eolApiBase: env.EOL_API_BASE,
        cache: cloudflareHttpCache(),
        channel: asString(env.SLACK_DIGEST_CHANNEL),
        services: asString(env.DIGEST_SERVICES),
        token,
      });
      console.log(JSON.stringify({ message: "digest_finished", ...result, cron: controller.cron }));
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "digest_failed",
          cron: controller.cron,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;

/** Secrets are strings in generated types, and absent at runtime until `wrangler secret put`. */
function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
