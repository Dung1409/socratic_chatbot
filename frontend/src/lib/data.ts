export const BLOOM = [
  { level: 1, name: "Nhớ", desc: "Nhận biết, nhắc lại chi tiết văn bản" },
  { level: 2, name: "Hiểu", desc: "Giải thích, tóm tắt ý nghĩa" },
  { level: 3, name: "Vận dụng", desc: "Liên hệ, áp dụng vào tình huống" },
  { level: 4, name: "Phân tích", desc: "Chỉ ra cấu trúc, biện pháp, mối quan hệ" },
  { level: 5, name: "Đánh giá", desc: "Nhận xét, lập luận bảo vệ quan điểm" },
  { level: 6, name: "Sáng tạo", desc: "Đề xuất cách hiểu, kiến tạo ý tưởng mới" },
] as const;

export const bloomColor = (l: number) =>
  ["bg-bloom-1", "bg-bloom-2", "bg-bloom-3", "bg-bloom-4", "bg-bloom-5", "bg-bloom-6"][l - 1];
