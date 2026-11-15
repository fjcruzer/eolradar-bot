import { describe, expect, it } from "vitest";
import { verifySlackSignature } from "../src/slack/verify";

const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
const TIMESTAMP = "1531420618";
const BODY =
  "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U0LAN0Z89&user_name=steph&command=%2Fweather&text=94070&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F6173845432%2Fabcdefg&trigger_id=1234.5678.abcd";
/** Independent HMAC-SHA256 from Python's hmac, not from the implementation under test. */
const SIGNATURE = "v0=7c68483cb346f24535807e7b39cd9d60e2b494796539865327ff97ad151926b9";
const NOW = Number(TIMESTAMP) * 1000;

describe("verifySlackSignature", () => {
  it("accepts Slack's signing basestring", async () => {
    await expect(
      verifySlackSignature({
        secret: SECRET,
        timestamp: TIMESTAMP,
        signature: SIGNATURE,
        body: BODY,
        nowMs: NOW,
      }),
    ).resolves.toBe(true);
  });

  it("rejects a tampered body, a wrong secret, and a stale timestamp", async () => {
    await expect(
      verifySlackSignature({
        secret: SECRET,
        timestamp: TIMESTAMP,
        signature: SIGNATURE,
        body: `${BODY}&x=1`,
        nowMs: NOW,
      }),
    ).resolves.toBe(false);
    await expect(
      verifySlackSignature({
        secret: "other-secret",
        timestamp: TIMESTAMP,
        signature: SIGNATURE,
        body: BODY,
        nowMs: NOW,
      }),
    ).resolves.toBe(false);
    await expect(
      verifySlackSignature({
        secret: SECRET,
        timestamp: TIMESTAMP,
        signature: SIGNATURE,
        body: BODY,
        nowMs: NOW + 6 * 60 * 1000,
      }),
    ).resolves.toBe(false);
  });
});
