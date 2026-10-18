import { expect, it } from "vitest";
import { safeReturnTo } from "@/lib/auth-redirect";

it("keeps an exact session destination and rejects external/auth destinations", () => {
  expect(safeReturnTo("/phien-hoc?session=abc&item=def")).toBe("/phien-hoc?session=abc&item=def");
  for (const value of [
    "//evil.example",
    "https://evil.example",
    "/\\evil.example",
    "/dang-nhap",
    "javascript:alert(1)",
    undefined,
  ])
    expect(safeReturnTo(value)).toBe("/");
});
