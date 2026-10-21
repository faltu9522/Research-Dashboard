package com.sk.rd;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;

/**
 * In-app browser that walks through the journals' submission sites. The user signs in themselves (their phone's
 * password manager can fill it in); after every page load we look for a manuscript status table and keep it.
 * Logins are remembered in this browser's cookies; passwords are never seen or stored by the app.
 */
public class BrowserActivity extends Activity {
    private WebView web;
    private TextView title, info;
    private Button next;
    private JSONArray targets;
    private final JSONObject results = new JSONObject();
    private int index = 0;
    private String extractJs = "", navJs = "";
    private JSONArray clicked = new JSONArray();
    private boolean advancing = false;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            targets = new JSONArray(getIntent().getStringExtra("targets"));
            extractJs = asset("extract.js");
            navJs = asset("nav.js");
        } catch (Exception e) {
            targets = new JSONArray();
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.VERTICAL);
        bar.setBackgroundColor(0xFF2F5D8A);
        int pad = dp(12);
        bar.setPadding(pad, dp(10), pad, dp(8));
        title = text(16, Color.WHITE, true);
        info = text(13, 0xFFDDE7F2, false);
        LinearLayout buttons = new LinearLayout(this);
        buttons.setGravity(Gravity.END);
        buttons.setPadding(0, dp(6), 0, 0);
        Button read = button("Read this page");
        Button open = button("Open in browser");
        next = button("Next →");
        read.setOnClickListener(v -> extract(true));
        open.setOnClickListener(v -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(web.getUrl() != null ? web.getUrl() : currentUrl()))));
        next.setOnClickListener(v -> advance());
        buttons.addView(open);
        buttons.addView(read);
        buttons.addView(next);
        bar.addView(title);
        bar.addView(info);
        bar.addView(buttons);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setUserAgentString(s.getUserAgentString().replace("; wv", ""));
        // Let the phone's autofill service (e.g. Google Password Manager) offer saved logins on journal sites.
        if (android.os.Build.VERSION.SDK_INT >= 26) web.setImportantForAutofill(android.view.View.IMPORTANT_FOR_AUTOFILL_YES);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new Reporter(), "RDB");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                extract(false);
                handler.postDelayed(() -> extract(false), 2500);
            }
        });

        root.addView(bar, new LinearLayout.LayoutParams(-1, -2));
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1f));
        setContentView(root);
        show();
    }

    private String asset(String name) throws java.io.IOException {
        try (InputStream in = getAssets().open(name)) {
            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
            byte[] b = new byte[8192];
            for (int n; (n = in.read(b)) > 0; ) buf.write(b, 0, n);
            return buf.toString("UTF-8");
        }
    }

    private void show() {
        if (index >= targets.length()) {
            finishWithResults();
            return;
        }
        JSONObject t = targets.optJSONObject(index);
        title.setText((index + 1) + " of " + targets.length() + " · " + t.optString("journal"));
        info.setText("Sign in if asked: tap the user ID box and pick your saved login from Google Password Manager. "
                + "The app then opens your submitted manuscripts and reads the status. Papers: " + t.optString("papers"));
        clicked = new JSONArray();
        advancing = false;
        next.setText(index == targets.length() - 1 ? "Finish ✓" : "Next →");
        web.loadUrl(currentUrl());
    }

    private String currentUrl() {
        JSONObject t = targets.optJSONObject(Math.min(index, targets.length() - 1));
        return t == null ? "about:blank" : t.optString("url");
    }

    private void advance() {
        handler.removeCallbacksAndMessages(null);
        CookieManager.getInstance().flush();
        index++;
        show();
    }

    private void extract(boolean manual) {
        if (index >= targets.length()) return;
        web.evaluateJavascript("(function(){try{" + extractJs + "}catch(e){}})(); void 0;", null);
        if (manual) info.setText("Reading this page…");
    }

    private void finishWithResults() {
        CookieManager.getInstance().flush();
        setResult(RESULT_OK, new Intent().putExtra("results", results.toString()));
        finish();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else finishWithResults();
    }

    /** Receives what extract.js found on the current page, and what nav.js clicked. */
    private class Reporter {
        @JavascriptInterface
        public void action(String what) {
            runOnUiThread(() -> {
                if (what.startsWith("nav:")) {
                    clicked.put(what.substring(4));
                    info.setText("Opening your submitted manuscripts…");
                }
            });
        }

        @JavascriptInterface
        public void report(String json) {
            runOnUiThread(() -> {
                try {
                    JSONObject r = new JSONObject(json);
                    JSONArray rows = r.optJSONArray("rows");
                    JSONObject t = targets.optJSONObject(index);
                    if (t == null) return;
                    if (rows != null && rows.length() > 0) {
                        results.put(t.optString("key"), r);
                        int want = Math.max(1, t.optInt("count", 1));
                        String found = "✓ Found " + rows.length() + " manuscript" + (rows.length() == 1 ? "" : "s") + " with a status";
                        if (rows.length() >= want && !advancing) {
                            advancing = true;
                            info.setText(found + ". Moving on…");
                            handler.postDelayed(BrowserActivity.this::advance, 2000);
                        } else if (!advancing) {
                            info.setText(found + " (expected " + want + "). Open the other list if there is one, or tap "
                                    + (index == targets.length() - 1 ? "Finish" : "Next") + ".");
                        }
                        return;
                    }
                    if (!r.optBoolean("login") && !results.has(t.optString("key"))) {
                        web.evaluateJavascript("(function(){window.__rdp={clicked:" + clicked + "};try{" + navJs + "}catch(e){}})(); void 0;", null);
                    }
                    if (r.optBoolean("login")) {
                        info.setText("Sign in: tap the user ID box and choose your saved login (Google Password Manager). The app takes it from there.");
                    } else if (!results.has(t.optString("key"))) {
                        info.setText("No status table on this page yet. Open your Author Centre → submitted manuscripts, or tap Read this page.");
                    }
                } catch (Exception ignored) {
                }
            });
        }
    }

    private TextView text(int sp, int color, boolean bold) {
        TextView v = new TextView(this);
        v.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        v.setTextColor(color);
        if (bold) v.setTypeface(Typeface.DEFAULT_BOLD);
        return v;
    }

    private Button button(String label) {
        Button b = new Button(this, null, android.R.attr.borderlessButtonStyle);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        b.setMinWidth(0);
        b.setMinimumWidth(0);
        b.setPadding(dp(8), 0, dp(8), 0);
        return b;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
