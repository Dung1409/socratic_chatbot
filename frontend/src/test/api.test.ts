import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, request, type Session } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());

describe("FastAPI client", () => {
  it("explains connection failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api.assignments()).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining("FastAPI"),
    });
  });
  it("preserves validation and conflict messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: "Phiên đã thay đổi" }), { status: 409 }),
        ),
    );
    await expect(request("/sessions/one")).rejects.toEqual(new ApiError("Phiên đã thay đổi", 409));
  });
  it("sends session version and stable request identifier to FastAPI", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: 4 })));
    vi.stubGlobal("fetch", fetch);
    await api.message({ id: "one", version: 3 } as Session, "Câu trả lời của em", "retry-key");
    expect(fetch).toHaveBeenCalledWith(
      "/api/sessions/one/messages",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Câu trả lời của em",
          expected_version: 3,
          client_message_id: "retry-key",
        }),
      }),
    );
  });
});
