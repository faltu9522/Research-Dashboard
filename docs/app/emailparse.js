// Reads a journal email: what happened, desk or reviewed, how many reviews, manuscript ID, and which submission it is.
// Shared by the app (paste / share an email) and the Google Sheet script (Gmail import), so plain ES5 with no browser APIs.
//
// rdParseEmail({subject, from, body, date}, subs) -> {
//   event: "submitted" | "resubmitted" | "under review" | "Rejected" | "Revision requested" | "Accepted" | "Returned by office" | "Withdrawn" | "",
//   status, dtype ("Desk rejection" | "Rejected after review" | ""), reviews, msid, sub, score, confident, reasons[], skip }
//   subs: [{id, paper, title, titleUsed, journal, status, submitted, msid}]  (paper = short name, title = full title)
//
// Built to err on the side of "please confirm": a status only changes on its own when the email clearly names the paper.

var RD_MSID = /\b[A-Z][A-Z0-9&]{1,14}(?:-[A-Z]{1,2})?(?:-\d{2,6}){2,3}(?:\.R\d+)?\b/;
var RD_ORDER = { "Planned": 0, "Under review": 1, "Returned by office": 2, "Revision requested": 2, "Revision resubmitted": 3,
  "Rejected": 4, "Accepted": 4, "Withdrawn": 4 };
var RD_DECISIONS = { "Rejected": 1, "Accepted": 1, "Revision requested": 1, "Returned by office": 1, "Withdrawn": 1 };

