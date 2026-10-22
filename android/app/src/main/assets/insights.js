// Daily research insights: rank recently published papers (Crossref) against the user's own papers and suggest a next study.
// Used by the Google Sheet script (and testable in node), so plain ES5 with no browser APIs.
//
// rdCrossrefUrl(issn, fromDate, mailto)        -> Crossref API URL for that journal's recent articles
// rdCrossrefItems(json, journal)               -> [{doi, title, authors, journal, abdc, ft50, mine, published, abstract}]
// rdRankInsights(items, papers, seenDois, n)   -> top n items with {score, paper (best-matching paper key), why, tip}
//   papers: [{key, title}]

var RD_STOP_I = ("the of and for in on a an to with from by into as at is are was were be this that these those its their our we " +
  "how what why when who whose which not no new study studies paper article research analysis approach role case evidence " +
  "using use toward towards between through within among across beyond after over under about via based theory theoretical " +
  "empirical review perspective perspectives implications insights understanding exploring examining effects effect impact " +
  "do does can may might more less than also both one two three first").split(" ");
var RD_STOP_SET = {};
RD_STOP_I.forEach(function (w) { RD_STOP_SET[w] = 1; });

// Extra vocabulary per theme, so a paper about "voice" or "mourning" can still meet a "silence" or "grief" paper.
var RD_THEMES = [
  ["silence", "silencing", "voice", "speaking", "unsaid", "absence"], ["death", "dying", "mortality", "finitude", "mourning", "grief", "grieving"],
  ["blanchot", "derrida", "heidegger", "levinas", "foucault", "deconstruction", "phenomenology", "hauntology", "spectral"],
  ["discourse", "discursive", "critical discourse", "rhetoric", "narrative", "framing", "language"],
  ["generative", "artificial intelligence", "chatgpt", "algorithm", "algorithmic", "automation", "large language"],
  ["securitization", "securitisation", "security", "threat", "surveillance"], ["protest", "activism", "movement", "resistance", "dissent"],
  ["leadership", "leader", "authority", "power", "sovereignty", "violence"], ["ethics", "ethical", "moral", "virtue", "responsibility"],
  ["knowledge hiding", "knowledge sharing", "tacit knowledge", "knowledge"], ["memory", "remembrance", "commemoration", "temporality", "time"],
  ["advertising", "marketing", "brand", "consumer", "virtue signalling", "csr"], ["apology", "apologies", "crisis communication", "accountability"],
  ["kinship", "family", "belonging", "identity", "organizational culture"], ["fact-checking", "misinformation", "disinformation", "attribution", "news"],
  ["assessment", "testing", "multilingual", "linguistic"], ["hedging", "uncertainty", "epistemic"], ["india", "indian", "global south", "postcolonial"]
];

