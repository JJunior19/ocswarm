import { describe, expect, it } from "vitest";
import { withSession } from "./open";

describe("withSession", () => {
  it("appends the session deep link to a bare dashboard url", () => {
    expect(withSession("http://localhost:4096", "ses_123")).toBe(
      "http://localhost:4096/?session=ses_123",
    );
  });

  it("never doubles the slash on a trailing-slash url", () => {
    expect(withSession("http://localhost:4096/", "ses_123")).toBe(
      "http://localhost:4096/?session=ses_123",
    );
  });
});
