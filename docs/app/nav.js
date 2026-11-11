// Injected by the in-app browser when no status table is on the page yet (window.__rdp = {clicked}).
// Clicks through to the list of submitted manuscripts, each link label at most once per journal.
// It never reads or fills login fields: signing in is left to the user and their password manager.
var P = window.__rdp || {}, clicked = P.clicked || [];
var visible = function (el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
var label = function (el) { return (el.innerText || el.value || el.getAttribute("aria-label") || el.title || "").replace(/\s+/g, " ").trim(); };
var docs = [document];
(function collect(d) {
  var fr = d.querySelectorAll("iframe,frame");
  for (var i = 0; i < fr.length; i++) { try { var cd = fr[i].contentDocument; if (cd) { docs.push(cd); collect(cd); } } catch (e) {} }
})(document);
var onLoginPage = docs.some(function (d) { return Array.prototype.some.call(d.querySelectorAll("input[type=password]"), visible); });
if (onLoginPage) {
  RDB.action("loginpage");
} else {
  // ScholarOne: "Author" → "Submitted Manuscripts"; Editorial Manager: "Submissions Being Processed".
  var steps = [/^author( (center|centre|dashboard))?$/i, /^submitted manuscripts?$/i, /^submissions being processed$/i,
               /^manuscripts? (under|in) review$/i, /^my submissions$/i, /^revisions? being processed$/i];
  var done = false;
  for (var s = 0; s < steps.length && !done; s++) {
    if (clicked.indexOf(String(steps[s])) >= 0) continue;
    docs.some(function (d) {
      var el = Array.prototype.filter.call(d.querySelectorAll("a, button, [role=tab], [role=menuitem]"), function (a) {
        return visible(a) && steps[s].test(label(a).replace(/\s*\(\d+\)\s*$/, ""));
      })[0];
      if (el) { RDB.action("nav:" + String(steps[s])); el.click(); done = true; }
      return done;
    });
  }
  if (!done) RDB.action("idle");
}
