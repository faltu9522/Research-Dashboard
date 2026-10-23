// Ask AI: builds a question about one paper from the app's own data (its history, the ABDC list, what recent issues of
// each candidate journal actually publish) so the answer rests on facts, not the model's memory. Plain ES5, no browser APIs.
//
// rdGuessApproach(paper)                          -> one of RD_APPROACHES, from the title and notes
// rdJournalProfileUrl(name, issn, mailto)         -> Crossref URL listing that journal's recent articles
// rdJournalProfile(json, name, byIssn)            -> {n, reviews, conceptual, empirical} counted from article titles, or null
// rdAiPrompt(kind, ctx)                           -> the full prompt; ctx = {paper, approach, subs, candidates, profiles, journal, extra}
// rdAiMarkdown(text)                              -> safe HTML for the answer (headings, bold, bullets, links)

var RD_APPROACHES = ["Conceptual", "Literature review", "Empirical – qualitative", "Empirical – quantitative", "Empirical – mixed methods"];
var RD_AI_KINDS = {
  journals: "Fresh journal recommendations",
  after: "Where next after the last rejection",
  fit: "Is a journal a good fit?",
  cover: "Cover letter",
  ask: "My own question"
};

function rdGuessApproach(p) {
  var t = ((p && p.title) || "") + " " + ((p && p.key) || "");
  if (/\b(systematic|bibliometric|scoping|meta-analy|literature review|lit review|integrative review|review of)\b/i.test(t)) return "Literature review";
  if (/\b(text mining|survey|regression|panel|experiment|quantitative|scale development|structural equation)\b/i.test(t)) return "Empirical – quantitative";
  if (/\b(evidence from|interviews?|case study|ethnograph|discourse analysis|cda|news media|fact-checking|qualitative|analysis of)\b/i.test(t)) return "Empirical – qualitative";
  return "Conceptual";
}

