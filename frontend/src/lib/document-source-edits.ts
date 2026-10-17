import type { DocumentStructure, ParsedQuestion, SourceParagraph } from "@/lib/api";

function questionContext(question: ParsedQuestion, part: DocumentStructure["parts"][number], structure: DocumentStructure) {
  const source = question.materials || question.paragraphs.map((paragraph) => paragraph.text).join("\n\n")
    || part.paragraphs.map((paragraph) => paragraph.text).join("\n\n")
    || structure.global_paragraphs.map((paragraph) => paragraph.text).join("\n\n");
  return [question.task || question.text, source].filter(Boolean).join("\n\n");
}

function refreshContexts(structure: DocumentStructure): DocumentStructure {
  return { ...structure, parts: structure.parts.map((part) => ({ ...part,
    questions: part.questions.map((question) => ({ ...question, context: questionContext(question, part, structure) })),
  })) };
}

export function editQuestionTask(structure: DocumentStructure, questionId: string, value: string): DocumentStructure {
  return { ...structure, parts: structure.parts.map((part) => ({ ...part,
    questions: part.questions.map((question) => {
      if (question.id !== questionId) return question;
      const changed = { ...question, task: value };
      return { ...changed, context: questionContext(changed, part, structure) };
    }),
  })) };
}

export function editSharedMaterials(structure: DocumentStructure, questionId: string, value: string): DocumentStructure {
  const previous = structure.parts.flatMap((part) => part.questions).find((question) => question.id === questionId)?.materials;
  if (!previous) return structure;
  const sameSource = (text: string | undefined) => text?.trim() === previous.trim();
  const changeParagraph = (paragraph: SourceParagraph) =>
    sameSource(paragraph.text) ? { ...paragraph, text: value } : paragraph;
  const changed = { ...structure,
    global_paragraphs: structure.global_paragraphs.map(changeParagraph),
    parts: structure.parts.map((part) => ({ ...part,
      paragraphs: part.paragraphs.map(changeParagraph),
      questions: part.questions.map((question) => ({ ...question,
        ...(sameSource(question.materials) ? { materials: value } : {}),
        paragraphs: question.paragraphs.map(changeParagraph),
      })),
    })),
  };
  return refreshContexts(changed);
}

export function editSharedParagraph(structure: DocumentStructure, paragraphId: string, value: string): DocumentStructure {
  const paragraphs = [
    ...structure.global_paragraphs,
    ...structure.parts.flatMap((part) => [
      ...part.paragraphs,
      ...part.questions.flatMap((question) => question.paragraphs),
    ]),
  ];
  const previous = paragraphs.find((paragraph) => paragraph.id === paragraphId)?.text;
  if (!previous) return structure;
  const changeParagraph = (paragraph: SourceParagraph) =>
    paragraph.id === paragraphId || paragraph.text.trim() === previous.trim()
      ? { ...paragraph, text: value } : paragraph;
  const changed = { ...structure,
    global_paragraphs: structure.global_paragraphs.map(changeParagraph),
    parts: structure.parts.map((part) => ({ ...part,
      paragraphs: part.paragraphs.map(changeParagraph),
      questions: part.questions.map((question) => ({ ...question,
        ...(question.materials?.trim() === previous.trim() ? { materials: value } : {}),
        paragraphs: question.paragraphs.map(changeParagraph),
      })),
    })),
  };
  return refreshContexts(changed);
}
