import { afterEach, describe, expect, it, vi } from "vitest";
import deployment from "../../vercel.json";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("production deployment", () => {
  it("keeps production cookies on the frontend origin even with a legacy API URL", async () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("VITE_API_URL", "https://legacy-api.invalid");
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([])));
    vi.stubGlobal("fetch", fetch);
    const { api } = await import("@/lib/api");
    await api.assignments();
    expect(fetch).toHaveBeenCalledWith(
      "/api/assignments",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("preserves API paths and excludes static assets from the SPA fallback", () => {
    expect(deployment.rewrites[0]).toMatchObject({
      source: "/api/:path*",
      destination: expect.stringMatching(/^https:\/\/[^/]+\/api\/:path\*$/),
    });
    const fallback = new RegExp(`^${deployment.rewrites[1]!.source}$`);
    for (const path of ["/", "/dang-nhap", "/de-bai", "/phien-hoc", "/tien-trinh"]) {
      expect(fallback.test(path)).toBe(true);
    }
    for (const path of [
      "/api",
      "/api/auth/refresh",
      "/assets/app.js",
      "/assets/missing",
      "/favicon.ico",
      "/robots.txt",
    ]) {
      expect(fallback.test(path)).toBe(false);
    }
    expect(deployment.headers[0]!.headers).toContainEqual({
      key: "Cache-Control",
      value: "private, no-store",
    });
  });
});
