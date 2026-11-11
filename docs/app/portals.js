// Built-in journal login / submission-system links, keyed by normalised journal name
// (lower case, "&" -> "and", text in brackets and a trailing "-A" dropped, punctuation -> spaces).
// Every ScholarOne / Editorial Manager link here was checked to open that journal's login page (Oct 2026).
// Journals not listed fall back to a web search. A link set in the app ("Login link for this journal") always wins over these.
window.RD_PORTALS = {
  // ---- currently under review ----
  "ijem": "https://mc.manuscriptcentral.com/ijem",
  "international journal of educational management": "https://mc.manuscriptcentral.com/ijem",
  "comparative and continental philosophy": "https://rp.tandfonline.com/",  // Taylor & Francis submission portal (author login)
  "organization": "https://mc.manuscriptcentral.com/organization",
  "organization the critical journal of organization theory and society": "https://mc.manuscriptcentral.com/organization",
  "time and society": "https://mc.manuscriptcentral.com/tasj",
  "discourse and communication": "https://mc.manuscriptcentral.com/dcm",
  "journal of management studies": "https://mc.manuscriptcentral.com/jmstudies",
  "organization theory": "https://mc.manuscriptcentral.com/ot",
  "global knowledge memory and communication": "https://mc.manuscriptcentral.com/gkmc",
  "applied linguistics": "https://mc.manuscriptcentral.com/appling",
  "journal of business ethics": "https://www.editorialmanager.com/busi/default.aspx",
  "security dialogue": "https://mc.manuscriptcentral.com/security-dialogue",
  "communication research": "https://mc.manuscriptcentral.com/commresearch",
  "human relations": "https://mc.manuscriptcentral.com/hr",
  "international journal of information management": "https://www.editorialmanager.com/ijim/default.aspx",

  // ---- other journals in the queue / history ----
  "discourse and society": "https://mc.manuscriptcentral.com/das",
  "discourse studies": "https://mc.manuscriptcentral.com/discourse",
  "organization studies": "https://mc.manuscriptcentral.com/orgstudies",
  "theory culture and society": "https://mc.manuscriptcentral.com/tcs",
  "media culture and society": "https://mc.manuscriptcentral.com/mcs",
  "european journal of communication": "https://mc.manuscriptcentral.com/ejc",
  "memory studies": "https://mc.manuscriptcentral.com/mss",
  "qualitative inquiry": "https://mc.manuscriptcentral.com/qi",
  "journal of communication": "https://mc.manuscriptcentral.com/jcom",
  "technological forecasting and social change": "https://www.editorialmanager.com/tfs/default.aspx",
  "social science and medicine": "https://www.editorialmanager.com/ssm/default.aspx",
  "language and communication": "https://www.editorialmanager.com/lac/default.aspx",
  "the leadership quarterly": "https://www.editorialmanager.com/leaqua/default.aspx",
  "continental philosophy review": "https://www.editorialmanager.com/meta/default.aspx",
  "scientometrics": "https://www.editorialmanager.com/scim/default.aspx",
};
