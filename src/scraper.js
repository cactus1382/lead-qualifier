// Site ingest. Fetches the pages, strips them to text, stores them as the
// knowledge base. Deliberately simple: one domain, depth 1, text-only.

const fs = require("fs");
const path = require("path");
const { saveKb, saveSite, siteDir } = require("./store");

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function linksFrom(html, base) {
  const out = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    try {
      const u = new URL(m[1], base);
      if (u.protocol === "http:" || u.protocol === "https:") out.push(u.href);
    } catch (e) {}
  }
  return out;
}

async function fetchText(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; SiteChatIngest/1.0)" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    return { html, finalUrl: res.url };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function ingest(site, rootUrl) {
  const first = await fetchText(rootUrl);
  if (!first) throw new Error("could not fetch " + rootUrl);

  let origin;
  try {
    origin = new URL(first.finalUrl || rootUrl);
  } catch (e) {
    throw new Error("bad url");
  }

  const name = (() => {
    const t = String(first.html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return t ? stripHtml(t[1]).slice(0, 80) : origin.hostname;
  })();

  const childLinks = Array.from(new Set(linksFrom(first.html, first.finalUrl)))
    .filter((u) => {
      try {
        const x = new URL(u);
        return x.origin === origin.origin && !x.hash && x.pathname !== origin.pathname;
      } catch (e) {
        return false;
      }
    })
    .slice(0, 12);

  const pages = [{ url: first.finalUrl || rootUrl, text: stripHtml(first.html) }];

  for (const link of childLinks) {
    if (pages.length >= 13) break;
    const got = await fetchText(link);
    if (got && got.html && got.html.length > 400) {
      pages.push({ url: got.finalUrl || link, text: stripHtml(got.html) });
    }
  }

  const kb = {
    site: origin.hostname,
    ingestedAt: new Date().toISOString(),
    pages,
  };
  saveKb(site, kb);
  saveSite(site, { name, url: origin.href, ingestedAt: kb.ingestedAt });

  return { pages: pages.length, name };
}

module.exports = { ingest, stripHtml, linksFrom, fetchText };
