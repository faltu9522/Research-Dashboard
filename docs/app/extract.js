// Injected into journal submission sites (ScholarOne, Editorial Manager, ...) by the in-app browser.
// Finds tables that have a "Status" column and reports their rows to RDB.report(json). Reads the page only.
var clean = function (s) { return (s || "").replace(/\s+/g, " ").trim(); };
var text = function (el) { return clean(el.innerText || el.textContent); };
var docs = [document];
(function collect(d) {
  var fr = d.querySelectorAll("iframe,frame");
  for (var i = 0; i < fr.length; i++) {
    try { var cd = fr[i].contentDocument; if (cd && docs.indexOf(cd) < 0) { docs.push(cd); collect(cd); } } catch (e) {}
  }
})(document);
var rows = [], seen = {}, login = false;
var MSID = /\b[A-Z][A-Z0-9]{1,14}-(?:[A-Z]-)?\d{2,4}-\d{2,6}(?:\.R\d+)?\b/;
docs.forEach(function (d) {
  if (d.querySelector("input[type=password]")) login = true;
  var tables = d.querySelectorAll("table");
  for (var t = 0; t < tables.length; t++) {
    var trs = Array.prototype.slice.call(tables[t].rows);
    var hi = -1, cols = null;
    for (var i = 0; i < trs.length && i < 6; i++) {
      var hs = Array.prototype.map.call(trs[i].cells, function (c) { return text(c).toLowerCase(); });
      var si = -1;
      hs.forEach(function (h, k) { if (h.length < 40 && /status/.test(h) && (si < 0 || /current/.test(h))) si = k; });
      if (si >= 0) {
        hi = i;
        var find = function (re) { for (var k = 0; k < hs.length; k++) if (hs[k].length < 40 && re.test(hs[k])) return k; return -1; };
        cols = { status: si, title: find(/title/), id: find(/manuscript|number|^id$|\bid\b/), date: find(/submit/) };
        break;
      }
    }
    if (hi < 0) continue;
    for (var r = hi + 1; r < trs.length; r++) {
      var cells = trs[r].cells;
      if (!cells || cells.length <= cols.status) continue;
      var st = text(cells[cols.status]);
      var all = text(trs[r]);
      if (!st || st.length > 400 || seen[all]) continue;
      seen[all] = 1;
      var idm = (cols.id >= 0 && cells[cols.id] ? text(cells[cols.id]) : "").match(MSID) || all.match(MSID);
      rows.push({
        status: st.slice(0, 300),
        title: cols.title >= 0 && cells[cols.title] ? text(cells[cols.title]).slice(0, 300) : "",
        msid: idm ? idm[0] : "",
        date: cols.date >= 0 && cells[cols.date] ? text(cells[cols.date]).slice(0, 40) : "",
        row: all.slice(0, 600)
      });
    }
  }
});
if (window.RDB) RDB.report(JSON.stringify({ url: location.href, page: document.title, login: login, rows: rows }));
