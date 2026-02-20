import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { convert as htmlToText } from "html-to-text";

export type ExtractedTextMeta = {
  parser: string;
  mimeType: string | null;
  filename: string | null;
  pageCount: number | null;
  charCount: number;
  warningCount: number;
  warnings: string[];
};

export type ExtractedTextResult = {
  text: string;
  meta: ExtractedTextMeta;
};

function normalizeText(input: string): string {
  const normalizedLineEndings = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmedLineSpaces = normalizedLineEndings
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
  const collapsedBlanks = trimmedLineSpaces.replace(/\n{3,}/g, "\n\n");
  return collapsedBlanks.trim();
}

function extFromFilename(filename: string | null): string {
  if (!filename) {
    return "";
  }
  const idx = filename.lastIndexOf(".");
  if (idx <= 0 || idx === filename.length - 1) {
    return "";
  }
  return filename.slice(idx + 1).toLowerCase();
}

function resolveParser(input: { mimeType: string | null; filename: string | null }): "pdf" | "docx" | "html" | "text" {
  const mime = (input.mimeType ?? "").toLowerCase();
  const ext = extFromFilename(input.filename);

  if (mime.includes("pdf") || ext === "pdf") {
    return "pdf";
  }
  if (
    mime.includes("officedocument.wordprocessingml.document") ||
    mime.includes("msword") ||
    ext === "docx" ||
    ext === "doc"
  ) {
    return "docx";
  }
  if (mime.includes("html") || ext === "html" || ext === "htm") {
    return "html";
  }
  if (
    mime.startsWith("text/") ||
    ext === "txt" ||
    ext === "md" ||
    ext === "markdown"
  ) {
    return "text";
  }
  throw new Error("UNSUPPORTED_TYPE");
}

async function extractPdf(buffer: Buffer): Promise<{ text: string; pageCount: number | null }> {
  const parser = new PDFParse({
    data: buffer
  });
  try {
    const result = await parser.getText();
    return {
      text: result.text ?? "",
      pageCount: Array.isArray(result.pages) ? result.pages.length : null
    };
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<{ text: string; warnings: string[] }> {
  const result = await mammoth.extractRawText({ buffer });
  return {
    text: result.value ?? "",
    warnings: result.messages.map((message) => `${message.type}: ${message.message}`)
  };
}

function extractHtml(buffer: Buffer): string {
  const html = buffer.toString("utf8");
  return htmlToText(html, {
    selectors: [{ selector: "a", options: { ignoreHref: true } }],
    wordwrap: false
  });
}

function extractPlain(buffer: Buffer): string {
  return buffer.toString("utf8");
}

export async function extractText(input: {
  bytes: Buffer;
  mimeType: string | null;
  filename: string | null;
}): Promise<ExtractedTextResult> {
  const parser = resolveParser({ mimeType: input.mimeType, filename: input.filename });
  let rawText = "";
  let pageCount: number | null = null;
  let warnings: string[] = [];

  if (parser === "pdf") {
    const pdf = await extractPdf(input.bytes);
    rawText = pdf.text;
    pageCount = pdf.pageCount;
  } else if (parser === "docx") {
    const docx = await extractDocx(input.bytes);
    rawText = docx.text;
    warnings = docx.warnings;
  } else if (parser === "html") {
    rawText = extractHtml(input.bytes);
  } else {
    rawText = extractPlain(input.bytes);
  }

  const text = normalizeText(rawText);
  return {
    text,
    meta: {
      parser,
      mimeType: input.mimeType,
      filename: input.filename,
      pageCount,
      charCount: text.length,
      warningCount: warnings.length,
      warnings
    }
  };
}
