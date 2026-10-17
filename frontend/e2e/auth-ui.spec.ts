import { expect, test } from "@playwright/test";

test("auth layouts fit desktop, tablet and mobile with accessible touch targets", async ({
  page,
}) => {
  for (const size of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size);
    for (const route of ["/dang-nhap", "/dang-ky"]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const email = page.getByRole("textbox", { name: "Email", exact: true });
      expect((await email.boundingBox())?.height).toBeCloseTo(48, 2);
      const action = page.getByRole("button", {
        name: route === "/dang-ky" ? "Tạo tài khoản" : "Đăng nhập",
        exact: true,
      });
      expect((await action.boundingBox())?.height).toBeCloseTo(48, 2);
      if (size.width < 768) {
        await expect(page.locator(".auth-conversation")).toBeHidden();
        await expect(page.locator(".auth-mobile-brand")).toBeVisible();
      } else {
        await expect(page.locator(".auth-conversation")).toBeVisible();
        const introduction = await page.locator(".auth-introduction").boundingBox();
        const panel = await page.locator(".auth-form-panel").boundingBox();
        expect(panel!.x).toBeGreaterThanOrEqual(introduction!.width - 1);
      }
      if (size.width === 390 || size.width === 1440) {
        await page.screenshot({
          path: `../artifacts/auth-${route.slice(1)}-${size.width}.png`,
          fullPage: true,
        });
      }
    }
  }
});

test("inline validation, password visibility and keyboard focus prevent invalid API calls", async ({
  page,
}) => {
  let submitted = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/auth/register")) submitted++;
  });
  await page.goto("/dang-ky");
  const name = page.getByLabel("Tên hiển thị", { exact: true });
  const email = page.getByRole("textbox", { name: "Email", exact: true });
  const password = page.getByLabel("Mật khẩu", { exact: true });
  const confirmation = page.getByLabel("Xác nhận mật khẩu", { exact: true });
  await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await name.fill("   ");
  await email.fill("not-an-email");
  await password.fill("1234567");
  await confirmation.fill("different");
  await confirmation.press("Tab");
  await expect(page.getByText("Vui lòng nhập tên hiển thị.", { exact: true })).toBeVisible();
  await expect(page.getByText("Email chưa đúng định dạng. Ví dụ: ban@example.com.")).toBeVisible();
  await expect(page.getByText("Mật khẩu cần ít nhất 8 ký tự.")).toBeVisible();
  await expect(page.getByText("Mật khẩu xác nhận chưa khớp.")).toBeVisible();
  await expect(password).toHaveAttribute("aria-describedby", /auth-password-error/);
  await page.getByRole("button", { name: "Hiện mật khẩu", exact: true }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Ẩn mật khẩu", exact: true }).click();
  await expect(password).toHaveAttribute("type", "password");
  await password.fill("12345678");
  await confirmation.fill("12345678");
  await expect(password).toHaveAttribute("aria-invalid", "false");
  await expect(confirmation).toHaveAttribute("aria-invalid", "false");
  await expect(page.getByText("Độ mạnh tham khảo: Cơ bản")).toBeVisible();
  await password.fill("Mot cum tu dai!123");
  await expect(page.getByText("Độ mạnh tham khảo: Tốt")).toBeVisible();
  expect(submitted).toBe(0);
  await page.getByRole("link", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Chào mừng bạn trở lại" })).toBeVisible();
  await expect(page.getByText("Mật khẩu xác nhận chưa khớp.")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Email", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Mật khẩu", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Hiện mật khẩu", exact: true })).toBeFocused();
  await expect(page.getByRole("link", { name: "Quên mật khẩu?" })).toHaveCount(0);
});

test("real registration accepts eight characters, blocks repeat submit and reports duplicate email inline", async ({
  page,
}) => {
  const emailAddress = `redesign-${Date.now()}@example.com`;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let count = 0;
  // Delay only the outgoing request; authentication still uses the real API.
  await page.route("**/api/auth/register", async (route) => {
    count++;
    await gate;
    await route.continue();
  });
  await page.goto("/dang-ky");
  await page.getByLabel("Tên hiển thị", { exact: true }).fill("Bạn tự học");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(emailAddress);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Abc123!x");
  const confirmation = page.getByLabel("Xác nhận mật khẩu", { exact: true });
  await confirmation.fill("Abc123!x");
  const registered = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/register") && response.request().method() === "POST",
    { timeout: 15000 },
  );
  await confirmation.press("Enter");
  try {
    await expect(
      page.getByRole("button", { name: "Đang tạo tài khoản…", exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeDisabled();
    await page.keyboard.press("Enter");
    await expect.poll(() => count).toBe(1);
  } finally {
    release();
  }
  expect((await registered).status()).toBe(201);
  await expect(page.getByText("Tạo tài khoản thành công", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Hôm nay em sẽ suy nghĩ sâu hơn một bậc." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await page.getByRole("link", { name: "Đăng ký ngay", exact: true }).click();
  await page.getByLabel("Tên hiển thị", { exact: true }).fill("Tài khoản trùng");
  const email = page.getByRole("textbox", { name: "Email", exact: true });
  await email.fill(emailAddress.toUpperCase());
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Abc123!x");
  await page.getByLabel("Xác nhận mật khẩu", { exact: true }).fill("Abc123!x");
  const duplicate = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/register") && response.request().method() === "POST",
    { timeout: 15000 },
  );
  await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  expect((await duplicate).status()).toBe(409);
  await expect(page.getByText("Email này đã được đăng ký.", { exact: true })).toBeVisible();
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "Tạo tài khoản", exact: true })).toBeEnabled();
  expect(count).toBe(2);
});
