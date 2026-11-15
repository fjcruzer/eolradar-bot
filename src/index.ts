import { cloudflareHttpCache } from "./cloudflare-cache";
import { createEolClient } from "./core/client";
import { runDigestJob } from "./digest-job";
import { postSlackMessage } from "./slack/api";
import { handleSlackCommand } from "./slack/command";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    try {
      console.log(
        JSON.stringify({ message: "request", method: request.method, path: url.pathname }),
      );
      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json({ ok: true });
      }
      if (url.pathname === "/slack/commands") {
        return handleSlackCommand(request, {
          signingSecret: asString(env.SLACK_SIGNING_SECRET),
          client: createEolClient({
            baseUrl: env.EOL_API_BASE,
            cache: cloudflareHttpCache(),
          }),
        });
      }
      return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "request_failed",
          path: url.pathname,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return new Response("Internal error", {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      });
    }
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
      const result = await runDigestJob({
        client: createEolClient({
          baseUrl: env.EOL_API_BASE,
          cache: cloudflareHttpCache(),
        }),
        channel: asString(env.SLACK_DIGEST_CHANNEL),
        services: asString(env.DIGEST_SERVICES),
        token,
        post: (channel, message) => postSlackMessage({ token, channel, message }),
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
