import * as cheerio from "cheerio";
import { MailParser, type AddressObject, type Headers, type MailParserOptions } from "mailparser";
import { scoreEmailMetadata } from "./classify";
import type { ParsedEmail } from "./types";

const maximumBodyCharacters = 200_000;

function cleanWhitespace(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maximumBodyCharacters);
}

function cleanHtml(html: string) {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,img,head").remove();
  $("br").replaceWith("\n");
  $("p,div,li,tr,h1,h2,h3,h4,h5,h6,blockquote").append("\n");

  const links = $("a[href]")
    .map((_index, element) => $(element).attr("href"))
    .get()
    .filter((value): value is string => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      } catch {
        return false;
      }
    })
    .slice(0, 50);

  return { links, text: cleanWhitespace($("body").text()) };
}

function headerString(headers: Headers, name: string) {
  const value = headers.get(name);
  if (typeof value === "string") return value;
  return null;
}

function firstAddress(value: unknown) {
  const address = value as AddressObject | undefined;
  const first = address?.value?.find((item) => "address" in item && item.address);
  if (!first || !("address" in first)) return { address: null, name: null };
  return { address: first.address?.toLowerCase() ?? null, name: first.name || null };
}

function parseDate(headers: Headers) {
  const value = headers.get("date");
  return value instanceof Date && !Number.isNaN(value.valueOf())
    ? value.toISOString()
    : new Date().toISOString();
}

function parseThreadId(headers: Headers): string | null {
  const references = headers.get("references");
  if (Array.isArray(references)) return references.find((value): value is string => typeof value === "string") ?? null;
  if (typeof references === "string") return references;
  return headerString(headers, "in-reply-to");
}

export async function parseRawEmail(rawEmail: Buffer): Promise<ParsedEmail> {
  const options: MailParserOptions = {
    maxHtmlLengthToParse: maximumBodyCharacters * 2,
    skipHtmlToText: true,
    skipImageLinks: true,
    skipTextLinks: true,
    skipTextToHtml: true,
  };

  return new Promise((resolve, reject) => {
    const parser = new MailParser(options);
    let headers: Headers | null = null;
    let keepBody = false;
    let metadataScore = 0;
    let bodyText = "";
    let links: string[] = [];

    parser.on("headers", (parsedHeaders) => {
      headers = parsedHeaders;
      const from = firstAddress(parsedHeaders.get("from"));
      const senderDomain = from.address?.split("@").at(-1) ?? null;
      metadataScore = scoreEmailMetadata({
        hasUnsubscribe: parsedHeaders.has("list-unsubscribe"),
        senderDomain,
        subject: headerString(parsedHeaders, "subject") ?? "",
      });
      keepBody = metadataScore >= 20;
    });

    parser.on("data", (part) => {
      if (part.type === "attachment") {
        part.content.on("end", () => part.release());
        part.content.resume();
        return;
      }
      if (!keepBody) return;

      if (part.html) {
        const cleaned = cleanHtml(part.html);
        links = cleaned.links;
        bodyText = part.text ? cleanWhitespace(part.text) : cleaned.text;
      } else {
        bodyText = cleanWhitespace(part.text ?? "");
      }
    });

    parser.on("error", reject);
    parser.on("end", () => {
      if (!headers) {
        reject(new Error("Email headers could not be parsed."));
        return;
      }
      const from = firstAddress(headers.get("from"));
      resolve({
        bodyText,
        hasUnsubscribe: headers.has("list-unsubscribe"),
        links,
        messageId: headerString(headers, "message-id"),
        metadataScore,
        receivedAt: parseDate(headers),
        senderAddress: from.address,
        senderDomain: from.address?.split("@").at(-1) ?? null,
        senderName: from.name,
        subject: headerString(headers, "subject") ?? "",
        threadId: parseThreadId(headers),
      });
    });

    parser.end(rawEmail);
  });
}
