// Reads a journal email: what happened, desk or reviewed, how many reviews, manuscript ID, and which submission it is.
// Shared by the app (paste / share an email) and the Google Sheet script (Gmail import), so plain ES5 with no browser APIs.
//
// rdParseEmail({subject, from, body, date}, subs) -> {
//   event: "submitted" | "resubmitted" | "under review" | "Rejected" | "Revision requested" | "Accepted" | "Returned by office" | "Withdrawn" | "",
//   status, dtype ("Desk rejection" | "Rejected after review" | ""), reviews, msid, sub, score, confident, reasons[] }
//   subs: [{id, paper, title, titleUsed, journal, status, submitted, msid}]  (paper = short name, title = full title)

var RD_MSID = /\b[A-Z][A-Z0-9&]{1,14}(?:-[A-Z]{1,2})?(?:-\d{2,6}){2,3}(?:\.R\d+)?\b/;
var RD_ORDER = { "Planned": 0, "Under review": 1, "Returned by office": 2, "Revision requested": 2, "Revision resubmitted": 3,
  "Rejected": 4, "Accepted": 4, "Withdrawn": 4 };

function rdEmailNorm(s) {
  return " " + String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[‘’'`"“”]/g, "").replace(/[^a-z0-9]+/g, " ").trim() + " ";
}
function rdEmailWords(s) {
  var stop = { the: 1, and: 1, "for": 1, from: 1, with: 1, into: 1, that: 1, this: 1, their: 1, what: 1, whose: 1, when: 1 };
  return rdEmailNorm(s).split(" ").filter(function (w) { return w.length > 3 && !stop[w]; });
}
function rdEmailOverlap(a, text) {
  var A = rdEmailWords(a);
  if (!A.length) return 0;
  var T = rdEmailNorm(text), hit = 0;
  A.forEach(function (w) { if (T.indexOf(" " + w + " ") >= 0) hit++; });
  return hit / A.length;
}
function rdBaseId(id) { return String(id || "").toUpperCase().replace(/\.R\d+$/, ""); }

/** What the email says happened. Decisions are checked before acknowledgements (a rejection also says "thank you for submitting"). */
function rdEmailEvent(text) {
  var x = String(text || "").toLowerCase().replace(/\s+/g, " ");
  if (/pleased to (inform you that .{0,120})?accept|(has|have) been accepted for publication|accepted (it )?for publication in|decision (is|was) to accept/.test(x)) return "Accepted";
  if (/major revisions?\b|minor revisions?\b|revise and resubmit|r\s?&\s?r\b|invit\w* you to (revise|resubmit|submit a revised)|(would|will) be (happy|pleased|glad) to (see|consider|receive) a revised|revisions? (are|is) (required|needed|necessary)|decision (is|was) (a )?(major|minor) revision/.test(x)) return "Revision requested";
  if (/regret|unable to (accept|publish|offer|consider)|not (be )?able to (accept|publish|offer|consider)|decided (not|against) (to )?(publish|accept|proceed|pursue|send)|cannot (be )?(accept|publish|consider)|not suitable for (publication|the journal|this journal)|reject|declin(e|ed) (your|the|this) (manuscript|paper|submission)|will not be (considered|published|proceeding)|not (be )?(proceeding|moving forward|taking (it|your (manuscript|paper)) forward)/.test(x)) return "Rejected";
  if (/unsubmitted|(has been|is being) returned to (you|your)|sent back to you|returned (to you )?for (correction|changes|revision of (format|formatting))|before (it|we|your manuscript) can (be )?(proceed|consider|sent)|technical check|please (address|correct) the following/.test(x)) return "Returned by office";
  if (/withdrawn|withdrawal of (your|the) (manuscript|submission)/.test(x)) return "Withdrawn";
  if (/revised (manuscript|version|paper|submission)|revision (has been|was) (successfully )?(submitted|received)/.test(x) && /(successfully )?(submitted|received)|thank you for (submitting|your)/.test(x)) return "resubmitted";
  if (/(sent|send) (it |your manuscript |the manuscript )?(out )?(for|to) (external |peer )?review|under (peer )?review|reviewers? (have been|has been) (invited|assigned|contacted|selected)|out for review|assigned to (an |the )?(editor|associate editor)/.test(x)) return "under review";
  if (/successfully submitted|been (successfully )?(submitted|received)|received your (manuscript|submission|paper)|thank you for (submitting|your submission)|acknowledg\w+ (the )?receipt|submission (has been )?received|confirm(ing|s)? (the )?(receipt|submission)/.test(x)) return "submitted";
  return "";
}

/** Desk rejection vs rejection after review, and how many reviewer reports are in the email. */
function rdEmailReviews(text) {
  var t = String(text || ""), x = t.toLowerCase().replace(/\s+/g, " "), n = 0, m, re = /\b(?:reviewer|referee)\s*(?:#|no\.?|number)?\s*:?\s*(\d{1,2})\b/gi;
  while ((m = re.exec(t))) n = Math.max(n, +m[1]);
  if (!n && /(reviewer|referee)s?'?\s*(comments|reports?|reviews?)\b/i.test(t)) n = 1;
  var desk = /without (sending it |being sent )?(out )?(for )?(external |peer )?review|not (be )?sent (it )?(out )?for (external |peer )?review|decided not to send|not send (it|your (manuscript|paper)) (out )?(for|to) (external |peer )?review|editorial (screening|assessment|review|pre-?screening)|desk[- ]?reject|initial (screening|assessment|evaluation)|outside (the )?(aims and )?scope|not a (good )?fit for|does not fit (the|within)/.test(x);
  return { reviews: n, desk: desk && !n, reviewed: n > 0 || /reviewers? (have|has) (now )?(commented|reviewed|completed|returned)|comments from the reviewers|reviewers'? (comments|reports)/.test(x) };
}

function rdParseEmail(mail, subs) {
  var subject = mail.subject || "", from = mail.from || "", body = mail.body || "";
  var all = subject + "\n" + from + "\n" + body;
  var event = rdEmailEvent(subject + "\n" + body);
  var idm = (subject.match(RD_MSID) || body.match(RD_MSID) || [""])[0];
  var rv = rdEmailReviews(body);
  var head = rdEmailNorm(subject + " " + from + " " + body.slice(0, 1500));
  var best = null, bestScore = 0, second = 0, reasons = [];
  (subs || []).forEach(function (s) {
    var sc = 0, why = [];
    if (idm && s.msid && rdBaseId(s.msid) === rdBaseId(idm)) { sc += 100; why.push("manuscript ID"); }
    var j = rdEmailNorm(String(s.journal || "").replace(/-A$/, "").replace(/\(.*?\)/g, ""));
    var jHit = j.length > 4 && head.indexOf(j) >= 0;
    if (jHit) { sc += 30 + j.length / 20; why.push("journal"); }
    var ov = Math.max(rdEmailOverlap(s.title, all), rdEmailOverlap(s.titleUsed, all), rdEmailOverlap(s.paper, all));
    if (ov >= 0.3) { sc += 40 * ov; why.push("title " + Math.round(ov * 100) + "%"); }
    var open = s.status === "Under review" || s.status === "Revision requested" || s.status === "Returned by office";
    // the attempt from the email's time: submitted on/before the email, the closer the better
    if (mail.date && s.submitted) {
      var gap = (Date.parse(mail.date) - Date.parse(s.submitted)) / 864e5;
      sc += gap < -2 ? -15 : 6 - Math.min(gap, 600) / 120;
    }
    if (event === "submitted" && s.status === "Planned") sc += 8;
    else if (event === "resubmitted" && (s.status === "Revision requested" || s.status === "Returned by office")) sc += 10;
    else if (event && event !== "submitted" && open) sc += 8;
    if (sc > bestScore) { second = bestScore; bestScore = sc; best = s; reasons = why; } else if (sc > second) second = sc;
  });
  // Confident: manuscript ID, or journal + clear title, or journal alone when it's the only live candidate there.
  var confident = !!best && !!event && (bestScore >= 100 ||
    (reasons.indexOf("journal") >= 0 && reasons.some(function (r) { return /^title [5-9]\d|^title 100/.test(r); })) ||
    (reasons.indexOf("journal") >= 0 && bestScore - second >= 25 && bestScore >= 38));
  var status = { "submitted": "Under review", "resubmitted": "Under review", "under review": "Under review" }[event] || event;
  var dtype = "";
  if (event === "Rejected") dtype = rv.desk ? "Desk rejection" : rv.reviewed ? "Rejected after review" : "";
  return { event: event, status: status, dtype: dtype, reviews: rv.reviews, msid: idm, sub: bestScore >= 20 ? best : null,
           score: bestScore, confident: confident, reasons: reasons };
}

if (typeof module !== "undefined") module.exports = { rdParseEmail: rdParseEmail, rdEmailEvent: rdEmailEvent, rdEmailReviews: rdEmailReviews, RD_ORDER: RD_ORDER };
