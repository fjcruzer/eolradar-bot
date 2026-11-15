/** Public EOL Radar JSON API, schema version 1. https://eolradar.dev/api/ */

export const SUPPORTED_SCHEMA_VERSION = "1";

export const UPCOMING_WINDOWS = [30, 90, 180] as const;
export type UpcomingWindow = (typeof UPCOMING_WINDOWS)[number];

export type SupportStatus = "standard" | "extended" | "ended" | "unknown";

export type SupportEvent = "standard_support_end" | "extended_support_end";

export interface ServiceSummary {
  slug: string;
  name: string;
  provider: string;
  category: string;
  page_url: string;
  last_updated: string;
}

export interface ServiceVersion {
  version: string;
  release_date: string | null;
  standard_support_end: string | null;
  extended_support_end: string | null;
  status: SupportStatus;
  source_url: string;
}

export interface ServiceIndex {
  schema_version: typeof SUPPORTED_SCHEMA_VERSION;
  generated_at: string;
  services: ServiceSummary[];
}

export interface ServiceDetail extends ServiceSummary {
  schema_version: typeof SUPPORTED_SCHEMA_VERSION;
  generated_at: string;
  versions: ServiceVersion[];
}

export interface UpcomingItem {
  date: string;
  event: SupportEvent;
  slug: string;
  name: string;
  provider: string;
  category: string;
  version: string;
  page_url: string;
  source_url: string;
}

export interface UpcomingFeed {
  schema_version: typeof SUPPORTED_SCHEMA_VERSION;
  generated_at: string;
  windows: Record<`${UpcomingWindow}`, UpcomingItem[]>;
}

export function isUpcomingWindow(value: string): value is `${UpcomingWindow}` {
  return value === "30" || value === "90" || value === "180";
}
