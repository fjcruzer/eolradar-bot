import type { EolApiError } from "./errors";
import { createMessage, type Span } from "./message";
import type {
  ServiceDetail,
  ServiceIndex,
  ServiceSummary,
  ServiceVersion,
  SupportEvent,
  SupportStatus,
  UpcomingFeed,
  UpcomingItem,
  UpcomingWindow,
} from "./types";

const STATUS_LABEL: Record<SupportStatus, string> = {
  standard: "Standard support",
  extended: "Extended support",
  ended: "Ended",
  unknown: "Unknown",
};

const EVENT_LABEL: Record<SupportEvent, string> = {
  standard_support_end: "standard support ends",
  extended_support_end: "extended support ends",
};

const PROVIDER_ORDER = ["AWS", "Google Cloud", "Azure"];

const ATTRIBUTION =
  "Dates from EOL Radar. Confirm with the provider before you plan an upgrade.";

export function presentServiceList(index: ServiceIndex): ReturnType<typeof createMessage> {
  const paragraphs: Span[][] = [];
  for (const [provider, services] of groupByProvider(index.services)) {
    paragraphs.push([{ kind: "strong", text: provider }]);
    for (const service of services) {
      paragraphs.push([
        { kind: "link", text: service.name, url: service.page_url },
        { kind: "text", text: " (" },
        { kind: "code", text: service.slug },
        { kind: "text", text: `) — ${service.category}` },
      ]);
    }
    paragraphs.push([]);
  }
  return createMessage({
    title: "EOL Radar services",
    subtitle: `${index.services.length} services · /eol <name> or /eol upcoming`,
    paragraphs,
    links: [{ url: "https://eolradar.dev/", label: "EOL Radar" }],
  });
}

export function presentService(detail: ServiceDetail): ReturnType<typeof createMessage> {
  const paragraphs: Span[][] = [];
  for (const version of detail.versions) {
    paragraphs.push(versionHeadline(version), versionDates(version), []);
  }
  const links = [{ url: detail.page_url, label: "Open on EOL Radar" }];
  const source = uniqueSource(detail.versions);
  if (source && source !== detail.page_url) {
    links.push({ url: source, label: "Provider documentation" });
  }
  return createMessage({
    title: detail.name,
    subtitle: `${detail.provider} · ${detail.category} · generated ${formatGeneratedAt(detail.generated_at)}`,
    paragraphs,
    links,
  });
}

export function presentUpcoming(
  feed: UpcomingFeed,
  window: UpcomingWindow,
): ReturnType<typeof createMessage> {
  const items = feed.windows[`${window}`];
  return createMessage({
    title: `Ending within ${window} days`,
    subtitle: upcomingSubtitle(feed.generated_at, items),
    paragraphs: upcomingParagraphs(items, "Nothing in this window."),
    links: [{ url: "https://eolradar.dev/", label: "EOL Radar" }],
  });
}

export function presentDigest(
  feed: UpcomingFeed,
  slugs: readonly string[] | null,
  knownSlugs: ReadonlySet<string>,
): ReturnType<typeof createMessage> {
  const filtered = filterUpcoming(feed.windows["90"], slugs, knownSlugs);
  const paragraphs: Span[][] = [];
  if (slugs !== null) {
    paragraphs.push([
      { kind: "text", text: `Tracked services: ${slugs.join(", ")}` },
    ]);
  }
  if (filtered.unknownSlugs.length > 0) {
    paragraphs.push([
      {
        kind: "text",
        text: `Not in the EOL Radar index: ${filtered.unknownSlugs.join(", ")}`,
      },
    ]);
  }
  if (paragraphs.length > 0) paragraphs.push([]);
  const empty =
    slugs === null
      ? "Nothing hits end of support in the next 90 days."
      : "Nothing in the tracked services hits end of support in the next 90 days.";
  paragraphs.push(...upcomingParagraphs(filtered.items, empty));
  return createMessage({
    title: "Weekly EOL Radar digest",
    subtitle: upcomingSubtitle(feed.generated_at, filtered.items),
    paragraphs,
    links: [{ url: "https://eolradar.dev/", label: "EOL Radar" }],
  });
}

export function presentAmbiguous(
  query: string,
  matches: readonly ServiceSummary[],
  total: number,
): ReturnType<typeof createMessage> {
  const paragraphs: Span[][] = [
    [{ kind: "text", text: `Several services match "${query}". Pick a slug:` }],
  ];
  for (const service of matches) {
    paragraphs.push([
      { kind: "link", text: service.name, url: service.page_url },
      { kind: "text", text: " — " },
      { kind: "code", text: `/eol ${service.slug}` },
    ]);
  }
  if (total > matches.length) {
    paragraphs.push([
      {
        kind: "text",
        text: `And ${total - matches.length} more. Try a more specific name.`,
      },
    ]);
  }
  return createMessage({ title: "EOL Radar", paragraphs });
}

