import { describe, expect, it } from "vitest";
import { parseCommand } from "../src/core/parse";

describe("parseCommand", () => {
  it("lists services when the command has no arguments", () => {
    expect(parseCommand("")).toEqual({ type: "list" });
    expect(parseCommand("   ")).toEqual({ type: "list" });
    expect(parseCommand("services")).toEqual({ type: "list" });
    expect(parseCommand("LIST")).toEqual({ type: "list" });
  });

  it("defaults upcoming to 90 days and accepts 30 and 180", () => {
    expect(parseCommand("upcoming")).toEqual({ type: "upcoming", window: 90 });
    expect(parseCommand("UPCOMING 30")).toEqual({ type: "upcoming", window: 30 });
    expect(parseCommand("upcoming 180")).toEqual({ type: "upcoming", window: 180 });
  });

  it("rejects an unknown upcoming window", () => {
    expect(parseCommand("upcoming 7")).toMatchObject({ type: "help" });
    expect(parseCommand("upcoming 90 eks")).toMatchObject({ type: "help" });
  });

  it("treats everything else as a service query, including help", () => {
    expect(parseCommand("help")).toEqual({ type: "help" });
    expect(parseCommand("eks")).toEqual({ type: "service", query: "eks" });
    expect(parseCommand("  rds-postgres  ")).toEqual({ type: "service", query: "rds-postgres" });
    expect(parseCommand("Amazon RDS for PostgreSQL")).toEqual({
      type: "service",
      query: "Amazon RDS for PostgreSQL",
    });
  });
});
