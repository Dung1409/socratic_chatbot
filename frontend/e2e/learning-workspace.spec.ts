import { expect, test, type Page } from "@playwright/test";

async function createSession(page: Page, title: string) {
  await page.goto("/dang-ky");
  await page.getByLabel("Tên hiển thị").fill("Bạn học Socratic");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill(`workspace-${Date.now()}@example.com`);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Strong test password 123");
  await page.getByLabel("Xác nhận mật khẩu", { exact: true }).fill("Strong test password 123");
  await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bài học của tôi" })).toBeVisible();
  const csrf = await (await page.request.get("/api/auth/csrf")).json();
  const response = await page.request.post("/api/assignments", {
    headers: { "X-CSRF-Token": csrf.csrf_token },
    data: {
      title,
      prompt:
        "Em hãy bàn về mối quan hệ giữa tài năng, nỗ lực và thành công. Dùng dẫn chứng để làm rõ suy nghĩ của em. ".repeat(
          18,
        ),
      source_text:
        "Mỗi người đều có thể tiến bộ khi kiên trì học hỏi và biết lắng nghe những góc nhìn khác.\n".repeat(
          40,
        ),
      task_type: "social",
      grade: 11,
    },
  });
  expect(response.status()).toBe(201);
  const assignment = await response.json();
  await page.goto(`/phien-hoc?assignment=${assignment.id}`);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole("log").locator("li")).toHaveCount(1);
  await expect(page.getByText("Đã lưu đề bài. Đang mở phiên học…", { exact: true })).toBeHidden({
    timeout: 8000,
  });
}