function rdEmailNorm(s) {
  return " " + String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[‘’'`"“”]/g, "").replace(/[^a-z0-9]+/g, " ").trim() + " ";
}
function rdEmailWords(s) {
  var stop = { the: 1, and: 1, "for": 1, from: 1, with: 1, into: 1, that: 1, this: 1, their: 1, what: 1, whose: 1, when: 1,
    toward: 1, towards: 1, between: 1, through: 1, within: 1, journal: 1, paper: 1, study: 1, analysis: 1, review: 1,
    organizational: 1, organization: 1, communication: 1, management: 1, social: 1, critical: 1, theory: 1, ethics: 1 };
  return rdEmailNorm(s).split(" ").filter(function (w) { return w.length > 3 && !stop[w]; });
}
/** Share of the paper's distinctive title words found in the text (common field words don't count). */
function rdEmailOverlap(a, text) {
  var A = rdEmailWords(a).filter(function (w, i, arr) { return arr.indexOf(w) === i; });
  if (A.length < 2) return 0;
  var T = rdEmailNorm(text), hit = 0;
  A.forEach(function (w) { if (T.indexOf(" " + w + " ") >= 0) hit++; });
  return hit / A.length;
}
function rdBaseId(id) { return String(id || "").toUpperCase().replace(/\.R\d+$/, ""); }

/** The email's own text: drops quoted replies (keeps a forwarded email, which is what you want read). */
function rdEmailOwnText(body) {
  var t = String(body || "").replace(/\r/g, "");
  var cut = t.search(/^\s*(On .{5,160}wrote:|-{2,}\s*Original Message\s*-{2,}|>{1,}\s)/m);
  return cut > 40 ? t.slice(0, cut) : t;
}

/** Sentences that state something, not boilerplate rules ("papers that ... may be rejected", "if you decline ..."). */
function rdEmailFactual(text) {
  return String(text || "").replace(/\n\s*\n/g, ". ").replace(/\s+/g, " ").replace(/([.!?])\s+/g, "$1\n").split("\n").filter(function (s) {
    return !/\b(if|may|might|could|should|unless|whether|policy|policies|guidelines?|instructions|percent|%|typically|usually|generally|please note|papers that|manuscripts that|submissions that|articles that|those that|any (paper|manuscript|submission)s?)\b/i.test(s);
  }).join(" ").toLowerCase();
}

/** What the email says happened. Strong decision phrases only, in factual sentences; acknowledgements otherwise. */
function rdEmailEvent(text, subject) {
  var raw = String(text || "").toLowerCase().replace(/\s+/g, " "), x = rdEmailFactual(text), subj = String(subject || "").toLowerCase();
  if (/(pleased|delighted|happy) to (inform you that .{0,140})?accept (your|the|this)|(has|have) been accepted for publication|accepted (it )?for publication in|decision (is|was|:)\s*(to )?accept\b|final acceptance of your/.test(x)) return "Accepted";
  if (/(decision|recommendation)\s*(is|was|:)\s*(a\s*)?(major|minor) revision|(major|minor) revisions? (are|is) (required|needed|necessary|requested)|reviewers? (recommend|have recommended|suggest) (major|minor) revision|revise and resubmit|invit\w* you to (revise|resubmit|submit a revised)|(would|will) be (happy|pleased|glad) to (see|consider|receive) a revised|your manuscript (requires|needs) (major|minor) revision/.test(x)) return "Revision requested";
  if (/regret to (inform|advise|tell|let you know)|unable to (accept|publish|offer|consider|proceed with) (your|this|the|it\b)|not (be )?able to (accept|publish|offer|consider|proceed with) (your|this|the|it\b)|(did|does) not pass (the )?(editorial|initial) (screening|assessment|check)|decided (not to (publish|accept|proceed|pursue|send|consider|take)|to reject|against (publication|publishing|accepting))|(must|have to|will have to|am obliged to|regretfully) decline (your|this|the)|declin(e|ed) (your|this|the) (manuscript|paper|submission|article) for publication|reject(ed)? (your|this|the) (manuscript|paper|submission|article)|your (manuscript|paper|submission|article) (has been|was|is) (rejected|declined|not accepted)|decision\s*(on your manuscript\s*)?(is|was|:)\s*(to\s*)?reject|cannot (accept|publish|consider) (your|this|the)|will not be (considering|considered|published|proceeding) (it |your |this |the )?(further|for publication|for review)|not (be )?(proceeding|moving forward|taking (it|your (manuscript|paper)) forward) with (your|this|the)/.test(x)) return "Rejected";
  if (/(manuscript|submission|paper) (has been|was|is being) (unsubmitted|returned to you|sent back to you)|unsubmitted (your|the) (manuscript|submission)|returned (to you )?for (correction|changes|revision of (format|formatting))|please (address|correct) the following (issues|points|items) (and|before) resubmit/.test(x) || /unsubmitted|returned to author|technical check (failed|result)/.test(subj)) return "Returned by office";
  if (/(your|the) (manuscript|submission) (has been|was) withdrawn|confirm(ing)? (the )?withdrawal of (your|the) (manuscript|submission)/.test(x)) return "Withdrawn";
  if (/revised (manuscript|version|paper|submission)|revision (has been|was) (successfully )?(submitted|received)/.test(raw) && /(successfully )?(submitted|received)|thank you for (submitting|your)/.test(raw)) return "resubmitted";
  if (/(has|have) been (sent|send) (out )?(for|to) (external |peer )?review|(sent|send) (it |your manuscript |the manuscript )?out for (external |peer )?review|reviewers? (have been|has been) (invited|assigned|contacted|selected) (for|to)|now under (peer )?review/.test(x)) return "under review";
  if (/successfully submitted|been (successfully )?(submitted|received)|received your (manuscript|submission|paper)|thank you for (submitting|your submission)|acknowledg\w+ (the )?receipt|submission (has been )?received|confirm(ing|s)? (the )?(receipt|submission)/.test(raw) ||
      /(submission|manuscript).{0,40}(received|submitted|confirmation|acknowledg)|acknowledg/.test(subj)) return "submitted";
  return "";
}

/** Desk rejection vs rejection after review, and how many reviewer reports are in the email. */
function rdEmailReviews(text) {
  var t = String(text || ""), x = rdEmailFactual(t), n = 0, m, re = /\b(?:reviewer|referee)\s*(?:#|no\.?|number)?\s*:?\s*(\d{1,2})\b/gi;
  while ((m = re.exec(t))) if (+m[1] < 10) n = Math.max(n, +m[1]);
  if (!n && /(reviewer|referee)s?'?\s*(comments|reports?)\s*(to (the )?author|:)/i.test(t)) n = 1;
  var desk = /without (sending it |being sent )?(out )?(for )?(external |peer )?review|not (be )?sent (it )?(out )?for (external |peer )?review|decided not to send|not send (it|your (manuscript|paper)) (out )?(for|to) (external |peer )?review|desk[- ]?reject|outside (the )?(aims and )?scope of|not a (good )?fit (for|with) (the|this|our)|does not fit (the|within)/.test(x);
  return { reviews: n, desk: desk && !n, reviewed: n > 0 || /reviewers? (have|has) (now )?(commented|reviewed|completed|returned)|comments from the reviewers|reviewers'? (comments|reports) (are|is) (below|attached|included)/.test(x) };
}

/** Journal names that occur in the text; a name inside a longer matching name (Organization ⊂ Organization Theory) is dropped. */
function rdJournalHits(text, journals) {
  var hits = journals.filter(function (j) { return j.length > 5 && text.indexOf(j) >= 0; });
  return hits.filter(function (j) { return !hits.some(function (k) { return k !== j && k.indexOf(j) >= 0; }); });
}

function rdParseEmail(mail, subs) {
  var subject = mail.subject || "", from = mail.from || "", body = rdEmailOwnText(mail.body);
  // emails about reviewing other people's work are not about your submissions
  var skip = /invitation to review|invite you to review|review (the|a|this) manuscript|thank you for (your )?review|reviewer (invitation|reminder|report|assignment)|as a reviewer|review (is|was) (overdue|due)|your review (of|for)/i.test(subject + "\n" + body.slice(0, 1200));
  var event = skip ? "" : rdEmailEvent(subject + "\n" + body, subject);
  var idm = (subject.match(RD_MSID) || body.match(RD_MSID) || [""])[0];
  var rv = rdEmailReviews(body);
  var top = rdEmailNorm(subject + " " + from), head = rdEmailNorm(body.slice(0, 2500));
  var names = {};
  (subs || []).forEach(function (s) { names[rdEmailNorm(String(s.journal || "").replace(/-A$/, "").replace(/\(.*?\)/g, ""))] = 1; });
  var nameList = Object.keys(names), topHits = rdJournalHits(top, nameList), headHits = rdJournalHits(head, nameList);
  var titleText = subject + "\n" + body.slice(0, 4000);
  var best = null, bestScore = 0, reasons = [], bestOv = 0, scores = [];
  (subs || []).forEach(function (s) {
    var sc = 0, why = [];
    var idMatch = idm && s.msid && rdBaseId(s.msid) === rdBaseId(idm);
    if (idMatch) { sc += 100; why.push("manuscript ID"); }
    var j = rdEmailNorm(String(s.journal || "").replace(/-A$/, "").replace(/\(.*?\)/g, ""));
    if (topHits.indexOf(j) >= 0) { sc += 30; why.push("journal"); } else if (headHits.indexOf(j) >= 0) { sc += 12; why.push("journal in text"); }
    var ov = Math.max(rdEmailOverlap(s.title, titleText), rdEmailOverlap(s.titleUsed, titleText), rdEmailOverlap(s.paper, titleText));
    if (ov >= 0.5) { sc += 50 * ov; why.push("title " + Math.round(ov * 100) + "%"); }
    var open = s.status === "Under review" || s.status === "Revision requested" || s.status === "Returned by office";
    // the attempt from the email's time: submitted on/before the email, the closer the better
    if (mail.date && s.submitted) {
      var gap = (Date.parse(mail.date) - Date.parse(s.submitted)) / 864e5;
      sc += gap < -2 ? -25 : 6 - Math.min(gap, 600) / 120;
    }
    if (event === "submitted" && s.status === "Planned") sc += 6;
    else if (event === "resubmitted" && (s.status === "Revision requested" || s.status === "Returned by office")) sc += 8;
    else if ((RD_DECISIONS[event] || event === "under review") && open) sc += 6;
    scores.push({ s: s, sc: sc });
    if (sc > bestScore) { bestScore = sc; best = s; reasons = why; bestOv = ov; }
  });
  // the closest rival is the best-scoring row of a different paper (another attempt of the same paper is not a rival)
  var second = 0;
  scores.forEach(function (x) { if (best && x.s.paper !== best.paper && x.sc > second) second = x.sc; });
  var hasId = reasons.indexOf("manuscript ID") >= 0, hasJournal = reasons.indexOf("journal") >= 0 || reasons.indexOf("journal in text") >= 0;
  // A decision changes a row on its own only with the manuscript ID, or the journal plus most of the paper's title, and no close rival.
  var confident = !!best && !!event && !skip && (hasId ||
    (hasJournal && bestOv >= (RD_DECISIONS[event] ? 0.6 : 0.5) && bestScore - second >= 15));
  var status = { "submitted": "Under review", "resubmitted": "Under review", "under review": "Under review" }[event] || event;
  var dtype = "";
  if (event === "Rejected") dtype = rv.desk ? "Desk rejection" : rv.reviewed ? "Rejected after review" : "";
  return { event: event, status: status, dtype: dtype, reviews: rv.reviews, msid: idm, sub: bestScore >= 30 ? best : null,
           score: bestScore, confident: confident, reasons: reasons, skip: skip };
}

if (typeof module !== "undefined") module.exports = { rdParseEmail: rdParseEmail, rdEmailEvent: rdEmailEvent, rdEmailReviews: rdEmailReviews, RD_ORDER: RD_ORDER };
