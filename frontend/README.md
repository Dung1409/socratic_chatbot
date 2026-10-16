# Bloom Guided Scribe

> Giao diện gốc được tích hợp với FastAPI trong dự án SocraVăn. Xem [README tại thư mục gốc](../README.md) để cài đặt, chạy và kiểm tra phiên bản hiện tại. Các nội dung bên dưới là mô tả của repo nguồn.

Bạn là Senior Frontend Engineer, UI/UX Designer và EdTech Product Designer, có kinh nghiệm xây dựng nền tảng giáo dục ứng dụng AI.

Hãy thiết kế và triển khai giao diện web hoàn chỉnh cho đề tài nghiên cứu khoa học:

“Xây dựng hệ thống gia sư AI ứng dụng phương pháp Socratic kết hợp thang tư duy Bloom nhằm phát triển năng lực tư duy của học sinh trong môn Ngữ văn.”

Mục tiêu là tạo ra sản phẩm có giao diện hiện đại, học thuật, chuyên nghiệp, dễ sử dụng, đủ chất lượng để trình bày và demo trước hội đồng nghiên cứu khoa học.

Không xây dựng một chatbot AI thông thường. Hệ thống phải thể hiện rõ phương pháp sư phạm Socratic, cơ chế gợi ý thích ứng và khả năng đánh giá tư duy học sinh.

2. Công nghệ

Nếu xây dựng mới, ưu tiên:

Next.js + TypeScript

Tailwind CSS

shadcn/ui

Lucide React

Recharts

React Hook Form + Zod

Zustand hoặc React Context cho state management
Thiết kế responsive, desktop-first cho giao diện học tập, đồng thời hỗ trợ tablet và mobile.

3. Nguyên tắc UI/UX

Phong cách: Modern Academic EdTech.

Nền sáng, sạch, tối giản.

Primary: Indigo #4F46E5.

Secondary: Teal #0F766E.

Background: #F8FAFC.

Text: #1E293B.

Border: #E2E8F0.

Typography: Be Vietnam Pro hoặc Inter.

Sidebar cố định trên desktop, thu gọn trên mobile.

Khoảng trắng hợp lý, phân cấp thông tin rõ ràng.

Tránh giao diện giống chatbot AI phổ thông.

Không sử dụng quá nhiều gradient, shadow, emoji hoặc các card trang trí.

Ưu tiên khả năng đọc, tập trung học tập và thao tác nhanh.

Giao diện mặc định bằng tiếng Việt, nội dung mẫu phải tự nhiên, đúng ngữ cảnh Ngữ văn.

4. Đối tượng người dùng

Student

Tải đề bài.

Học với gia sư AI.

Nhận câu hỏi gợi mở.

Yêu cầu gợi ý tăng dần.

Nộp bài làm.

Xem phản hồi, kết quả đánh giá và tiến trình học tập.

Teacher

Quản lý đề bài và rubric.

Xem phiên học của học sinh theo quyền được cấp.

Đánh giá bài làm.

Theo dõi tiến bộ của học sinh.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://bloom-guided-scribe.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/328d4b19-38c0-4bc1-beb0-f900e1c7cb3b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