for (const adaptive of [false, true]) {
  test.describe(adaptive ? "adaptive workspace" : "historical template workspace", () => {
    test.use({ baseURL: adaptive ? "http://127.0.0.1:8012" : "http://127.0.0.1:8011" });
    test("keeps drafts, ordered history and request identity while resizing and collapsing panels", async ({
      page,
    }) => {
      test.setTimeout(120000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let aiRequests = 0;
      page.on("request", (request) => {
        if (request.method() === "POST" && /\/api\/sessions(?:\/|$)/.test(request.url()))
          aiRequests++;
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      const title = adaptive ? "Tài năng, nỗ lực và những góc nhìn" : "Tự học: Tài năng và nỗ lực";
      await createSession(page, title);
      const answer = page.getByRole("textbox", { name: "Suy nghĩ của em", exact: true });
      const send = page.getByRole("button", { name: "Gửi câu trả lời", exact: true });
      const history = page.getByRole("region", { name: "Lịch sử hội thoại", exact: true });
      await expect(send).toBeDisabled();
      await expect(answer).toHaveAttribute("placeholder", "Viết suy nghĩ của em tại đây...");
      expect(
        (await page.getByRole("complementary", { name: "Thanh điều hướng" }).boundingBox())!.width,
      ).toBe(248);
      expect(
        (await page.getByRole("complementary", { name: "Thông tin học tập" }).boundingBox())!.width,
      ).toBeCloseTo(345.6, 1);
      const initialRequests = aiRequests;
      const draft =
        "Em cho rằng nỗ lực giúp con người phát triển tài năng qua việc rèn luyện mỗi ngày.";
      await answer.fill(draft);
      const desktopPanel = page.getByRole("complementary", { name: "Thông tin học tập" });
      await expect(desktopPanel.getByRole("tab", { name: "Đề bài", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      const expand = desktopPanel.getByRole("button", { name: "Xem đầy đủ", exact: true });
      await expect(expand).toBeVisible();
      const promptId = (await expand.getAttribute("aria-controls"))!;
      const prompt = page.locator(`[id="${promptId}"]`);
      const collapsedHeight = (await prompt.boundingBox())!.height;
      await expand.click();
      expect((await prompt.boundingBox())!.height).toBeGreaterThan(collapsedHeight);
      await desktopPanel.getByRole("button", { name: "Thu gọn đề bài", exact: true }).click();
      await expect(prompt).toHaveCSS("font-size", "16px");
      await expect(desktopPanel.getByText("Ngữ liệu / đoạn trích", { exact: true })).toBeVisible();
      await desktopPanel.getByRole("tab", { name: "Hành trình", exact: true }).click();
      await expect(
        desktopPanel.getByRole("heading", { name: "Hành trình suy nghĩ", exact: true }),
      ).toBeVisible();
      await desktopPanel.getByRole("tab", { name: "Đề bài", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      await expect(
        desktopPanel.getByRole("tab", { name: "Hành trình", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("ArrowLeft");
      await expect(desktopPanel.getByRole("tab", { name: "Đề bài", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(answer).toHaveValue(draft);
      await page.getByRole("button", { name: "Đóng thông tin học tập", exact: true }).click();
      await page.getByRole("button", { name: "Thu gọn thanh điều hướng", exact: true }).click();
      expect(
        (await page.getByRole("complementary", { name: "Thanh điều hướng" }).boundingBox())!.width,
      ).toBe(64);
      await expect(answer).toHaveValue(draft);
      await page.getByRole("button", { name: "Mở rộng thanh điều hướng", exact: true }).click();
      await page.getByRole("button", { name: "Mở thông tin học tập", exact: true }).click();
      expect(aiRequests).toBe(initialRequests);

      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let posted = 0;
      await page.route("**/api/sessions/*/messages", async (route) => {
        posted++;
        await gate;
        await route.continue();
      });
      await send.evaluate((element) => {
        (element as HTMLButtonElement).click();
        (element as HTMLButtonElement).click();
      });
      await expect(answer).toBeDisabled();
      await expect(send).toBeDisabled();
      await expect.poll(() => posted).toBe(1);
      release();
      await expect(answer).toHaveValue("");
      await expect(
        page.getByRole("article", { name: "Câu trả lời của em", exact: true }),
      ).toHaveCount(1);
      await page.unroute("**/api/sessions/*/messages");

      await page.getByRole("button", { name: "Xin gợi ý", exact: true }).click();
      const hint = page.getByRole("article", {
        name: adaptive ? "Gợi ý bổ sung" : "Gợi ý mức 1 · Định hướng",
        exact: true,
      });
      await expect(hint).toBeVisible();
      const sessions = await (await page.request.get("/api/sessions")).json();
      const saved = sessions[0];
      expect(saved.turns.map((turn: { kind: string }) => turn.kind)).toEqual(
        await page
          .getByRole("log")
          .locator(":scope > li")
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute("data-turn-kind")),
          ),
      );
      if (adaptive) {
        expect(saved.support_events).toHaveLength(1);
        await expect(hint.getByText(/Gợi ý mức/)).toHaveCount(0);
        await hint.getByText("Chi tiết gợi ý", { exact: true }).click();
        await expect(
          hint.getByText("Lượt hỗ trợ này được ghi nhận trong đánh giá cuối phiên."),
        ).toBeVisible();
        await hint.getByText("Chi tiết gợi ý", { exact: true }).click();
      }
      for (const [width, panelWidth] of [
        [1280, 340],
        [1440, 345.6],
        [1600, 400],
        [1920, 420],
        [2560, 420],
      ]) {
        await page.setViewportSize({ width: width!, height: 1000 });
        expect((await desktopPanel.boundingBox())!.width).toBeCloseTo(panelWidth!, 1);
        const group = (await page.locator(".learning-workspace").boundingBox())!;
        expect(group.width).toBeLessThanOrEqual(1360);
        expect(group.x - 248).toBeCloseTo((width! - 248 - group.width) / 2, 1);
        const chat = (await page
          .getByRole("region", { name: "Không gian học cùng Trợ lý ảo" })
          .boundingBox())!;
        expect((await desktopPanel.boundingBox())!.x - (chat.x + chat.width)).toBeCloseTo(24, 1);
        await expect(send).toBeInViewport();
        if (width === 1920)
          await page.screenshot({
            path: `../artifacts/learning-balanced-${adaptive ? "adaptive" : "template"}-1920.png`,
          });
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({
        path: `../artifacts/learning-${adaptive ? "adaptive" : "template"}-desktop.png`,
      });

      const retryText =
        "Em muốn bổ sung rằng cơ hội và môi trường cũng ảnh hưởng đến khả năng thành công.";
      await answer.fill(retryText);
      const keys: string[] = [];
      await page.route("**/api/sessions/*/messages", async (route) => {
        keys.push(route.request().postDataJSON().client_message_id);
        await route.abort("failed");
      });
      await answer.press("Control+Enter");
      const error = page.locator(".learning-composer").getByRole("alert");
      await expect(error).toBeVisible();
      await expect(answer).toHaveValue(retryText);
      await page.unroute("**/api/sessions/*/messages");
      await page.route("**/api/sessions/*/messages", async (route) => {
        keys.push(route.request().postDataJSON().client_message_id);
        await route.continue();
      });
      await error.getByRole("button", { name: "Thử lại", exact: true }).click();
      await expect(answer).toHaveValue("");
      expect(keys).toHaveLength(2);
      expect(keys[0]).toBe(keys[1]);
      await page.unroute("**/api/sessions/*/messages");
      await answer.fill(draft);
      const requestsBeforeLayout = aiRequests;

      for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        await expect(answer).toHaveValue(draft);
        await expect(send).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(
          await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1),
        ).toBe(true);
        if (width < 1280) {
          if (width >= 768)
            expect(
              (await page.getByRole("complementary", { name: "Thanh điều hướng" }).boundingBox())!
                .width,
            ).toBe(248);
          await page.getByRole("button", { name: "Mở thông tin học tập", exact: true }).click();
          const panel = page.getByRole("dialog", { name: "Thông tin học tập", exact: true });
          await expect(panel.getByRole("tab", { name: "Đề bài", exact: true })).toBeVisible();
          await panel.getByRole("tab", { name: "Hành trình", exact: true }).click();
          await expect(
            panel.getByRole("heading", { name: "Hành trình suy nghĩ", exact: true }),
          ).toBeVisible();
          await panel.getByRole("tab", { name: "Đề bài", exact: true }).click();
          await page.keyboard.press("Escape");
          await expect(panel).toBeHidden();
          await expect(answer).toHaveValue(draft);
          await expect(
            page.getByRole("button", { name: "Mở thông tin học tập", exact: true }),
          ).toBeFocused();
        }
        await page
          .locator(".learning-session-header")
          .getByRole("button", { name: "Xem đề bài", exact: true })
          .click();
        const source = page.getByRole("dialog", { name: "Đề bài của em", exact: true });
        await expect(
          source.getByRole("heading", { name: "Ngữ liệu / đoạn trích", exact: true }),
        ).toBeVisible();
        expect(await source.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        );
        await page.keyboard.press("Escape");
        await expect(source).toBeHidden();
        if (width === 390)
          await page.screenshot({
            path: `../artifacts/learning-${adaptive ? "adaptive" : "template"}-mobile.png`,
          });
      }
      expect(aiRequests).toBe(requestsBeforeLayout);

      await page.setViewportSize({ width: 390, height: 460 });
      await answer.fill(
        Array.from(
          { length: 20 },
          (_, index) => `Ý ${index + 1}: em sẽ kiểm chứng bằng dẫn chứng.`,
        ).join("\n"),
      );
      expect((await answer.boundingBox())!.height).toBeLessThanOrEqual(200);
      expect((await answer.boundingBox())!.height).toBeGreaterThanOrEqual(40);
      await expect(send).toBeInViewport();
      expect(await history.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
        true,
      );
      await history.evaluate((element) => {
        element.scrollTop = 0;
      });
      await expect(page.getByRole("button", { name: "Cuối hội thoại", exact: true })).toBeVisible();
      await expect(send).toBeInViewport();
      await page.getByRole("button", { name: "Cuối hội thoại", exact: true }).click();
      await answer.fill(draft);
      // Simulate the smaller visual viewport exposed by a phone keyboard.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => {
        if (!window.visualViewport) throw new Error("VisualViewport is required for this test");
        Object.defineProperty(window.visualViewport, "height", {
          configurable: true,
          get: () => 300,
        });
        window.visualViewport.dispatchEvent(new Event("resize"));
      });
      const sendBox = (await send.boundingBox())!;
      const inputBox = (await answer.boundingBox())!;
      expect(sendBox.y + sendBox.height).toBeLessThanOrEqual(300);
      expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(300);
      await expect(answer).toHaveValue(draft);
      await page.evaluate(() => {
        delete (window.visualViewport as unknown as { height?: number }).height;
        window.visualViewport?.dispatchEvent(new Event("resize"));
      });
      await page.reload();
      await expect(answer).toHaveValue(draft);
      expect((await (await page.request.get("/api/sessions")).json())[0].id).toBe(saved.id);
      if (adaptive) {
        await page
          .getByRole("button", { name: "Kết thúc đối thoại & tổng hợp", exact: true })
          .click();
      } else {
        let current = (await (await page.request.get("/api/sessions")).json())[0];
        // Historical template length comes from the saved session, never a UI constant.
        while (!current.done) {
          await answer.fill(
            "Em tìm dẫn chứng cụ thể và đối chiếu với quan điểm để giải thích rõ lập luận của mình.",
          );
          await send.click();
          await expect(page.locator("#learning-answer")).toHaveValue("");
          current = (await (await page.request.get("/api/sessions")).json())[0];
        }
      }
      const essay = page.getByRole("textbox", { name: "Bài làm cuối phiên", exact: true });
      const submit = page.getByRole("button", {
        name: adaptive ? "Hoàn thành & xem báo cáo" : "Lưu bài viết & hoàn thành",
        exact: true,
      });
      await expect(essay).toBeVisible();
      await expect(submit).toBeDisabled();
      const essayDraft =
        "Em cho rằng tài năng, nỗ lực và hoàn cảnh cần được xem xét cùng nhau. Dẫn chứng cụ thể giúp nhận định trở nên thuyết phục hơn.";
      await essay.fill(essayDraft);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        await expect(submit).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(
          await page
            .locator(".learning-composer")
            .evaluate((element) => element.scrollWidth <= element.clientWidth),
        ).toBe(true);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await expect(essay).toHaveValue(essayDraft);
      if (adaptive) {
        await page.getByRole("button", { name: "Tiếp tục đối thoại", exact: true }).click();
        await expect(answer).toHaveValue(draft);
      }
      expect(errors).toEqual([]);
    });
  });
}
