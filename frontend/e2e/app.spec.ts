import { expect, test } from "@playwright/test";

test("student study, reload, submit, teacher grade and view actual results", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Hôm nay em sẽ suy nghĩ sâu hơn một bậc." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Tiếp tục phiên học" }).click();
  await expect(page.getByText("Chế độ kịch bản · Chưa kết nối mô hình AI")).toBeVisible();
  await page.getByRole("button", { name: "Gợi ý mức 1 · Định hướng" }).click();
  await expect(page.getByText("Hãy chú ý đến thời điểm lịch sử của câu chuyện.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Hãy chú ý đến thời điểm lịch sử của câu chuyện.")).toBeVisible();
  const answer = page.getByPlaceholder("Viết suy nghĩ của em… (Ctrl + Enter để gửi)");
  await answer.fill("Bản nháp của em được giữ khi tải lại trang.");
  await page.reload();
  await expect(answer).toHaveValue("Bản nháp của em được giữ khi tải lại trang.");
  for (let i = 0; i < 5; i++) {
    await answer.fill(
      `Câu trả lời ${i + 1}: em sẽ tìm chi tiết trong văn bản và giải thích mối liên hệ với luận điểm.`,
    );
    await page.getByRole("button", { name: "Gửi câu trả lời" }).click();
    await expect(
      page.getByText("Đã lưu câu trả lời. Giáo viên sẽ đánh giá nội dung và dẫn chứng."),
    ).toHaveCount(i + 1);
  }
  await expect(page.getByText("Hoàn thành chuỗi câu hỏi", { exact: true })).toBeVisible();
  await page
    .getByPlaceholder("Viết bài làm của em…")
    .fill(
      "Bài làm của em: tình người và khát vọng sống cần được giải thích dựa trên tình huống truyện và các chi tiết có trong văn bản.",
    );
  await page.getByRole("button", { name: "Nộp bài làm" }).click();
  await expect(page.getByText("Đã nộp.", { exact: false })).toBeVisible();
  await page.goto("/giao-vien/danh-gia");
  await expect(page.getByText("Bài làm của em: tình người", { exact: false })).toBeVisible();
  for (const slider of await page.getByRole("slider").all()) {
    await slider.focus();
    await slider.press("End");
    for (let i = 0; i < 4; i++) await slider.press("ArrowLeft");
    await expect(slider).toHaveValue("8");
  }
  await page
    .getByRole("textbox", { name: "Nhận xét của giáo viên" })
    .fill("Lập luận rõ. Em cần phân tích cụ thể hơn tác dụng của chi tiết và dẫn chứng.");
  await page.getByRole("button", { name: "Gửi kết quả" }).click();
  await expect(page.getByText("Đã lưu kết quả cho học sinh")).toBeVisible();
  await page.goto("/tien-trinh");
  await expect(page.getByText("Tổng 8 / 10")).toBeVisible();
  await expect(
    page.getByText("Lập luận rõ. Em cần phân tích cụ thể hơn tác dụng của chi tiết và dẫn chứng."),
  ).toBeVisible();
  await page.screenshot({ path: "../artifacts/progress-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("create teacher assignment, preserve rubric, upload with confirmation and mobile navigation", async ({
  page,
}) => {
  await page.goto("/giao-vien/rubric");
  await page
    .getByPlaceholder("VD: Vẻ đẹp hình tượng người lái đò sông Đà")
    .fill("Trách nhiệm của tuổi trẻ");
  await page
    .getByPlaceholder("Phân tích…")
    .fill("Viết một đoạn văn trình bày quan điểm về trách nhiệm của tuổi trẻ với cộng đồng.");
  await page.locator('input[type="date"]').fill("2026-11-01");
  await page.getByRole("button", { name: "Giao đề bài" }).click();
  await expect(page.getByText("Đã giao đề bài mới")).toBeVisible();
  await page.getByRole("button", { name: "Lưu rubric" }).click();
  await expect(page.getByText("Đã lưu rubric. Các phiên mới sẽ dùng phiên bản này.")).toBeVisible();
  await page.goto("/de-bai");
  await page
    .locator("section")
    .filter({ hasText: "Trách nhiệm của tuổi trẻ" })
    .getByRole("link", { name: "Học với gia sư" })
    .click();
  await expect(page.getByRole("heading", { name: "Trách nhiệm của tuổi trẻ" })).toBeVisible();
  await expect(
    page.getByText(
      "Em hãy đọc yêu cầu đề bài và xác định vấn đề chính cần giải quyết bằng lời của mình.",
    ),
  ).toBeVisible();
  await page.getByRole("link", { name: "Phiên học Socratic", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trách nhiệm của tuổi trẻ" })).toBeVisible();
  await page.goto("/de-bai");
  await page.getByLabel("Chọn tệp PDF, Word hoặc TXT").setInputFiles({
    name: "De-luyen-tap.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Hãy trình bày quan điểm của em về ý nghĩa của việc đọc sách và đưa ra dẫn chứng.",
    ),
  });
  await expect(page.getByText("Đã trích xuất văn bản.", { exact: false })).toBeVisible();
  await page.getByLabel("Tên đề", { exact: false }).fill("Đề luyện tập đọc sách");
  await page.getByRole("button", { name: "Xác nhận câu này & bắt đầu học" }).click();
  await expect(page.getByRole("heading", { name: "Đề luyện tập đọc sách" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Mở menu" }).click();
  await page.getByRole("link", { name: "Đề bài của tôi", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Đề bài của tôi" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mở menu" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: "../artifacts/assignments-mobile.png", fullPage: true });
});