function rdText(s) { return String(s || "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim(); }
function rdTokens(s) {
  var t = " " + rdText(s).toLowerCase().replace(/[‘’'`]/g, "").replace(/[^a-z0-9\- ]+/g, " ") + " ";
  return t.split(/\s+/).filter(function (w) { return w.length > 2 && !RD_STOP_SET[w]; })
    .map(function (w) { return w.replace(/(ies)$/, "y").replace(/([^s])s$/, "$1"); });
}

function rdCrossrefUrl(issn, fromDate, mailto) {
  return "https://api.crossref.org/journals/" + issn + "/works?filter=from-pub-date:" + fromDate + ",type:journal-article" +
    "&rows=60&sort=published&order=desc&select=DOI,title,author,published,container-title,abstract" + (mailto ? "&mailto=" + encodeURIComponent(mailto) : "");
}

function rdCrossrefItems(json, journal) {
  var items = (json && json.message && json.message.items) || [];
  return items.filter(function (w) { return w.DOI && w.title && w.title.length; }).map(function (w) {
    var d = (w.published && w.published["date-parts"] && w.published["date-parts"][0]) || [];
    var pad = function (x) { return x < 10 ? "0" + x : "" + x; };
    return {
      doi: String(w.DOI).toLowerCase(), title: rdText(w.title[0]),
      authors: (w.author || []).slice(0, 4).map(function (a) { return [a.family, a.given ? a.given.charAt(0) + "." : ""].filter(Boolean).join(", "); }).join("; ") + ((w.author || []).length > 4 ? " et al." : ""),
      journal: journal.name, abdc: journal.abdc || "", ft50: !!journal.ft50, mine: !!journal.mine,
      published: d.length ? d[0] + "-" + pad(d[1] || 1) + "-" + pad(d[2] || 1) : "", abstract: rdText(w.abstract).replace(/^abstract\s*/i, "")
    };
  });
}

/** Ranks items: rare words shared with one of the user's papers, in the title (x2) and abstract, plus theme links. */
function rdRankInsights(items, papers, seenDois, n) {
  n = n || 5;
  seenDois = seenDois || {};
  var df = {}, N = items.length || 1;
  items.forEach(function (it) { var s = {}; rdTokens(it.title + " " + it.abstract).forEach(function (w) { if (!s[w]) { s[w] = 1; df[w] = (df[w] || 0) + 1; } }); });
  var idf = function (w) { return Math.log((N + 1) / (1 + (df[w] || 0))); };
  var themeOf = {};
  RD_THEMES.forEach(function (th, i) { th.forEach(function (w) { rdTokens(w).forEach(function (t) { themeOf[t] = i; }); }); });
  var profiles = papers.map(function (p) {
    var words = {}, themes = {};
    rdTokens(p.key + " " + p.title).forEach(function (w) { words[w] = 1; if (themeOf[w] !== undefined) themes[themeOf[w]] = 1; });
    return { p: p, words: words, themes: themes };
  });
  var scored = [];
  items.forEach(function (it) {
    if (seenDois[it.doi] || !it.title || /^(editorial|erratum|corrigendum|correction|retraction|book review|reviewer|index|issue information|front matter)/i.test(it.title)) return;
    var tw = rdTokens(it.title), aw = rdTokens(it.abstract), best = null;
    var tset = {}, aset = {};
    tw.forEach(function (w) { tset[w] = 1; }); aw.forEach(function (w) { aset[w] = 1; });
    profiles.forEach(function (pr) {
      var sc = 0, hits = [], th = {};
      Object.keys(pr.words).forEach(function (w) {
        if (tset[w]) { sc += 2 * idf(w); hits.push(w); } else if (aset[w]) { sc += 0.8 * idf(w); hits.push(w); }
      });
      Object.keys(tset).concat(Object.keys(aset)).forEach(function (w) { var t = themeOf[w]; if (t !== undefined && pr.themes[t] && !th[t]) { th[t] = 1; sc += 2.5; } });
      sc = sc / Math.sqrt(Math.max(4, tw.length));
      if (!best || sc > best.score) best = { score: sc, pr: pr, hits: hits };
    });
    if (!best || best.score <= 0) return;
    var boost = (it.abdc === "A*" || it.ft50 ? 0.6 : it.abdc === "A" ? 0.35 : 0) + (it.mine ? 0.3 : 0) + (it.abstract ? 0.2 : 0);
    scored.push({ it: it, score: best.score + boost, paper: best.pr.p, hits: best.hits });
  });
  scored.sort(function (a, b) { return b.score - a.score; });
  var out = [], perPaper = {}, perJournal = {};
  scored.forEach(function (x) {
    if (out.length >= n) return;
    var pk = x.paper.key;
    if ((perPaper[pk] || 0) >= 2 || (perJournal[x.it.journal] || 0) >= 1) return;
    perPaper[pk] = (perPaper[pk] || 0) + 1; perJournal[x.it.journal] = 1;
    out.push(rdDescribe(x));
  });
  scored.forEach(function (x) { if (out.length < n && out.every(function (o) { return o.doi !== x.it.doi; })) out.push(rdDescribe(x)); });
  return out;
}

function rdDescribe(x) {
  var it = x.it, p = x.paper;
  var shared = x.hits.filter(function (w, i, a) { return a.indexOf(w) === i; }).slice(0, 4);
  var o = {};
  Object.keys(it).forEach(function (k) { o[k] = it[k]; });
  o.score = Math.round(x.score * 100) / 100;
  o.paper = p.key;
  o.why = "Close to your paper “" + p.key + "”" + (shared.length ? " (shared focus: " + shared.join(", ") + ")" : " (allied theme)") + ".";
  o.tip = rdTip(it, p, shared);
  return o;
}

/** A structured next-study prompt (the optional Claude-written ideas replace this when an API key is set). */
function rdTip(it, p, shared) {
  var words = function (s) { return rdText(s).replace(/[‘’“”"]/g, "").split(/[^A-Za-z\-]+/).filter(function (w) { return w.length > 4 && !RD_STOP_SET[w.toLowerCase()]; }); };
  var theirs = rdTokens(it.title).join(" ");
  var lens = words(p.title || p.key).filter(function (w) { return theirs.indexOf(rdTokens(w)[0] || "~") < 0; })
    .filter(function (w, i, a) { return a.indexOf(w) === i; }).slice(0, 3).join(", ");
  var topic = rdText(it.title).split(/[:?—–]/)[0].trim();
  var all = ((p.title || "") + " " + p.key).toLowerCase();
  var method = /review|bibliometric|systematic/.test(all) ? "a systematic or bibliometric review" :
    /discourse|cda|language|rhetoric|speech/.test(all) ? "a critical discourse analysis" :
    /blanchot|derrida|heidegger|levinas|foucault/.test(all) ? "a conceptual paper" : "a qualitative, interpretive study";
  var context = /india|indian|malawi/.test(all) ? "Indian / Global South settings" : "an under-studied setting (e.g. India or the Global South)";
  return "Next-study idea: " + method.charAt(0).toUpperCase() + method.slice(1) + " that takes up “" + topic + "” through the lens of your paper “" +
    p.key + "”" + (lens ? " (" + lens + ")" : "") + " in " + context + ", stating what their account leaves unexplained.";
}

if (typeof module !== "undefined") module.exports = { rdCrossrefUrl: rdCrossrefUrl, rdCrossrefItems: rdCrossrefItems, rdRankInsights: rdRankInsights };