export function presentNoMatch(
  query: string,
  suggestions: readonly ServiceSummary[],
): ReturnType<typeof createMessage> {
  const paragraphs: Span[][] = [
    [{ kind: "text", text: `No service matches "${query}".` }],
  ];
  if (suggestions.length > 0) {
    paragraphs.push([{ kind: "text", text: "Did you mean:" }]);
    for (const service of suggestions) {
      paragraphs.push([
        { kind: "link", text: service.name, url: service.page_url },
        { kind: "text", text: " — " },
        { kind: "code", text: `/eol ${service.slug}` },
      ]);
    }
  } else {
    paragraphs.push([{ kind: "text", text: "Try /eol to list services." }]);
  }
  return createMessage({ title: "EOL Radar", paragraphs });
}

export function presentHelp(reason?: string): ReturnType<typeof createMessage> {
  const paragraphs: Span[][] = [];
  if (reason) paragraphs.push([{ kind: "text", text: reason }], []);
  paragraphs.push(
    [{ kind: "code", text: "/eol" }, { kind: "text", text: " — list services" }],
    [
      { kind: "code", text: "/eol eks" },
      { kind: "text", text: " — versions, support dates, and status" },
    ],
    [
      { kind: "code", text: "/eol upcoming" },
      { kind: "text", text: " — ending within 90 days" },
    ],
    [
      { kind: "code", text: "/eol upcoming 30" },
      { kind: "text", text: " — also 90 or 180" },
    ],
  );
  return createMessage({
    title: "EOL Radar",
    subtitle: ATTRIBUTION,
    paragraphs,
    links: [{ url: "https://eolradar.dev/api/", label: "API docs" }],
  });
}

export function presentApiError(error: EolApiError): ReturnType<typeof createMessage> {
  const text: Record<EolApiError["kind"], string> = {
    network: "EOL Radar could not be reached. Try again in a few minutes.",
    http: "EOL Radar returned an error. Try again in a few minutes.",
    not_found: "EOL Radar has no data for that service.",
    schema: "EOL Radar changed its data format. This bot needs an update.",
    invalid: "EOL Radar returned data this bot could not read.",
  };
  return createMessage({
    title: "EOL Radar",
    paragraphs: [[{ kind: "text", text: text[error.kind] }]],
    links: [{ url: "https://eolradar.dev/", label: "EOL Radar" }],
  });
}

export function filterUpcoming(
  items: readonly UpcomingItem[],
  slugs: readonly string[] | null,
  knownSlugs: ReadonlySet<string>,
): { items: UpcomingItem[]; unknownSlugs: string[] } {
  if (slugs === null) return { items: [...items], unknownSlugs: [] };
  const wanted = new Set(slugs.map((slug) => slug.toLowerCase()));
  const unknownSlugs = [...wanted].filter((slug) => !knownSlugs.has(slug)).sort();
  return {
    items: items.filter((item) => wanted.has(item.slug)),
    unknownSlugs,
  };
}

function upcomingParagraphs(items: readonly UpcomingItem[], emptyText: string): Span[][] {
  if (items.length === 0) return [[{ kind: "text", text: emptyText }]];
  const paragraphs: Span[][] = [];
  let previousDate = "";
  for (const item of items) {
    if (item.date !== previousDate) {
      if (previousDate !== "") paragraphs.push([]);
      paragraphs.push([{ kind: "strong", text: item.date }]);
      previousDate = item.date;
    }
    paragraphs.push([
      {
        kind: "link",
        text: `${item.name} ${item.version} — ${EVENT_LABEL[item.event]}`,
        url: item.page_url,
      },
    ]);
  }
  return paragraphs;
}

function upcomingSubtitle(generatedAt: string, items: readonly UpcomingItem[]): string {
  const parts = [`As of ${formatGeneratedAt(generatedAt)}`, ATTRIBUTION];
  if (items.some((item) => /^\d{4}-\d{2}$/.test(item.date))) {
    parts.splice(1, 0, "A month with no day means the last day of that month.");
  }
  return parts.join(" ");
}

function versionHeadline(version: ServiceVersion): Span[] {
  return [
    { kind: "strong", text: version.version },
    { kind: "text", text: ` — ${STATUS_LABEL[version.status]}` },
  ];
}

function versionDates(version: ServiceVersion): Span[] {
  return [
    {
      kind: "text",
      text: `Standard support end: ${formatDate(version.standard_support_end)} · Extended support end: ${formatDate(version.extended_support_end)}`,
    },
  ];
}

function formatDate(value: string | null): string {
  return value ?? "not published";
}

function formatGeneratedAt(value: string): string {
  return value.replace("T", " ").replace(/\.\d+Z$/, " UTC").replace(/Z$/, " UTC");
}

function uniqueSource(versions: readonly ServiceVersion[]): string | undefined {
  const urls = new Set(versions.map((version) => version.source_url));
  if (urls.size !== 1) return undefined;
  return versions[0]?.source_url;
}

function groupByProvider(
  services: readonly ServiceSummary[],
): Array<[string, ServiceSummary[]]> {
  const groups = new Map<string, ServiceSummary[]>();
  for (const service of services) {
    const list = groups.get(service.provider) ?? [];
    list.push(service);
    groups.set(service.provider, list);
  }
  const providers = [...groups.keys()].sort((a, b) => {
    const aIndex = PROVIDER_ORDER.indexOf(a);
    const bIndex = PROVIDER_ORDER.indexOf(b);
    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
  return providers.map((provider) => [provider, groups.get(provider) ?? []]);
}
