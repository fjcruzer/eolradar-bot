import type { BotMessage, Span } from "./message";

/** Slack Block Kit limits: section mrkdwn is 3000 characters, a message is 50 blocks. */
const SECTION_TEXT_LIMIT = 2900;
const MAX_SECTION_BLOCKS = 40;
const HEADER_LIMIT = 150;

export interface SlackPlainText {
  type: "plain_text";
  text: string;
  emoji: true;
}

export interface SlackMrkdwn {
  type: "mrkdwn";
  text: string;
}

export interface SlackButton {
  type: "button";
  text: SlackPlainText;
  url: string;
  action_id: string;
}

export type SlackBlock =
  | { type: "header"; text: SlackPlainText }
  | { type: "section"; text: SlackMrkdwn }
  | { type: "context"; elements: SlackMrkdwn[] }
  | { type: "divider" }
  | { type: "actions"; elements: SlackButton[] };

export interface SlackView {
  text: string;
  blocks: SlackBlock[];
}

export function toBlockKit(message: BotMessage): SlackView {
  const blocks: SlackBlock[] = [];
  if (message.title) {
    blocks.push({
      type: "header",
      text: { type: "plain_text", text: clip(message.title, HEADER_LIMIT), emoji: true },
    });
  }
  if (message.subtitle) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: escapeMrkdwn(message.subtitle) }],
    });
  }

  const sections = chunkLines(message.paragraphs.map((paragraph) => lineToMrkdwn(paragraph)));
  const visible = sections.slice(0, MAX_SECTION_BLOCKS);
  for (const text of visible) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text } });
  }
  if (sections.length > visible.length) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_The rest of this list was shortened. Open EOL Radar for the full set._",
      },
    });
  }

  if (message.links.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "actions",
      elements: message.links.slice(0, 5).map((link, index) => ({
        type: "button",
        text: { type: "plain_text", text: clip(link.label, 75), emoji: true },
        url: link.url,
        action_id: `link_${index}`,
      })),
    });
  }

  return {
    text: clip(message.fallbackText, 3000),
    blocks: blocks.slice(0, 50),
  };
}

function lineToMrkdwn(spans: readonly Span[]): string {
  if (spans.length === 0) return "";
  return spans.map((span) => spanToMrkdwn(span)).join("");
}

function spanToMrkdwn(span: Span): string {
  if (span.kind === "strong") return `*${escapeMrkdwn(span.text)}*`;
  if (span.kind === "code") return `\`${escapeMrkdwn(span.text)}\``;
  if (span.kind === "link") return `<${span.url}|${escapeMrkdwn(span.text)}>`;
  return escapeMrkdwn(span.text);
}

export function escapeMrkdwn(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function chunkLines(lines: readonly string[]): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  const flush = (): void => {
    if (current.length === 0) return;
    const text = current.join("\n").trim();
    if (text.length > 0) chunks.push(text);
    current = [];
    length = 0;
  };
  for (const line of lines) {
    const addition = line.length + (current.length > 0 ? 1 : 0);
    if (current.length > 0 && length + addition > SECTION_TEXT_LIMIT) flush();
    if (line.length > SECTION_TEXT_LIMIT) {
      flush();
      for (let offset = 0; offset < line.length; offset += SECTION_TEXT_LIMIT) {
        const slice = line.slice(offset, offset + SECTION_TEXT_LIMIT).trim();
        if (slice.length > 0) chunks.push(slice);
      }
      continue;
    }
    current.push(line);
    length += addition;
  }
  flush();
  return chunks;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
