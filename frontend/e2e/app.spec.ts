import { expect, test, type Page } from "@playwright/test";

const password = "Strong test password 123";
async function register(page: Page) {
  const email = `learning-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  await page.goto("/dang-ky");
  await page.getByLabel("Tên hiển thị").fill("Bạn tự học");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByLabel("Xác nhận mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bài học của tôi" })).toBeVisible();
  return email;
}
async function login(page: Page, email: string) {
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
}
async function quick(page: Page, prompt: string, saveOnly = false) {
  await page.goto("/de-bai?tab=quick");
  await page.getByRole("textbox", { name: "Em muốn học đề nào?" }).fill(prompt);
  await page
    .getByRole("button", { name: saveOnly ? "Lưu đề" : "Bắt đầu học", exact: true })
    .click();
  if (!saveOnly) await expect(page).toHaveURL(/phien-hoc\?session=/);
  else
    await expect(
      page.getByText("Đã lưu bài học. Em có thể bắt đầu học sau.", { exact: true }),
    ).toBeVisible();
}

test("save a task without starting, leave a session, reopen a tab and restore on another device", async ({
  page,
  browser,
  baseURL,
}) => {
  const email = await register(page);
  const prompt = "Hãy trình bày suy nghĩ về ý nghĩa của việc đọc sách đối với học sinh.";
  await quick(page, prompt, true);
  expect(await (await page.request.get("/api/sessions")).json()).toHaveLength(0);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: prompt, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Bắt đầu học", exact: true }).click();
  await expect(page).toHaveURL(/phien-hoc\?session=/);
  const sessionURL = page.url();
  const draft = "Bản nháp cần được giữ sau khi đóng tab và đổi thiết bị.";
  await page.getByLabel("Suy nghĩ của em", { exact: true }).fill(draft);
  await page.getByRole("button", { name: "Lưu và học sau", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bài học của tôi", exact: true })).toBeVisible();
  const sessions = await (await page.request.get("/api/sessions")).json();
  expect(sessions).toHaveLength(1);
  expect(
    sessions[0].turns.filter((turn: { kind: string }) => turn.kind === "student"),
  ).toHaveLength(0);
  await page.getByRole("link", { name: "Tiếp tục học", exact: true }).click();
  await expect(page.getByLabel("Suy nghĩ của em", { exact: true })).toHaveValue(draft);
  await page.close();
  const freshContext = await browser.newContext({ baseURL: baseURL! });
  const fresh = await freshContext.newPage();
  await fresh.goto(sessionURL);
  await expect(fresh.getByRole("heading", { name: "Chào mừng bạn trở lại" })).toBeVisible();
  await login(fresh, email);
  await expect(fresh).toHaveURL(sessionURL);
  await expect(fresh.getByLabel("Suy nghĩ của em", { exact: true })).toHaveValue(draft);
  await fresh.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await fresh.goto(sessionURL);
  await login(fresh, email);
  await expect(fresh.getByLabel("Suy nghĩ của em", { exact: true })).toHaveValue(draft);
  await freshContext.close();
});

test("lesson collection never starts AI and each lesson keeps its own draft", async ({ page }) => {
  await register(page);
  await quick(page, "Hãy giải thích vai trò của sự kiên trì trong học tập.");
  await page
    .getByLabel("Suy nghĩ của em", { exact: true })
    .fill("Bản nháp riêng của phiên thứ nhất");
  await page.getByRole("button", { name: "Lưu và học sau" }).click();
  await expect(page).toHaveURL(/\/$/);
  await quick(page, "Hãy trình bày suy nghĩ về tình bạn trong cuộc sống.");
  await page
    .getByLabel("Suy nghĩ của em", { exact: true })
    .fill("Bản nháp riêng của phiên thứ hai");
  await page.getByRole("button", { name: "Bài học của tôi" }).click();
  await expect(page).toHaveURL(/\/$/);
  let aiStarts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/sessions(?:$|\/.*\/prepare)/.test(request.url()))
      aiStarts++;
  });
  await page.reload();
  await expect(page.getByRole("list", { name: "Danh sách bài học" }).locator("li")).toHaveCount(2);
  await page.screenshot({ path: "../artifacts/ui-sessions-desktop.png", fullPage: true });
  await page.getByRole("textbox", { name: "Tìm bài học" }).fill("kiên trì");
  await page.getByRole("button", { name: /^Đang học \(/ }).click();
  expect(aiStarts).toBe(0);
  await page.getByRole("link", { name: "Tiếp tục học", exact: true }).click();
  await expect(page.getByLabel("Suy nghĩ của em", { exact: true })).toHaveValue(
    "Bản nháp riêng của phiên thứ nhất",
  );
});

test("start the second question directly and resume its exact session from one lesson row", async ({
  page,
}) => {
  await register(page);
  const csrf = await (await page.request.get("/api/auth/csrf")).json();
  const result = await page.request.post("/api/learning/assignments", {
    headers: { "X-CSRF-Token": csrf.csrf_token },
    data: {
      title: "Đề có hai câu hỏi",
      items: [
        { label: "Câu 1", prompt: "Nêu ý nghĩa của việc đọc sách.", item_type: "reading" },
        {
          label: "Câu 2",
          prompt: "Giải thích một góc nhìn khác về việc đọc sách.",
          item_type: "reading",
        },
      ],
    },
  });
  const assignment = await result.json();
  await page.goto(`/?lesson=${assignment.id}`);
  await page
    .getByRole("listitem")
    .filter({ hasText: "Giải thích một góc nhìn khác về việc đọc sách." })
    .last()
    .getByRole("link", { name: "Học câu này", exact: true })
    .click();
  await expect(page).toHaveURL(/phien-hoc\?session=/);
  const sessions = await (await page.request.get("/api/sessions")).json();
  expect(sessions).toHaveLength(1);
  expect(sessions[0].assignment.active_item_id).toBe(assignment.items[1].id);
  const exact = page.url();
  await page.getByRole("button", { name: "Bài học của tôi" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("list", { name: "Danh sách bài học" }).getByRole("listitem"),
  ).toHaveCount(1);
  await page.getByRole("link", { name: "Tiếp tục học", exact: true }).click();
  await expect(page).toHaveURL(exact);
});

test("creation and aggregate statistics do not repeat the lesson collection", async ({ page }) => {
  await register(page);
  const title = "Nêu suy nghĩ về việc tự học có trách nhiệm.";
  await quick(page, title, true);
  await page.goto("/");
  const primary = page.getByRole("navigation", { name: "Điều hướng chính" });
  await expect(primary.getByRole("link")).toHaveCount(2);
  await expect(
    page.getByRole("list", { name: "Danh sách bài học" }).getByRole("listitem"),
  ).toHaveCount(1);
  for (const path of ["/de-bai?tab=quick", "/de-bai?tab=documents", "/tien-trinh"]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", {
        name: path.startsWith("/de-bai") ? "Thêm bài học" : "Thống kê học tập",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("list", { name: "Danh sách bài học" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: title, exact: true })).toHaveCount(0);
    await expect(page.getByText("Lịch sử tài liệu", { exact: true })).toHaveCount(0);
  }
  await page.screenshot({ path: "../artifacts/ui-statistics-desktop.png", fullPage: true });
  await page.goto("/de-bai?tab=quick");
  await page.screenshot({ path: "../artifacts/ui-create-desktop.png", fullPage: true });
  await page.goto("/phien-hoc");
  await expect(page).toHaveURL(/\/$/);
  expect(await (await page.request.get("/api/sessions")).json()).toHaveLength(0);
});

test("navigation collapses on every page, survives reload, and mobile screens fit", async ({
  page,
}) => {
  await register(page);
  const sidebar = page.getByRole("complementary", { name: "Thanh điều hướng" });
  for (const path of ["/", "/de-bai", "/phien-hoc", "/tien-trinh"]) {
    await page.goto(path);
    await page.getByRole("button", { name: "Thu gọn thanh điều hướng", exact: true }).click();
    await expect(sidebar).toHaveCSS("width", "64px");
    await page.reload();
    await expect(sidebar).toHaveCSS("width", "64px");
    await page.getByRole("button", { name: "Mở rộng thanh điều hướng", exact: true }).click();
    await expect(sidebar).toHaveCSS("width", "248px");
  }
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      "/",
      "/de-bai",
      "/de-bai?tab=quick",
      "/de-bai?tab=documents",
      "/phien-hoc",
      "/tien-trinh",
    ]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Mở menu", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Bài học của tôi", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Bài học của tôi", exact: true })).toBeVisible();
  await page.screenshot({ path: "../artifacts/ui-library-mobile.png", fullPage: true });
});

test("a failed draft save prevents a false saved-and-exited success", async ({ page }) => {
  await register(page);
  await quick(page, "Hãy phân tích vai trò của dẫn chứng trong một bài nghị luận.");
  await page.route("**/api/sessions/*/draft", (route) =>
    route.request().method() === "PUT" ? route.abort("failed") : route.continue(),
  );
  await page
    .getByLabel("Suy nghĩ của em", { exact: true })
    .fill("Nội dung không được phép mất khi mạng lỗi");
  await page.getByRole("button", { name: "Lưu và học sau" }).click();
  await expect(page.getByRole("button", { name: "Thử lưu lại", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/phien-hoc\?session=/);
  await page.getByRole("button", { name: "Bài học của tôi", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.unroute("**/api/sessions/*/draft");
  await page.getByRole("link", { name: "Tiếp tục học", exact: true }).click();
  await expect(page.getByLabel("Suy nghĩ của em", { exact: true })).toHaveValue(
    "Nội dung không được phép mất khi mạng lỗi",
  );
  await page.getByRole("button", { name: "Lưu và học sau" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Bài học của tôi", exact: true })).toBeVisible();
});

test("authentication stays private, refreshes access and isolates another learner's library", async ({
  page,
  context,
}) => {
  const email = await register(page);
  const title = "Đề riêng của tài khoản thứ nhất cần được giữ kín.";
  await quick(page, title, true);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  expect(
    (await context.cookies())
      .filter((cookie) => cookie.name.startsWith("socratic_"))
      .every((cookie) => cookie.httpOnly),
  ).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toMatch(/socratic_(access|refresh)/);
  await context.clearCookies({ name: "socratic_access" });
  await page.reload();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  expect((await context.cookies()).some((cookie) => cookie.name === "socratic_access")).toBe(true);
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Chào mừng bạn trở lại" })).toBeVisible();
  expect((await context.cookies()).some((cookie) => cookie.name.startsWith("socratic_"))).toBe(
    false,
  );
  await register(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Chưa có bài học", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: title, exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await page.goto("/");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("incorrect password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Email hoặc mật khẩu không đúng.");
  await login(page, email);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
});
