import { cacheTtlFromHeader, type HttpCache } from "./cache";
import { EolApiError } from "./errors";
import {
  SUPPORTED_SCHEMA_VERSION,
  type ServiceDetail,
  type ServiceIndex,
  type ServiceSummary,
  type ServiceVersion,
  type SupportEvent,
  type SupportStatus,
  type UpcomingFeed,
  type UpcomingItem,
} from "./types";

const USER_AGENT = "eolradar-bot (https://github.com/fjcruzer/eolradar-bot)";
const MAX_BODY_BYTES = 2_000_000;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}(?:-\d{2})?$/;

export interface EolClient {
  listServices(): Promise<ServiceIndex>;
  getService(slug: string): Promise<ServiceDetail>;
  upcoming(): Promise<UpcomingFeed>;
}

export interface EolClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  cache?: HttpCache;
}

export function createEolClient(options: EolClientOptions): EolClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const cache = options.cache;

  return {
    listServices: () =>
      getDocument(baseUrl, "/api/v1/services.json", parseServiceIndex, fetchImpl, cache),
    getService: (slug) => {
      if (!SLUG_PATTERN.test(slug)) {
        throw new EolApiError(`Invalid service slug "${slug}".`, "invalid");
      }
      return getDocument(
        baseUrl,
        `/api/v1/services/${slug}.json`,
        parseServiceDetail,
        fetchImpl,
        cache,
      );
    },
    upcoming: () =>
      getDocument(baseUrl, "/api/v1/upcoming.json", parseUpcomingFeed, fetchImpl, cache),
  };
}

export function parseServiceIndex(value: unknown): ServiceIndex {
  const record = requireEnvelope(value);
  const services = record["services"];
  if (!Array.isArray(services)) {
    throw new EolApiError("Service index is missing services.", "invalid");
  }
  return {
    schema_version: SUPPORTED_SCHEMA_VERSION,
    generated_at: readString(record, "generated_at"),
    services: services.map((entry) => parseServiceSummary(entry)),
  };
}

export function parseServiceDetail(value: unknown): ServiceDetail {
  const record = requireEnvelope(value);
  const versions = record["versions"];
  if (!Array.isArray(versions)) {
    throw new EolApiError("Service document is missing versions.", "invalid");
  }
  return {
    ...parseServiceSummary(record),
    schema_version: SUPPORTED_SCHEMA_VERSION,
    generated_at: readString(record, "generated_at"),
    versions: versions.map((entry) => parseVersion(entry)),
  };
}

export function parseUpcomingFeed(value: unknown): UpcomingFeed {
  const record = requireEnvelope(value);
  const windows = record["windows"];
  if (!isRecord(windows)) {
    throw new EolApiError("Upcoming document is missing windows.", "invalid");
  }
  return {
    schema_version: SUPPORTED_SCHEMA_VERSION,
    generated_at: readString(record, "generated_at"),
    windows: {
      "30": parseUpcomingList(windows["30"]),
      "90": parseUpcomingList(windows["90"]),
      "180": parseUpcomingList(windows["180"]),
    },
  };
}

async function getDocument<T>(
  baseUrl: string,
  path: string,
  parse: (value: unknown) => T,
  fetchImpl: typeof fetch,
  cache: HttpCache | undefined,
): Promise<T> {
  const url = `${baseUrl}${path}`;
  if (cache) {
    const cached = await cache.get(url);
    if (cached !== null) return parseJson(cached, parse);
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });
  } catch (cause) {
    throw new EolApiError("EOL Radar could not be reached.", "network", { cause });
  }

  const body = await readBody(response);
  if (response.status === 404) {
    throw new EolApiError("EOL Radar has no document at that path.", "not_found", {
      status: 404,
    });
  }
  if (!response.ok) {
    throw new EolApiError(`EOL Radar returned HTTP ${response.status}.`, "http", {
      status: response.status,
    });
  }

  const parsed = parseJson(body, parse);
  const ttl = cacheTtlFromHeader(response.headers.get("Cache-Control"));
  if (cache && ttl !== null && ttl > 0) {
    try {
      await cache.set(url, body, ttl);
    } catch (cause) {
      console.error(
        JSON.stringify({
          message: "cache_write_failed",
          url,
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    }
  }
  return parsed;
}

function parseJson<T>(body: string, parse: (value: unknown) => T): T {
  let value: unknown;
  try {
    value = JSON.parse(body) as unknown;
  } catch (cause) {
    throw new EolApiError("EOL Radar returned invalid JSON.", "invalid", { cause });
  }
  return parse(value);
}

async function readBody(response: Response): Promise<string> {
  const declared = response.headers.get("Content-Length");
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
    throw new EolApiError("EOL Radar response is too large.", "invalid");
  }
  const body = await response.text();
  if (body.length > MAX_BODY_BYTES) {
    throw new EolApiError("EOL Radar response is too large.", "invalid");
  }
  return body;
}

function normalizeBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new EolApiError(`EOL_API_BASE is not a URL: ${baseUrl}`, "invalid");
  }
  if (url.protocol !== "https:") {
    throw new EolApiError("EOL_API_BASE must use https.", "invalid");
  }
  return url.origin + url.pathname.replace(/\/$/, "");
}

