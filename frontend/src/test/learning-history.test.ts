import { describe, expect, it } from "vitest";
import { getLearningHistory } from "@/components/session/learning-history";
import { type Session, type Turn } from "@/lib/api";

const question = (text: string, level = 2): Turn => ({
  kind: "tutor",
  text,
  step: 0,
  level,
  response_kind: "question",
});
const answer = (text: string, purpose: "source" | "answer" | "clarification" = "answer"): Turn => ({
  kind: "student",
  text,
  purpose,
  step: 0,
  level: 2,
  hints: 0,
  quality: null,
});
const session = (turns: Turn[]) => ({ turns }) as Session;

describe("learning history presentation", () => {
  it("does not count choosing a difficulty as an answer or mark the question answered", () => {
    const history = getLearningHistory(
      session([question("Đọc sách có vai trò gì?"), answer("Em chưa nghĩ ra ý.", "clarification")]),
    );
    expect(history.answers).toHaveLength(0);
    expect(history.questions[0]?.answered).toBe(false);
  });
  it("keeps server order, includes support between question and answer, and leaves the next question unanswered", () => {
    const saved = session([
      question("Vì sao em nghĩ như vậy?", 5),
      { kind: "hint", step: 0, tier: 1, text: "Hãy thử tìm một bằng chứng." },
      answer("Em căn cứ vào chi tiết trong đoạn trích."),
      question("Nếu xét một góc nhìn khác thì sao?", 2),
    ]);
    const before = JSON.stringify(saved);
    const history = getLearningHistory(saved);
    expect(
      history.questions.map(({ index, answered, turn }) => [index, answered, turn.level]),
    ).toEqual([
      [0, true, 5],
      [3, false, 2],
    ]);
    expect(history.answers[0]?.index).toBe(2);
    expect(JSON.stringify(saved)).toBe(before);
  });

  it("does not treat pasted source text or the tutor's synthesis as the learner's reasoning", () => {
    const history = getLearningHistory(
      session([
        { ...question("Em bổ sung đoạn trích được không?"), response_kind: "source_request" },
        answer("Ngữ liệu do học sinh dán vào.", "source"),
        question("Thông điệp của đoạn trích là gì?"),
        answer("Em hiểu thông điệp là cần biết lắng nghe."),
        { ...question("Em đã có thể tổng hợp lại suy nghĩ."), response_kind: "ready" },
      ]),
    );
    expect(history.questions).toHaveLength(1);
    expect(history.questions[0]).toMatchObject({ index: 2, answered: true });
    expect(history.answers).toHaveLength(1);
    expect(history.answers[0]?.turn.purpose).toBe("answer");
  });

  it("can read historical template sessions without IDs, timestamps, or response_kind", () => {
    const history = getLearningHistory(
      session([
        { kind: "tutor", step: 0, level: 1, text: "Chi tiết nào gây ấn tượng với em?" },
        answer("Em chú ý đến cách nhân vật lắng nghe người khác."),
        { kind: "tutor", step: 1, level: 3, text: "Em liên hệ điều này với trải nghiệm nào?" },
      ]),
    );
    expect(history.questions.map(({ answered }) => answered)).toEqual([true, false]);
    expect(getLearningHistory(session([]))).toEqual({ questions: [], answers: [] });
  });
});
