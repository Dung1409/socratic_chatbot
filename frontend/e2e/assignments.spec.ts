import { expect, test } from "@playwright/test";

test("assignment modal validates, preserves drafts, saves without starting, and supports responsive study states", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/dang-ky");
  await page.getByLabel("Tên hiển thị").fill("Bạn học Ngữ văn");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill(`assignments-${Date.now()}@example.com`);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Strong test password 123");
  await page.getByLabel("Xác nhận mật khẩu", { exact: true }).fill("Strong test password 123");
  await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Hôm nay em sẽ suy nghĩ sâu hơn một bậc." }),
  ).toBeVisible();
  await page.goto("/de-bai");
  await expect(page.getByRole("heading", { name: "Bắt đầu với đề bài đầu tiên" })).toBeVisible();
  const create = page.getByRole("button", { name: "Tạo đề bài", exact: true });
  await create.click();
  const dialog = page.getByRole("dialog", { name: "Tạo đề bài mới" });
  const title = dialog.getByRole("textbox", { name: "Tên đề", exact: true });
  const prompt = dialog.getByRole("textbox", { name: "Nội dung đề", exact: true });
  await expect(title).toBeFocused();
  await dialog.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await expect(title).toBeFocused();
  await expect(dialog.getByText("Nội dung đề cần ít nhất 15 ký tự.")).toBeVisible();
  const firstTitle = "Đọc sách và suy nghĩ độc lập";
  const firstPrompt =
    "Phân tích vai trò của tư duy phản biện khi đọc sách và liên hệ với trải nghiệm của em.";
  await title.fill(firstTitle);
  await prompt.fill(firstPrompt);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(create).toBeFocused();
  await create.click();
  await expect(title).toHaveValue(firstTitle);
  await expect(prompt).toHaveValue(firstPrompt);

  const upload = dialog.getByLabel("Chọn tệp đề bài");
  await upload.setInputFiles({
    name: "anh.png",
    mimeType: "image/png",
    buffer: Buffer.from("image"),
  });
  await expect(dialog.getByRole("alert")).toContainText("PDF, DOCX hoặc TXT");
  await upload.setInputFiles({
    name: "lon.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(dialog.getByRole("alert")).toContainText("vượt quá 10 MB");
  await upload.setInputFiles({
    name: "trong.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(0),
  });
  await expect(dialog.getByRole("alert")).toContainText("Tệp đang trống");
  await upload.setInputFiles({
    name: "ngu-lieu.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Đọc sách giúp ta mở rộng góc nhìn, nhưng cần tự suy nghĩ và kiểm chứng thông tin.",
    ),
  });
  await expect(dialog.getByText("Đã trích xuất văn bản.", { exact: false })).toBeVisible();
  await expect(title).toHaveValue(firstTitle);
  await expect(prompt).toHaveValue(firstPrompt);
  await dialog.getByText("Xem văn bản từ tài liệu", { exact: true }).click();
  await dialog.getByRole("button", { name: "Dùng làm ngữ liệu" }).click();
  await dialog.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await dialog.getByLabel("Dạng bài").selectOption("reading");
  await dialog.getByLabel("Khối lớp", { exact: false }).selectOption("11");
  await expect(dialog.getByLabel("Ngữ liệu / đoạn trích liên quan")).toHaveValue(
    /Đọc sách giúp ta/,
  );

  await page.route("**/api/assignments", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 503, json: { detail: "Chưa lưu được đề, vui lòng thử lại." } });
    } else await route.continue();
  });
  await dialog.getByRole("button", { name: "Lưu đề bài", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Chưa lưu được đề");
  await expect(dialog.getByLabel("Dạng bài")).toHaveValue("reading");
  await page.unroute("**/api/assignments");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/assignments", async (route) => {
    if (route.request().method() === "POST") await gate;
    await route.continue();
  });
  await dialog.getByRole("button", { name: "Lưu đề bài", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Đang lưu…", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).toBeHidden();
  await page.unroute("**/api/assignments");
  await expect(page).toHaveURL(/\/de-bai$/);
  await expect(
    page.getByRole("article", { name: firstTitle }).getByRole("link", { name: "Bắt đầu học" }),
  ).toBeVisible();
  expect(await (await page.request.get("/api/sessions")).json()).toEqual([]);
  expect(await (await page.request.get("/api/assignments")).json()).toHaveLength(1);

  await create.click();
  await title.fill("Nghị luận xã hội: Tài năng và nỗ lực");
  await prompt.fill(
    "Trình bày quan điểm về mối quan hệ giữa tài năng, nỗ lực và thành công trong cuộc sống.",
  );
  await dialog.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await dialog.getByLabel("Khối lớp", { exact: false }).selectOption("12");
  await dialog.getByRole("button", { name: "Lưu & bắt đầu học" }).click();
  await expect(
    page.getByRole("heading", { name: "Nghị luận xã hội: Tài năng và nỗ lực" }),
  ).toBeVisible();
  const sessionsBefore = await (await page.request.get("/api/sessions")).json();
  expect(sessionsBefore).toHaveLength(1);
  await page.goto("/de-bai");
  await expect(page.getByRole("link", { name: "Tiếp tục học" })).toBeVisible();
  await page.getByRole("link", { name: "Tiếp tục học" }).click();
  await expect(
    page.getByRole("heading", { name: "Nghị luận xã hội: Tài năng và nỗ lực" }),
  ).toBeVisible();
  expect((await (await page.request.get("/api/sessions")).json())[0].id).toBe(sessionsBefore[0].id);
  await page.goto("/de-bai");

  await page.getByRole("button", { name: "Chưa học 1", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Hoàn thành 0", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Không tìm thấy đề bài phù hợp" })).toBeVisible();
  await page.getByRole("button", { name: "Xóa bộ lọc" }).click();
  await page.getByRole("searchbox").fill("doc sach");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: firstTitle })).toBeVisible();
  await page.getByRole("button", { name: "Xóa tìm kiếm" }).click();
  await expect(page.getByRole("article")).toHaveCount(2);

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 640 ? 700 : 900 });
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width === 390 || width === 1440)
      await page.screenshot({ path: `../artifacts/assignments-${width}.png`, fullPage: true });
    await create.click();
    await title.fill(firstTitle);
    await prompt.fill(firstPrompt);
    for (const step of [1, 2]) {
      if (step === 2) await dialog.getByRole("button", { name: "Tiếp tục", exact: true }).click();
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(width < 640 ? 700 : 900);
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      const footerAction = dialog.getByRole("button", {
        name: step === 1 ? "Tiếp tục" : "Lưu & bắt đầu học",
        exact: true,
      });
      await expect(footerAction).toBeInViewport();
      if (width === 390 || width === 1440)
        await page.screenshot({
          path: `../artifacts/assignment-modal-${width}-step-${step}.png`,
          fullPage: true,
        });
    }
    await dialog.getByRole("button", { name: "Quay lại" }).click();
    await page.keyboard.press("Escape");
    await expect(create).toBeFocused();
    if (width < 1024) {
      await page.getByRole("button", { name: "Mở menu" }).click();
      await expect(page.getByRole("dialog", { name: "Menu SocraVăn" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Mở menu" })).toBeFocused();
    }
  }
  // Delay only the read request so the real loading skeleton can be inspected.
  let releaseRead!: () => void;
  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  await page.route("**/api/assignments", async (route) => {
    await readGate;
    await route.continue();
  });
  await page.reload();
  await expect(page.getByRole("status", { name: "Đang tải đề bài" })).toBeVisible();
  releaseRead();
  await expect(page.getByRole("article")).toHaveCount(2);
  await page.unroute("**/api/assignments");
  await page.route("**/api/assignments", (route) =>
    route.fulfill({ status: 503, json: { detail: "Tạm thời không tải được danh sách đề bài." } }),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Tạm thời không tải được", {
    timeout: 15000,
  });
  await page.unroute("**/api/assignments");
  await page.getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  expect(errors).toEqual([]);
});