function requireEnvelope(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new EolApiError("EOL Radar document is not an object.", "invalid");
  }
  if (value["error"] === "not_found") {
    throw new EolApiError("EOL Radar has no document at that path.", "not_found");
  }
  const schema = value["schema_version"];
  if (schema !== SUPPORTED_SCHEMA_VERSION) {
    throw new EolApiError(
      `EOL Radar schema_version is ${JSON.stringify(schema)}; this bot supports "${SUPPORTED_SCHEMA_VERSION}".`,
      "schema",
    );
  }
  if (typeof value["generated_at"] !== "string" || value["generated_at"].length === 0) {
    throw new EolApiError("EOL Radar document is missing generated_at.", "invalid");
  }
  return value;
}

function parseServiceSummary(value: unknown): ServiceSummary {
  const record = requireRecord(value, "service");
  return {
    slug: readString(record, "slug"),
    name: readString(record, "name"),
    provider: readString(record, "provider"),
    category: readString(record, "category"),
    page_url: readString(record, "page_url"),
    last_updated: readString(record, "last_updated"),
  };
}

function parseVersion(value: unknown): ServiceVersion {
  const record = requireRecord(value, "version");
  return {
    version: readString(record, "version"),
    release_date: readDate(record, "release_date"),
    standard_support_end: readDate(record, "standard_support_end"),
    extended_support_end: readDate(record, "extended_support_end"),
    status: readStatus(record["status"]),
    source_url: readString(record, "source_url"),
  };
}

function parseUpcomingList(value: unknown): UpcomingItem[] {
  if (!Array.isArray(value)) {
    throw new EolApiError("Upcoming window is not a list.", "invalid");
  }
  return value.map((entry) => {
    const record = requireRecord(entry, "upcoming item");
    return {
      date: readRequiredDate(record, "date"),
      event: readEvent(record["event"]),
      slug: readString(record, "slug"),
      name: readString(record, "name"),
      provider: readString(record, "provider"),
      category: readString(record, "category"),
      version: readString(record, "version"),
      page_url: readString(record, "page_url"),
      source_url: readString(record, "source_url"),
    };
  });
}

function readStatus(value: unknown): SupportStatus {
  if (value === "standard" || value === "extended" || value === "ended" || value === "unknown") {
    return value;
  }
  throw new EolApiError("Version status is not recognized.", "invalid");
}

function readEvent(value: unknown): SupportEvent {
  if (value === "standard_support_end" || value === "extended_support_end") return value;
  throw new EolApiError("Upcoming event is not recognized.", "invalid");
}

function readDate(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value === "string" && DATE_PATTERN.test(value)) return value;
  throw new EolApiError(`Field ${key} is not a date or null.`, "invalid");
}

function readRequiredDate(record: Record<string, unknown>, key: string): string {
  const value = readString(record, key);
  if (!DATE_PATTERN.test(value)) {
    throw new EolApiError(`Field ${key} is not a date.`, "invalid");
  }
  return value;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new EolApiError(`Field ${key} is missing.`, "invalid");
  }
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new EolApiError(`EOL Radar ${label} is not an object.`, "invalid");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
