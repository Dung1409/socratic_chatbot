import { type Session, type Turn } from "@/lib/api";

// The backend's array order is authoritative, including historical turns without timestamps.
// A reply is an observation of participation, never evidence of mastering a Bloom level.
export function getLearningHistory(session: Session) {
  const questions: { turn: Extract<Turn, { kind: "tutor" }>; index: number; answered: boolean }[] =
    [];
  const answers: { turn: Extract<Turn, { kind: "student" }>; index: number }[] = [];
  let question: (typeof questions)[number] | undefined;
  session.turns.forEach((turn, index) => {
    if (turn.kind === "tutor" && (!turn.response_kind || turn.response_kind === "question")) {
      question = { turn, index, answered: false };
      questions.push(question);
    }
    if (turn.kind === "student" && (!turn.purpose || turn.purpose === "answer")) {
      answers.push({ turn, index });
      if (question) question.answered = true;
    }
  });
  return { questions, answers };
}
