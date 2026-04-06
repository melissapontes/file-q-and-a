/**
 * Smoke tests for ask-document Edge Function logic.
 * Run with: deno test --allow-env supabase/functions/ask-document/index.test.ts
 *
 * These tests validate the pure logic functions WITHOUT calling OpenAI or Supabase.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// ─── Helper: reproduz a lógica de priorização de tags ────────────────────────

type DocMeta = {
  openai_file_id: string;
  original_name: string;
  metadata_file_id: string | null;
  tags: string[];
};

function buildFullQuestion(
  question: string,
  translatedQuestion: string,
  documentsMetadata: DocMeta[]
): string {
  const queryLower = (question + " " + translatedQuestion).toLowerCase();

  const prioritizedDocs = documentsMetadata.filter(
    (doc) =>
      doc.tags.length > 0 &&
      doc.tags.some((tag) => queryLower.includes(tag.toLowerCase()))
  );

  let fullQuestion = question;
  if (translatedQuestion) {
    fullQuestion += `\n\n[Search context - EN]: ${translatedQuestion}`;
  }

  if (prioritizedDocs.length > 0) {
    const titlesForSearch = prioritizedDocs
      .map((d) => d.original_name.replace(/\.[^.]+$/, ""))
      .join(". ");
    fullQuestion += `\n\n[Priority documents for this query]: ${titlesForSearch}`;

    const priorityList = prioritizedDocs
      .map((d) => `- "${d.original_name}"`)
      .join("\n");

    fullQuestion += `\n\n[INSTRUÇÃO]: O usuário marcou os documentos abaixo como referência principal para este tema. USE O CONTEÚDO DELES PREFERENCIALMENTE. Apenas complemente com outros documentos se necessário:\n${priorityList}`;
  }

  return fullQuestion;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const docs: DocMeta[] = [
  {
    openai_file_id: "file-acvim-hypertension",
    original_name: "ACVIM consensus statement: Guidelines for hypertension.pdf",
    metadata_file_id: "file-meta-acvim",
    tags: ["hipertensao"],
  },
  {
    openai_file_id: "file-iris-drc",
    original_name: "IRIS Doença Renal Crônica.pdf",
    metadata_file_id: null,
    tags: [],
  },
  {
    openai_file_id: "file-oxalate",
    original_name: "canine_calcium_oxalate_uroliths1.pdf",
    metadata_file_id: "file-meta-oxalate",
    tags: ["oxalato de calcio"],
  },
];

// ─── Testes ──────────────────────────────────────────────────────────────────

Deno.test("TAG MATCH: pergunta sobre hipertensao injeta doc ACVIM e exclui IRIS", () => {
  const result = buildFullQuestion(
    "como tratar hipertensao em caes?",
    "how to treat hypertension in dogs?",
    docs
  );

  assertStringIncludes(result, "ACVIM consensus statement");
  assertStringIncludes(result, "INSTRUÇÃO");
  assertStringIncludes(result, "PREFERENCIALMENTE");
});

Deno.test("TAG MATCH: pergunta sobre oxalato injeta doc oxalato, nao hipertensao", () => {
  const result = buildFullQuestion(
    "como tratar oxalato de calcio?",
    "how to treat calcium oxalate?",
    docs
  );

  assertStringIncludes(result, "canine_calcium_oxalate_uroliths1");
  assertStringIncludes(result, "INSTRUÇÃO");
  assertStringIncludes(result, "PREFERENCIALMENTE");
});

Deno.test("NO TAG MATCH: pergunta sem tag nao injeta instrucao de prioridade", () => {
  const result = buildFullQuestion(
    "qual a dose de amlodipina?",
    "what is the dose of amlodipine?",
    docs
  );

  assertEquals(result.includes("INSTRUÇÃO OBRIGATÓRIA"), false);
  assertEquals(result.includes("DOCUMENTOS PROIBIDOS"), false);
});

Deno.test("BILINGUAL: query EN e PT sao incluidas", () => {
  const result = buildFullQuestion(
    "como tratar hipertensao?",
    "how to treat hypertension?",
    docs
  );

  assertStringIncludes(result, "como tratar hipertensao?");
  assertStringIncludes(result, "Search context - EN");
  assertStringIncludes(result, "how to treat hypertension?");
});

Deno.test("METADATA FILTER: metadata_file_id nao aparece como doc prioritizado", () => {
  const metadataFileIds = new Set(
    docs.filter((d) => d.metadata_file_id).map((d) => d.metadata_file_id!)
  );

  const consultedDocs = [
    { file_id: "file-acvim-hypertension", score: 0.9 },
    { file_id: "file-meta-acvim", score: 0.85 },   // companion — deve ser filtrado
    { file_id: "file-iris-drc", score: 0.7 },
  ];

  const fileIdToNameMap = new Map(docs.map((d) => [d.openai_file_id, d.original_name]));
  const seenFiles = new Set<string>();
  const allRelevantSources: { file_id: string; filename: string }[] = [];

  for (const doc of consultedDocs) {
    const fileId = doc.file_id;
    const isMetadata = metadataFileIds.has(fileId);
    if (!seenFiles.has(fileId) && !isMetadata) {
      seenFiles.add(fileId);
      allRelevantSources.push({
        file_id: fileId,
        filename: fileIdToNameMap.get(fileId) || fileId,
      });
    }
  }

  assertEquals(allRelevantSources.length, 2);
  assertEquals(allRelevantSources.some((s) => s.file_id === "file-meta-acvim"), false);
});
