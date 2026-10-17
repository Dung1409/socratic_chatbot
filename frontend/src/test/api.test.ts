import { afterEach, describe, expect, it, vi } from "vitest";
import { api, authApi, ApiError, clearAuthState, request, type Session } from "@/lib/api";

afterEach(() => {
  clearAuthState();
  vi.unstubAllGlobals();
});

describe("FastAPI client", () => {
  it("sends cookies and a session-bound CSRF header without an Authorization bearer token", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            user: { id: "user", email: "user@example.com", display_name: "User" },
            csrf_token: "csrf-one",
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([])));
    vi.stubGlobal("fetch", fetch);
    await authApi.login("user@example.com", "password");
    await api.createAssignment({
      title: "Đề riêng",
      prompt: "Nội dung đề đủ dài để luyện tập.",
      target: 4,
    });
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/assignments",
      expect.objectContaining({
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf-one" },
      }),
    );
  });
  it("refreshes expired access cookies and retries the original request once", async () => {
    const auth = {
      user: { id: "one", email: "one@example.com", display_name: "One" },
      csrf_token: "new-csrf",
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "expired" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: "expired" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrf_token: "new-csrf" })))
      .mockResolvedValueOnce(new Response(JSON.stringify(auth)))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "private" }])));
    vi.stubGlobal("fetch", fetch);
    await expect(api.assignments()).resolves.toEqual([{ id: "private" }]);
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      "/api/auth/refresh",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "X-CSRF-Token": "new-csrf" },
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(5);
  });
  it("waits for the background worker before returning extracted text", async () => {
    const extracted = { filename: "de.txt", title: "de", text: "Nội dung đề bài đủ dài." };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ document_id: "document-one", job_id: "job-one" }), {
          status: 202,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...extracted, status: "needs_review", error: null })),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(api.extract(new File(["test"], "de.txt"))).resolves.toEqual({
      ...extracted,
      document_id: "document-one",
    });
    expect(fetch).toHaveBeenLastCalledWith("/api/documents/document-one", expect.any(Object));
  });
  it("shows worker extraction failures instead of returning empty text", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ document_id: "one", job_id: "job-one" }), { status: 202 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: "failed", error: "Không đọc được tệp." })),
        ),
    );
    await expect(api.extract(new File(["test"], "de.pdf"))).rejects.toMatchObject({
      status: 422,
      message: "Không đọc được tệp.",
    });
  });
  it("supports synchronous extraction during local development", async () => {
    const extracted = { filename: "de.txt", title: "de", text: "Nội dung đề bài đủ dài." };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(extracted))));
    await expect(api.extract(new File(["test"], "de.txt"))).resolves.toEqual(extracted);
  });
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
