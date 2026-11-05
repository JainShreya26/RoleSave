import assert from "node:assert/strict";
import test from "node:test";
import { attachmentKindFromName, contentMatchesKind, type AttachmentKind } from "./attachment-files.ts";

const pdf = attachmentKindFromName("resume.pdf") as AttachmentKind;
const docx = attachmentKindFromName("resume.docx") as AttachmentKind;
const bytes = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));
const realDocx = bytes("PK\u0003\u0004\u0014\u0000[Content_Types].xmlÿ\u0080compressed\u0000PK\u0003\u0004word/document.xmlÿ");

test("accepts only PDF and DOCX names, in any case", () => {
  assert.equal(attachmentKindFromName("Resume.PDF")?.extension, "pdf");
  assert.equal(attachmentKindFromName("CV.final.DocX")?.extension, "docx");
  assert.equal(attachmentKindFromName("resume.doc"), null);
  assert.equal(attachmentKindFromName("notes.txt"), null);
  assert.equal(attachmentKindFromName("pdf"), null);
});

test("recognizes a PDF, including one with stray bytes before its marker", () => {
  assert.equal(contentMatchesKind(pdf, bytes("%PDF-1.7\nrest of the file")), true);
  assert.equal(contentMatchesKind(pdf, bytes("ï»¿\n%PDF-1.4\n")), true);
});

test("refuses a file that is only named like a PDF", () => {
  assert.equal(contentMatchesKind(pdf, bytes("just some text")), false);
  assert.equal(contentMatchesKind(pdf, new Uint8Array()), false);
  assert.equal(contentMatchesKind(pdf, realDocx), false);
  assert.equal(contentMatchesKind(pdf, bytes(`${" ".repeat(1024)}%PDF-1.4`)), false);
});

test("recognizes a DOCX by the parts inside its zip", () => {
  assert.equal(contentMatchesKind(docx, realDocx), true);
});

test("refuses a file that is only named like a DOCX", () => {
  assert.equal(contentMatchesKind(docx, bytes("just some text")), false);
  assert.equal(contentMatchesKind(docx, bytes("%PDF-1.7\nword/ [Content_Types].xml")), false);
  // A zip of something else, and the older Word format.
  assert.equal(contentMatchesKind(docx, bytes("PK\u0003\u0004photos/one.jpg")), false);
  assert.equal(contentMatchesKind(docx, bytes("ÐÏ\u0011à¡±\u001aáword/")), false);
});
