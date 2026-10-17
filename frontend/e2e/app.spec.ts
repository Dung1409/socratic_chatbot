import { expect, test } from "@playwright/test";

test("start from an empty workspace, study a personal assignment and save the final essay", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("Bạn chưa có đề tự học.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Lớp học", exact: true })).toHaveCount(0);
  await page.goto("/phien-hoc");
  await expect(page.getByRole("heading", { name: "Bắt đầu phiên tự học đầu tiên" })).toBeVisible();
  await expect.poll(async () => (await page.request.get("/api/sessions")).json()).toEqual([]);

  await page.getByRole("link", { name: "Thêm đề tự học", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Tên đề", exact: true })
    .fill("Tự học về ý nghĩa của đọc sách");
  await page
    .getByRole("textbox", { name: "Nội dung đề", exact: true })
    .fill("Hãy trình bày quan điểm về ý nghĩa của việc đọc sách và đưa ra dẫn chứng cụ thể.");
  await page.getByLabel("Mục tiêu luyện tập").selectOption("6");
  await page.getByRole("button", { name: "Xác nhận đề & bắt đầu học" }).click();
  await expect(page.getByRole("heading", { name: "Tự học về ý nghĩa của đọc sách" })).toBeVisible();
  await page.getByRole("button", { name: "Gợi ý mức 1 · Định hướng" }).click();
  await expect(page.getByText("Đọc lại yêu cầu và chọn một ý để tập trung trả lời.")).toBeVisible();

  const answer = page.getByPlaceholder("Viết suy nghĩ của em… (Ctrl + Enter để gửi)");
  await answer.fill("Bản nháp của em được giữ khi tải lại trang.");
  await page.reload();
  await expect(answer).toHaveValue("Bản nháp của em được giữ khi tải lại trang.");
  await expect(page.getByText("Đọc lại yêu cầu và chọn một ý để tập trung trả lời.")).toBeVisible();
  for (let index = 0; index < 6; index++) {
    await answer.fill(
      `Câu trả lời ${index + 1}: em tìm dẫn chứng trong văn bản và giải thích mối liên hệ với luận điểm.`,
    );
    await page.getByRole("button", { name: "Gửi câu trả lời" }).click();
    await expect(page.getByText("Đã lưu câu trả lời vào phiên tự học của bạn.")).toHaveCount(
      index + 1,
    );
  }
  await expect(page.getByText("Hoàn thành chuỗi câu hỏi", { exact: true })).toBeVisible();
  const essay =
    "Bài viết tự học: việc đọc sách giúp mở rộng góc nhìn khi người đọc biết kiểm tra dẫn chứng và phản biện lập luận.";
  await page.getByPlaceholder("Viết bài làm của em…").fill(essay);
  await page.reload();
  await expect(page.getByPlaceholder("Viết bài làm của em…")).toHaveValue(essay);
  await page.getByRole("button", { name: "Lưu bài viết & hoàn thành" }).click();
  await expect(
    page.getByRole("link", { name: "Xem lại bài viết & tiến trình →" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Xem lại bài viết & tiến trình →" }).click();
  await expect(page.getByRole("heading", { name: "Tiến trình tự học" })).toBeVisible();
  await page.getByText("Bài viết cuối phiên", { exact: true }).click();
  await expect(page.getByText(essay, { exact: true })).toBeVisible();
  await expect(page.getByText("Chờ đánh giá", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Xem lại đối thoại" }).click();
  await expect(
    page.getByRole("link", { name: "Xem lại bài viết & tiến trình →" }),
  ).toBeVisible();
  await page.goto("/giao-vien");
  await expect(page.getByRole("heading", { name: "Không tìm thấy trang" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("upload, edit extracted text before confirmation and navigate on mobile", async ({ page }) => {
  await page.goto("/de-bai");
  const before = await (await page.request.get("/api/assignments")).json();
  await page.getByLabel("Chọn tệp đề bài").setInputFiles({
    name: "De-luyen-tap.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Hãy trình bày quan điểm về trách nhiệm với cộng đồng và đưa ra dẫn chứng.",
    ),
  });
  await expect(page.getByText("Đã trích xuất văn bản.", { exact: false })).toBeVisible();
  expect(await (await page.request.get("/api/assignments")).json()).toHaveLength(before.length);
  await page.getByRole("textbox", { name: "Tên đề", exact: true }).fill("Đề riêng về trách nhiệm");
  const edited =
    "Viết đoạn văn về trách nhiệm của tuổi trẻ với cộng đồng, có dẫn chứng và phản biện.";
  await page.getByRole("textbox", { name: "Nội dung đề", exact: true }).fill(edited);
  await page.getByLabel("Mục tiêu luyện tập").selectOption("3");
  await page.getByRole("button", { name: "Xác nhận đề & bắt đầu học" }).click();
  await expect(page.getByRole("heading", { name: "Đề riêng về trách nhiệm" })).toBeVisible();
  await expect(page.getByText(edited, { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Mở menu" }).click();
  await page.getByRole("link", { name: "Đề bài của tôi", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Đề bài của tôi" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: "../artifacts/self-study-mobile.png", fullPage: true });
});
