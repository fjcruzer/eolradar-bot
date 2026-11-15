/**
 * Platform-neutral message. Slack renders it as Block Kit.
 * A Teams adapter can render the same document as an Adaptive Card.
 */

export type Span =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; url: string };

export interface MessageLink {
  url: string;
  label: string;
}

export interface BotMessage {
  fallbackText: string;
  title?: string;
  subtitle?: string;
  /** Each entry is one visual line. An empty array is a blank line. */
  paragraphs: Span[][];
  links: MessageLink[];
}

export function createMessage(input: {
  title?: string;
  subtitle?: string;
  paragraphs: Span[][];
  links?: MessageLink[];
}): BotMessage {
  const links = input.links ?? [];
  const lines: string[] = [];
  if (input.title) lines.push(input.title);
  if (input.subtitle) lines.push(input.subtitle);
  for (const paragraph of input.paragraphs) {
    lines.push(paragraph.length === 0 ? "" : spansToPlain(paragraph));
  }
  for (const link of links) lines.push(`${link.label}: ${link.url}`);
  const message: BotMessage = {
    fallbackText: lines.join("\n").replace(/^\n+|\n+$/g, ""),
    paragraphs: input.paragraphs,
    links,
  };
  if (input.title !== undefined) message.title = input.title;
  if (input.subtitle !== undefined) message.subtitle = input.subtitle;
  return message;
}

export function spansToPlain(spans: readonly Span[]): string {
  return spans
    .map((span) => (span.kind === "link" ? `${span.text} (${span.url})` : span.text))
    .join("");
}
