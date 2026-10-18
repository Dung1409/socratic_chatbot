import { expect, test, type Page } from "@playwright/test";

async function openInput(page: Page, upload = false) {
  await page.goto("/dang-ky");
  await page.getByLabel("Tên hiển thị").fill("Bạn học Ngữ văn");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill(`input-${Date.now()}@example.com`);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Strong test password 123");
  await page.getByLabel("Xác nhận mật khẩu", { exact: true }).fill("Strong test password 123");
  const registration = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/register"),
  );
  await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  expect((await registration).status()).toBe(201);
  await expect(
    page.getByRole("heading", { name: "Hôm nay em sẽ suy nghĩ sâu hơn một bậc." }),
  ).toBeVisible();
  await page.goto("/de-bai");
  if (upload) await page.getByRole("tab", { name: "Tải tài liệu", exact: true }).click();
}

async function serverDocument(page: Page, text: string) {
  const csrf = await (await page.request.get("/api/auth/csrf")).json();
  const response = await page.request.post("/api/documents/text", {
    headers: { "X-CSRF-Token": csrf.csrf_token },
    data: { title: "Tài liệu kiểm thử", text, mode: "single" },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

test("pasted task starts immediately without a title or parsing step and retains its draft", async ({
  page,
}) => {
  await openInput(page);
  const prompt = "Hãy phân tích vai trò của dẫn chứng trong bài nghị luận.";
  const materials = "Ngữ liệu đi kèm cần được giữ nguyên trong phiên học.";
  await expect(page.getByRole("tab", { name: "Nhập đề lẻ" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("button", { name: "Kiểm tra đề bài" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Tên đề", exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Em muốn học đề nào?" }).fill(prompt);
  await page.getByText("Thêm ngữ liệu", { exact: false }).click();
  await page
    .getByRole("textbox", { name: "Đoạn trích, bài thơ hoặc ngữ liệu liên quan" })
    .fill(materials);
  await page.getByRole("tab", { name: "Tải tài liệu", exact: true }).click();
  await page.getByRole("tab", { name: "Nhập đề lẻ", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Em muốn học đề nào?" })).toHaveValue(prompt);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Em muốn học đề nào?" })).toHaveValue(prompt);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width === 390 || width === 1440)
      await page.screenshot({ path: `../artifacts/quick-entry-${width}.png`, fullPage: true });
  }
  let submits = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/learning/quick-start"))
      submits++;
  });
  const result = page.waitForResponse((response) =>
    response.url().endsWith("/api/learning/quick-start"),
  );
  await page.getByRole("button", { name: "Bắt đầu học", exact: true }).click();
  const assignment = await (await result).json();
  expect(assignment.title).toBe(prompt);
  expect(assignment.items[0].prompt).toBe(prompt);
  expect(assignment.items[0].context).toContain(materials);
  await expect(page).toHaveURL(/phien-hoc\?assignment=/);
  expect(submits).toBe(1);
});

test("text file keeps shared material after editing and reopens the reviewed version from history", async ({
  page,
}) => {
  await openInput(page, true);
  const text =
    "I. ĐỌC HIỂU\nĐọc sách giúp chúng ta hiểu nhiều góc nhìn khác nhau.\nCâu 1. Nêu ý chính của văn bản.\nCâu 2. Em đồng tình với nhận định trên không? Vì sao?\nĐÁP ÁN\nKhông gửi lời giải này vào phiên học.";
  await page
    .getByLabel("Chọn tệp PDF, Word hoặc văn bản")
    .setInputFiles({ name: "de-doc-hieu.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
  await expect(page.getByRole("region", { name: "Chọn câu để học" })).toBeVisible();
  await expect(page.getByText("Chọn câu em muốn học.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Cảnh báo cần kiểm tra")).toBeVisible();
  await page.getByRole("checkbox", { name: "Chọn Câu 1", exact: true }).check();
  await page.getByText("Chỉnh sửa tài liệu", { exact: true }).click();
  await page.getByRole("button", { name: "Sửa bản tách" }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: /^Sửa yêu cầu/ })
    .fill("Giải thích ý chính của văn bản bằng lời của em.");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(
    page.getByText("Đã lưu bản đã kiểm tra vào lịch sử tài liệu", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByText(/^Lịch sử tài liệu ·/).click();
  await page.getByRole("button", { name: "Tiếp tục với tài liệu này" }).click();
  await expect(
    page.getByText("Giải thích ý chính của văn bản bằng lời của em.", { exact: true }).first(),
  ).toBeVisible();
  const request = page.waitForRequest(
    (item) => item.method() === "POST" && item.url().endsWith("/api/learning/assignments"),
  );
  await page.getByRole("button", { name: "Bắt đầu học" }).click();
  const context = (await request).postDataJSON().items[0].context;
  expect(context).toContain("Đọc sách giúp chúng ta hiểu nhiều góc nhìn khác nhau.");
  expect(context).not.toContain("Không gửi lời giải này");
});

test("reordering images invalidates the previous extraction and requires reading again", async ({
  page,
}) => {
  await openInput(page, true);
  let calls = 0;
  await page.route("**/api/uploads/extract-batch", async (route) => {
    calls++;
    const doc = await serverDocument(
      page,
      calls === 1 ? "Yêu cầu từ thứ tự ảnh ban đầu." : "Yêu cầu từ thứ tự ảnh đã thay đổi.",
    );
    await route.fulfill({ json: { combined: { ...doc, warnings: [] }, needs_confirmation: true } });
  });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  await page.getByLabel("Chọn ảnh tài liệu", { exact: true }).setInputFiles([
    { name: "first.png", mimeType: "image/png", buffer: png },
    { name: "second.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(page.getByRole("button", { name: /^Bắt đầu học/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Xác nhận thứ tự & đọc chữ" }).click();
  await expect(page.getByRole("button", { name: "Bắt đầu học" })).toBeEnabled();
  await page.getByText("Kiểm tra thứ tự trang · 2 ảnh", { exact: true }).click();
  await page.getByRole("button", { name: "Đưa ảnh 2 lên" }).click();
  await expect(page.getByRole("textbox", { name: "Văn bản đọc từ tài liệu" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Bắt đầu học/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Xác nhận thứ tự & đọc chữ" }).click();
  await expect(
    page.getByText("Yêu cầu từ thứ tự ảnh đã thay đổi.", { exact: true }).first(),
  ).toBeVisible();
  expect(calls).toBe(2);
});

test("reference document offers a direct choice instead of requiring a mode dropdown", async ({
  page,
}) => {
  await openInput(page, true);
  await page.getByLabel("Chọn tệp PDF, Word hoặc văn bản").setInputFiles({
    name: "tai-lieu.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Đọc sách mở ra nhiều góc nhìn và giúp mỗi người hiểu cuộc sống sâu sắc hơn.",
    ),
  });
  await expect(page.getByRole("region", { name: "Chọn cách học tài liệu" })).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nhập thêm yêu cầu" })).toBeVisible();
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width === 390 || width === 1440)
      await page.screenshot({ path: `../artifacts/document-entry-${width}.png`, fullPage: true });
  }
  const request = page.waitForRequest(
    (item) => item.method() === "POST" && item.url().endsWith("/api/learning/assignments"),
  );
  await page.getByRole("button", { name: "Học theo tài liệu", exact: true }).click();
  expect((await request).postDataJSON().items[0].metadata.source_only).toBe(true);
});

test("a reference document can become a specific task while keeping its material", async ({
  page,
}) => {
  await openInput(page, true);
  const materials = "Đọc sách mở ra nhiều góc nhìn và giúp mỗi người hiểu cuộc sống sâu sắc hơn.";
  await page.getByLabel("Chọn tệp PDF, Word hoặc văn bản").setInputFiles({
    name: "ngu-lieu.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(materials),
  });
  await expect(
    page.getByText("Tài liệu tham khảo · Chưa có câu hỏi", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Nhập thêm yêu cầu" }).click();
  const prompt = "Hãy giải thích lợi ích của việc đọc sách bằng lời của em.";
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: /^Sửa yêu cầu/ })
    .fill(prompt);
  await page.keyboard.press("Escape");
  const request = page.waitForRequest(
    (item) => item.method() === "POST" && item.url().endsWith("/api/learning/assignments"),
  );
  await page.getByRole("button", { name: "Bắt đầu học", exact: true }).click();
  const item = (await request).postDataJSON().items[0];
  expect(item.prompt).toBe(prompt);
  expect(item.context).toContain(materials);
  expect(item.metadata.source_only).toBe(false);
});

test("pending image document can be recovered after a page reload", async ({ page }) => {
  await openInput(page, true);
  const doc = await serverDocument(page, "Hãy phân tích vấn đề được nêu trong ảnh.");
  let ready = false;
  await page.route(`**/api/documents/${doc.document_id}`, async (route) => {
    if (ready) await route.continue();
    else
      await route.fulfill({ json: { ...doc, text: null, structure: null, status: "processing" } });
  });
  await page.route("**/api/uploads/extract-batch", (route) =>
    route.fulfill({
      status: 202,
      json: { document_id: doc.document_id, job_id: "job-images", status: "uploaded" },
    }),
  );
  await page
    .getByLabel("Chọn ảnh tài liệu", { exact: true })
    .setInputFiles({ name: "one.png", mimeType: "image/png", buffer: Buffer.from("test-image") });
  await expect(page.getByText(/Tài liệu đã được lưu/)).toBeVisible();
  await page.reload();
  ready = true;
  await page.getByRole("button", { name: "Kiểm tra tài liệu đang xử lý" }).click();
  await expect(page.getByRole("button", { name: "Bắt đầu học" })).toBeEnabled();
  await expect(
    page.getByText("Hãy phân tích vấn đề được nêu trong ảnh.", { exact: true }).first(),
  ).toBeVisible();
});
