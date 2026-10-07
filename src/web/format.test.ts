import { describe, expect, it } from "vitest";
import { formatCost, formatElapsed, formatTime, formatTokens } from "./format";

describe("formatCost", () => {
  it("uses 4 decimals under a dollar", () => {
    expect(formatCost(0)).toBe("$0.0000");
    expect(formatCost(0.0123)).toBe("$0.0123");
    expect(formatCost(0.999)).toBe("$0.9990");
  });

  it("uses 2 decimals from $1 up", () => {
    expect(formatCost(1)).toBe("$1.00");
    expect(formatCost(1.234)).toBe("$1.23");
    expect(formatCost(12.5)).toBe("$12.50");
  });
});

describe("formatTokens", () => {
  it("passes small counts through", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("compacts thousands", () => {
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(123456)).toBe("123k");
  });

  it("compacts millions", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
    expect(formatTokens(3_400_000)).toBe("3.4M");
    expect(formatTokens(123_456_789)).toBe("123M");
  });
});

describe("formatElapsed", () => {
  it("clamps negative durations to 00:00", () => {
    expect(formatElapsed(-5)).toBe("00:00");
  });

  it("formats mm:ss below an hour", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(59_000)).toBe("00:59");
    expect(formatElapsed(61_000)).toBe("01:01");
    expect(formatElapsed(3_599_000)).toBe("59:59");
  });

  it("switches to h:mm:ss past an hour", () => {
    expect(formatElapsed(3_600_000)).toBe("1:00:00");
    expect(formatElapsed(3_661_000)).toBe("1:01:01");
  });
});

describe("formatTime", () => {
  it("renders local HH:MM:SS", () => {
    // Constructed in local time, so the assertion holds in any timezone.
    const ts = new Date(2026, 0, 2, 3, 4, 5).getTime();
    expect(formatTime(ts)).toBe("03:04:05");
    const late = new Date(2026, 5, 15, 23, 59, 9).getTime();
    expect(formatTime(late)).toBe("23:59:09");
  });
});
