import { expect, test } from "@playwright/test";

test.use({ baseURL: "http://127.0.0.1:8012" });

test("shows a submitted question's assessment without leaving its session", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/dang-ky");
  await page.getByLabel("Tên hiển thị").fill("Bạn học thử");
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("assessment-modal@example.com");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Strong test password 123");
  await page.getByLabel("Xác nhận mật khẩu", { exact: true }).fill("Strong test password 123");
  await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bài học của tôi" })).toBeVisible();

  await page.goto("/de-bai?tab=quick");
  await page
    .getByRole("textbox", { name: "Em muốn học đề nào?", exact: true })
    .fill("Em hãy bàn luận quan điểm: thành công chủ yếu đến từ tài năng.");
  await page.getByRole("button", { name: "Bắt đầu học", exact: true }).click();
  await page
    .getByLabel("Suy nghĩ của em", { exact: true })
    .fill("Tài năng là lợi thế, nhưng thành công còn cần cố gắng và điều kiện phù hợp.");
  await page.getByRole("button", { name: "Gửi câu trả lời", exact: true }).click();
  await expect(page.getByRole("button", { name: "Kết thúc đối thoại & tổng hợp" })).toBeVisible();
  await page.getByRole("button", { name: "Kết thúc đối thoại & tổng hợp" }).click();
  await page
    .getByLabel("Câu trả lời cuối phiên", { exact: true })
    .fill(
      "Em cho rằng tài năng tạo thuận lợi, nhưng nỗ lực và điều kiện phù hợp cũng quyết định thành công.",
    );
  await page.getByRole("button", { name: "Hoàn thành & xem báo cáo" }).click();

  const choice = page.getByRole("dialog", { name: "Đã có kết quả cho câu này" });
  await expect(choice).toBeVisible();
  const sessionUrl = page.url();
  await choice.getByRole("button", { name: "Xem kết quả câu này" }).click();

  const report = page.getByRole("dialog", { name: /^Kết quả / });
  await expect(report.getByRole("region", { name: "Phiếu đánh giá Socratic" })).toBeVisible();
  expect(page.url()).toBe(sessionUrl);

  await report.getByRole("button", { name: "Đóng phiếu đánh giá" }).click();
  await expect(choice).toBeVisible();
});
