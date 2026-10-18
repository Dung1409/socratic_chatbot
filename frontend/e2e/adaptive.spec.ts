import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:8012" });

test("adaptive dialogue, counted support, persistent drafts and evidence-backed final report", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/dang-ky");
  await page.getByLabel("Tên hiển thị").fill("Bạn luyện tư duy");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("adaptive@example.com");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Strong test password 123");
  await page.getByLabel("Xác nhận mật khẩu", { exact: true }).fill("Strong test password 123");
  await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Hôm nay em sẽ suy nghĩ sâu hơn một bậc." }),
  ).toBeVisible({ timeout: 20000 });
  await page.goto("/de-bai");
  await expect(page.getByLabel("Mục tiêu luyện tập")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Em muốn học đề nào?", exact: true })
    .fill("Em hãy bàn luận quan điểm: thành công chủ yếu đến từ tài năng.");
  await page.getByRole("button", { name: "Bắt đầu học", exact: true }).click();
  await expect(
    page.getByText("Em hiểu vấn đề của đề bài như thế nào?", { exact: true }),
  ).toBeVisible();
  const answer = page.getByLabel("Suy nghĩ của em", { exact: true });
  await answer.fill("Tài năng là năng lực nổi bật, nhưng thành công còn phụ thuộc vào sự cố gắng.");
  await page.reload();
  await expect(answer).toHaveValue(
    "Tài năng là năng lực nổi bật, nhưng thành công còn phụ thuộc vào sự cố gắng.",
  );
  await page.getByRole("button", { name: "Gửi câu trả lời", exact: true }).click();
  await expect(
    page.getByText("Dẫn chứng nào trong đề giúp em bảo vệ nhận định đó?", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("article", { name: "Gợi ý bổ sung", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Xin gợi ý", exact: true }).click();
  await expect(page.getByRole("article", { name: "Gợi ý bổ sung", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Xin gợi ý", exact: true }).click();
  await expect(page.getByRole("article", { name: "Gợi ý bổ sung", exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Xin gợi ý", exact: true }).click();
  const checkIn = page.getByRole("region", { name: "Chọn chỗ đang vướng" });
  await expect(checkIn).toBeVisible();
  await expect(checkIn).toContainText("Dẫn chứng nào trong đề giúp em bảo vệ nhận định đó?");
  await expect(page.getByRole("button", { name: "Xin gợi ý", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(checkIn).toBeVisible();
  await checkIn.getByRole("button", { name: "Chưa nghĩ ra ý", exact: true }).click();
  await expect(page.getByRole("article", { name: "Gợi ý bổ sung", exact: true })).toHaveCount(4);
  await expect(checkIn).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Chỗ em đang vướng", exact: true })).toHaveCount(
    1,
  );
  await page.getByRole("button", { name: "Kết thúc đối thoại & tổng hợp" }).click();
  const essay =
    "Em cho rằng tài năng tạo thuận lợi nhưng cần nỗ lực và điều kiện phù hợp. Vì thế, không thể coi tài năng là yếu tố duy nhất quyết định thành công.";
  await page.getByLabel("Bài làm cuối phiên", { exact: true }).fill(essay);
  await page.reload();
  await expect(page.getByLabel("Bài làm cuối phiên", { exact: true })).toHaveValue(essay);
  await page.getByRole("button", { name: "Hoàn thành & xem báo cáo" }).click();
  const report = page.getByRole("region", { name: "Báo cáo tư duy cuối phiên" });
  await expect(report.getByText("67,1 / 100", { exact: true })).toBeVisible();
  await expect(report.getByText("Tư duy Khá", { exact: true })).toBeVisible();
  await expect(report.getByText("0,7455", { exact: true })).toBeVisible();
  await expect(report.getByText(/A = 0,3 \+ 0,7 \/ \(1 \+ N\/7\)/)).toBeVisible();
  await report.getByText("Xem bằng chứng từ bài làm", { exact: true }).first().click();
  await expect(report.getByRole("blockquote").first()).toContainText(
    "Tài năng là năng lực nổi bật",
  );
  await page.reload();
  await expect(page.getByText("67,1 / 100", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Xem lại bài viết & tiến trình →" }).click();
  await page.getByText("Xem báo cáo của câu này", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Báo cáo tư duy cuối phiên" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Xem lại phiên học", exact: true }).click();
  await expect(page.getByText("67,1 / 100", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "../artifacts/adaptive-report-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("failed student input survives reload and can be canceled without counting support", async ({
  page,
}) => {
  await page.goto("/dang-nhap");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("adaptive@example.com");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Strong test password 123");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByText("Bạn luyện tư duy", { exact: true })).toBeVisible({ timeout: 20000 });
  await page.goto("/de-bai");
  await page
    .getByRole("textbox", { name: "Em muốn học đề nào?", exact: true })
    .fill("Hãy giải thích thông điệp của đoạn trích và liên hệ với trải nghiệm của em.");
  await page.getByText("Thêm ngữ liệu", { exact: false }).click();
  await page
    .getByRole("textbox", { name: "Đoạn trích, bài thơ hoặc ngữ liệu liên quan", exact: true })
    .fill("Đoạn trích thử nghiệm do người học cung cấp.");
  await page.getByRole("button", { name: "Bắt đầu học", exact: true }).click();
  await page
    .getByLabel("Suy nghĩ của em", { exact: true })
    .fill("[fail] Em muốn giữ câu trả lời này sau khi lỗi.");
  await page.getByRole("button", { name: "Gửi câu trả lời", exact: true }).click();
  await expect(page.getByRole("button", { name: "Thử lại", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Thử lại", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(page.getByText("Phản hồi chưa hoàn tất.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Hủy yêu cầu chưa hoàn tất" }).click();
  await expect(page.getByLabel("Suy nghĩ của em", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Suy nghĩ của em", { exact: true })).toHaveValue(
    "[fail] Em muốn giữ câu trả lời này sau khi lỗi.",
  );
  await expect(page.getByRole("article", { name: "Gợi ý bổ sung", exact: true })).toHaveCount(0);
});
