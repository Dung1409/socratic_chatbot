import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

function normalizeMathDelimiters(text: string) {
  return text
    .replace(/\\\((.*?)\\\)/gs, (_, formula: string) => `$${formula}$`)
    .replace(/\\\[(.*?)\\\]/gs, (_, formula: string) => `$$\n${formula}\n$$`);
}

export function TutorMessage({ text, className }: { text: string; className: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {normalizeMathDelimiters(text)}
      </ReactMarkdown>
    </div>
  );
}
