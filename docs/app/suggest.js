// Next-journal recommendations from the ABDC list. Shared by the app and the Google Sheet script
// (google-sheets/RD-SK-sync.gs embeds a copy), so plain ES5 with no browser APIs.
//
// rdSuggest(paper, subs, abdc, n) -> [{title, grade, field, publisher, score, why}]
//   paper: {key, title}; subs: that paper's submissions [{journal, status, submitted, decided}];
//   abdc: [[title, grade, FoR code, publisher], ...]
// A journal scores for: sharing an ABDC field with journals already chosen for the paper, wording that matches the
// paper's title and those journals (rarer words count more), and a tier close to the journal that last rejected it.
var RD_TIERS = { "A*": 4, "A": 3, "B": 2, "C": 1 };
var RD_STOP = { the: 1, of: 1, and: 1, "for": 1, "in": 1, on: 1, a: 1, an: 1, to: 1, journal: 1, international: 1, review: 1,
  research: 1, studies: 1, quarterly: 1, annals: 1, letters: 1, proceedings: 1, transactions: 1, s: 1, at: 1, by: 1, with: 1,
  from: 1, its: 1, their: 1, our: 1, what: 1, how: 1, who: 1, whose: 1, is: 1, are: 1, not: 1, "new": 1, one: 1 };
var rdIdfCache = null;

function rdNorm(s) {
  return String(s || "").toLowerCase().replace(/&/g, "and").replace(/\(.*?\)/g, " ").replace(/-a$/, "")
    .replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function rdWords(s) {
  return rdNorm(s).split(" ").filter(function (w) { return w.length > 2 && !RD_STOP[w]; })
    .map(function (w) { return w.replace(/(ies)$/, "y").replace(/([^s])s$/, "$1"); });
}
function rdIdf(abdc) {
  if (rdIdfCache && rdIdfCache.n === abdc.length) return rdIdfCache;
  var df = {};
  abdc.forEach(function (j) { var seen = {}; rdWords(j[0]).forEach(function (w) { if (!seen[w]) { seen[w] = 1; df[w] = (df[w] || 0) + 1; } }); });
  rdIdfCache = { n: abdc.length, df: df, byName: {} };
  abdc.forEach(function (j) { rdIdfCache.byName[rdNorm(j[0])] = j; });
  return rdIdfCache;
}
function rdLookup(abdc, journal) { return rdIdf(abdc).byName[rdNorm(journal)] || null; }

function rdSuggest(paper, subs, abdc, n) {
  n = n || 8;
  var idx = rdIdf(abdc), N = abdc.length;
  var w = function (word) { return Math.log(N / (1 + (idx.df[word] || 0))); };
  var used = {}, fields = {}, nFields = 0, bag = {};
  var add = function (word, k) { bag[word] = (bag[word] || 0) + k; };
  rdWords((paper.title || "") + " " + (paper.key || "")).forEach(function (x) { add(x, 2); });
  var last = null;
  subs.forEach(function (s) {
    used[rdNorm(s.journal)] = 1;
    var j = rdLookup(abdc, s.journal);
    if (j) { fields[j[2]] = (fields[j[2]] || 0) + 1; nFields++; rdWords(j[0]).forEach(function (x) { add(x, 1); }); }
    else rdWords(s.journal).forEach(function (x) { add(x, 1); });
    if (j && s.status !== "Planned" && (!last || (s.submitted || "") >= (last.s.submitted || ""))) last = { s: s, j: j };
  });
  // tier to aim for: the journal it was last sent to, else the best one it was aimed at
  var target = last ? RD_TIERS[last.j[1]] : 0;
  if (!target) subs.forEach(function (s) { var j = rdLookup(abdc, s.journal); if (j) target = Math.max(target, RD_TIERS[j[1]]); });
  if (!target) target = 3;
  var out = [], pass = function (anyField) { abdc.forEach(function (j) {
    if (used[rdNorm(j[0])] || /^annual review/i.test(j[0])) return;           // invite-only review series
    var f = nFields ? (fields[j[2]] || 0) / nFields : 0;
    if (nFields && !f && !anyField) return;                                     // stay in the paper's ABDC fields
    if (anyField && f) return;                                                  // (already scored in the first pass)
    var words = rdWords(j[0]), topic = 0, hits = [], seen = {};
    words.forEach(function (x) { if (bag[x] && !seen[x]) { seen[x] = 1; topic += Math.min(bag[x], 3) * w(x); hits.push(x); } });
    if (!topic || (anyField && hits.length < 2)) return;                        // outside its fields: need a clear topic match
    topic = topic / Math.sqrt(Math.max(words.length, 1));                       // long titles don't win on word count
    var gap = RD_TIERS[j[1]] - target;
    var tier = gap === 0 ? 3 : gap === -1 ? 2.2 : gap === 1 ? 1.8 : gap === -2 ? 0.6 : 0;
    var score = topic + f * 4 + tier * 3 - (anyField ? 6 : 0);
    out.push({ title: j[0], grade: j[1], field: j[2], publisher: j[3], score: score,
      why: "matches “" + hits.slice(0, 3).join(", ") + "”" + (anyField ? " · related field" : "") });
  }); };
  pass(false);
  if (out.length < n && nFields) pass(true);                                    // few in-field matches: look wider
  out.sort(function (a, b) { return b.score - a.score; });
  return out.slice(0, n);
}
if (typeof module !== "undefined") module.exports = { rdSuggest: rdSuggest, rdLookup: rdLookup, rdNorm: rdNorm };
