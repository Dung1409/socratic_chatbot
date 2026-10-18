import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionConversation } from "@/components/session/SessionConversation";
import { type Session } from "@/lib/api";

describe("session conversation formatting", () => {
  it("renders inline vector notation as math without exposing hint strategy metadata", () => {
    const session = {
      tutor_mode: "openai",
      turns: [
        {
          id: "hint-1",
          kind: "hint",
          step: 0,
          tier: 1,
          response_kind: "support",
          text: String.raw`Từ đó, viết được 2\(\overrightarrow{IJ}\) theo các vectơ \(\overrightarrow{AB}\), \(\overrightarrow{AC}\), \(\overrightarrow{AD}\) như thế nào?`,
          objective: "Lập biểu thức vectơ.",
          strategy: "evidence",
        },
      ],
      support_events: [
        { turn_id: "hint-1", reason: "Học sinh cần gợi ý.", counted_for_autonomy: true },
      ],
    } as unknown as Session;

    const { container } = render(<SessionConversation session={session} />);

    expect(container.querySelectorAll(".katex").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Cách đặt câu hỏi:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mục tiêu:/)).not.toBeInTheDocument();
    expect(screen.getByText("Học sinh cần gợi ý.")).toBeInTheDocument();
  });
});