function rdNormName(s) {
  return String(s || "").toLowerCase().replace(/&/g, "and").replace(/\(.*?\)/g, " ").replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function rdJournalProfileUrl(name, issn, mailto) {
  var m = mailto ? "&mailto=" + encodeURIComponent(mailto) : "";
  if (issn) return "https://api.crossref.org/journals/" + issn + "/works?filter=from-pub-date:2023-07-01,type:journal-article&rows=150&select=title" + m;
  return "https://api.crossref.org/works?query.container-title=" + encodeURIComponent(name) +
    "&filter=from-pub-date:2023-07-01,type:journal-article&rows=200&select=title,container-title" + m;
}

var RD_REVIEW_RE = /\b(systematic|bibliometric|scoping|meta-analy|literature review|integrative review|review of (the )?(literature|research)|state of the (art|field)|research agenda)\b/i;
var RD_CONCEPT_RE = /\b(theoriz|theoris|toward[s]? an? [a-z\- ]*(theory|framework|account|ontology)|conceptuali[sz]|reconceptuali[sz]|rethinking|reimagining|an essay|ontolog|a critique|critique of|the case for|beyond )/i;
var RD_EMPIRIC_RE = /\b(evidence from|a study of|study of|survey|experiment|interviews?|case of|case study|data from|ethnograph|panel|longitudinal|field study|mixed[- ]method|qualitative study|quantitative|regression)\b/i;

function rdJournalProfile(json, name, byIssn) {
  var items = (json && json.message && json.message.items) || [], want = rdNormName(name), titles = [];
  items.forEach(function (it) {
    if (!it.title || !it.title.length) return;
    if (!byIssn && rdNormName((it["container-title"] || [""])[0]) !== want) return;
    var t = String(it.title[0]);
    if (/^(editorial|erratum|corrigendum|correction|retraction|book review|reviewer|issue information|front matter|introduction to)/i.test(t)) return;
    titles.push(t);
  });
  if (titles.length < 8) return null;
  var c = function (re) { return titles.filter(function (t) { return re.test(t); }).length; };
  return { n: titles.length, reviews: c(RD_REVIEW_RE), conceptual: c(RD_CONCEPT_RE), empirical: c(RD_EMPIRIC_RE),
           sample: titles.slice(0, 4).map(function (t) { return t.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").slice(0, 140); }) };
}

function rdProfileText(p) {
  if (!p) return "no Crossref data";
  return "title signals in " + p.n + " recent articles: " + p.reviews + " reviews, " + p.conceptual + " conceptual, " + p.empirical +
    " empirical (the rest unclear from the title)" + (p.sample && p.sample.length ? "; recent titles: " + p.sample.map(function (t) { return "“" + t + "”"; }).join("; ") : "");
}

/** Journals named on the paper's own shortlist (its notes: "Shortlist (Sheet 2): A; B (Q1); …"), without links. */
function rdShortlist(p) {
  var m = String((p && p.notes) || "").match(/shortlist[^:]*:\s*([^\n]+)/i);
  if (!m) return [];
  return m[1].split(/;\s*/).map(function (x) { return x.replace(/\s*\([^)]*\)\s*$/, "").trim(); })
    .filter(function (x) { return x && !/^https?:/i.test(x) && x.length < 120; });
}

/** The prompt: who is asking, the paper and its full record, candidate journals with evidence, then the task. */
function rdAiPrompt(kind, ctx) {
  var p = ctx.paper, L = [];
  L.push("You are an experienced journal-placement adviser for an academic based in India who works in communication, " +
    "discourse and organization studies (continental philosophy, critical discourse analysis, AI-mediated communication, " +
    "ethics, public administration). They target journals on the ABDC Journal Quality List (2025) and FT50.");
  if (p) {
    L.push("\nPAPER");
    L.push("Short name: " + p.key);
    L.push("Title: " + (p.title || p.key));
    if (p.authors) L.push("Authors: " + p.authors);
    L.push("Approach: " + ctx.approach + (p.type && p.type !== "Journal article" ? " (" + p.type + ")" : ""));
    if (p.notes) L.push("Author's notes: " + p.notes.slice(0, 1500));
    var sent = (ctx.subs || []).filter(function (s) { return s.status !== "Planned"; });
    var planned = (ctx.subs || []).filter(function (s) { return s.status === "Planned"; });
    L.push("\nSUBMISSION HISTORY (oldest first)");
    if (!sent.length) L.push("- not submitted anywhere yet");
    sent.forEach(function (s) {
      L.push("- " + s.journal + (s.abdc ? " (ABDC " + s.abdc + ")" : "") + ": " + s.status +
        (s.submitted ? ", submitted " + s.submitted : "") + (s.decided ? ", decided " + s.decided : "") +
        (s.dtype ? ", " + s.dtype : "") + (s.notes ? " [" + s.notes.slice(0, 160) + "]" : ""));
    });
    if (planned.length) L.push("Queued next by the author: " + planned.map(function (s) { return s.journal; }).join("; "));
    var tried = sent.map(function (s) { return s.journal; }).filter(function (j, i, a) { return a.indexOf(j) === i; });
    if (tried.length) L.push("ALREADY TRIED (never recommend these again): " + tried.join("; "));
  }
  if (ctx.candidates && ctx.candidates.length) {
    L.push("\nCANDIDATE JOURNALS from the ABDC 2025 list that match this paper's fields and topic, with what their recent issues " +
      "publish (from Crossref, articles since mid-2023; title words are a rough signal, so also judge from the sample titles):");
    ctx.candidates.forEach(function (c) {
      L.push("- " + c.title + " — " + (c.grade ? "ABDC " + c.grade : "not on the ABDC 2025 list") + (c.publisher ? ", " + c.publisher : "") +
        (c.mine ? " (on the author's own shortlist)" : "") + " — " + rdProfileText((ctx.profiles || {})[c.title]));
    });
  }
  if (ctx.journal && ctx.profiles && ctx.profiles[ctx.journal] !== undefined)
    L.push("\nJOURNAL IN QUESTION: " + ctx.journal + (ctx.journalAbdc ? " (ABDC " + ctx.journalAbdc + ")" : " (not found on the ABDC 2025 list)") +
      " — " + rdProfileText(ctx.profiles[ctx.journal]));

  L.push("\nTASK");
  var ap = ctx.approach || "paper";
  if (kind === "journals") {
    L.push("Recommend 8 journals for this " + ap.toLowerCase() + " paper: 2 ambitious (one tier above its recent targets), 4 realistic, 2 safer. " +
      "Prefer the candidate list; you may add a journal that is not on it only if it is on the ABDC 2025 list or FT50 (say its rating) — never invent journals. " +
      "For each journal give: name and ABDC rating; whether it publishes " + ap.toLowerCase() + " papers (Yes / Rarely / No) and the evidence " +
      "(the Crossref counts above, a known article type or section, or say 'not sure'); one sentence on why this paper fits; the main risk " +
      "(scope, desk-rejection pattern, length or format rules); and the journal's aims & scope or submission web page if you know it.");
  } else if (kind === "after") {
    var last = (ctx.subs || []).filter(function (s) { return s.status === "Rejected"; }).sort(function (a, b) { return (b.decided || "").localeCompare(a.decided || ""); })[0];
    L.push("The paper was " + (last ? "rejected by " + last.journal + (last.decided ? " on " + last.decided : "") + (last.dtype ? " (" + last.dtype + ")" : "") : "recently rejected") + ". " +
      "1) In 2-3 sentences, the most likely reasons given its history and approach. 2) Three concrete changes to make before resubmitting (framing, " +
      "positioning, length, contribution statement). 3) The next 5 target journals in order, each with ABDC rating, whether it publishes " +
      ap.toLowerCase() + " papers (with evidence or 'not sure'), why it fits and how to reframe the paper for it. Never repeat a journal already tried.");
  } else if (kind === "fit") {
    L.push("Assess whether " + (ctx.journal || "the journal named below") + " is a good home for this " + ap.toLowerCase() + " paper. Give: " +
      "verdict (Strong / Possible / Weak fit); scope match; whether it publishes " + ap.toLowerCase() + " papers (use the Crossref counts, say if unsure); " +
      "2-3 kinds of recent articles it publishes that this paper should speak to; how to position the paper for this journal; " +
      "and 2 alternatives if the fit is weak. If the journal has already rejected this paper, say so first.");
  } else if (kind === "cover") {
    L.push("Draft a concise cover letter (under 300 words) to the editor of " + (ctx.journal || "the target journal") + " for this paper: what it argues, " +
      "its contribution to that journal's conversations, why it fits the journal's scope, and the standard declarations (original, not under " +
      "review elsewhere, no conflicts). Use [square brackets] for anything you do not know; do not invent findings, data or citations.");
  } else {
    L.push("Answer the author's question below" + (p ? " about this paper" : "") + ". If it is about journals, only name real journals and give " +
      "ABDC ratings where you know them; say when you are not sure.");
  }
  if (ctx.extra) L.push("\nAUTHOR'S QUESTION / EXTRA DETAILS: " + ctx.extra);
  L.push("\nFORMAT: plain text with short headings (## Heading), '- ' bullets and **bold** for journal names; no tables. Be specific and concise " +
    "(under 450 words unless drafting a letter). Journal policies change: flag anything the author should check on the journal's website.");
  return L.join("\n");
}

function rdAiEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
}

/** Light Markdown → HTML. Everything is escaped first; links become buttons the app opens in the browser. */
function rdAiMarkdown(text) {
  var inline = function (s) {
    s = rdAiEsc(s);
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (m, t, u) { return '<a href="#" data-act="aiurl" data-url="' + u + '">' + t + "</a>"; });
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:])/g, function (m, pre, u) { return pre + '<a href="#" data-act="aiurl" data-url="' + u + '">' + u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48) + "</a>"; });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>");
    return s;
  };
  var out = [], list = null;
  var close = function () { if (list) { out.push("</" + list + ">"); list = null; } };
  String(text || "").replace(/\r/g, "").split("\n").forEach(function (line) {
    var h = line.match(/^\s*#{1,4}\s+(.*)$/), b = line.match(/^\s*[-*•]\s+(.*)$/), n = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (h) { close(); out.push('<div class="aih">' + inline(h[1]) + "</div>"); }
    else if (b || n) { var want = b ? "ul" : "ol"; if (list !== want) { close(); out.push("<" + want + ">"); list = want; } out.push("<li>" + inline((b || n)[1]) + "</li>"); }
    else if (!line.trim()) { close(); }
    else { close(); out.push("<p>" + inline(line) + "</p>"); }
  });
  close();
  return out.join("");
}

if (typeof module !== "undefined") module.exports = { rdShortlist: rdShortlist, rdGuessApproach: rdGuessApproach, rdJournalProfile: rdJournalProfile, rdJournalProfileUrl: rdJournalProfileUrl,
  rdAiPrompt: rdAiPrompt, rdAiMarkdown: rdAiMarkdown, RD_APPROACHES: RD_APPROACHES };
