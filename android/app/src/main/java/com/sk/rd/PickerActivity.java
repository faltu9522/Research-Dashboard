package com.sk.rd;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Shows Google's file picker (hosted on the RD SK website) so a co-author can open a sheet that was shared with them.
 * Picking a file there is what gives RD SK access to it under the "only files RD SK uses" permission.
 * The page asks for the access token through a JavaScript bridge that answers only on the RD SK website,
 * and reports the chosen file by navigating to rdsk://picked?id=…&name=… (or rdsk://picked?cancel=1).
 */
public class PickerActivity extends Activity {
    private WebView web;
    private String token, allowedHost;
    private volatile String pageHost = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        token = getIntent().getStringExtra("token");
        String url = getIntent().getStringExtra("url");
        allowedHost = Uri.parse(url).getHost();
        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setUserAgentString(s.getUserAgentString().replace("; wv", ""));
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new Bridge(), "RDSKPick");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String u, android.graphics.Bitmap icon) {
                pageHost = String.valueOf(Uri.parse(u).getHost());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!"rdsk".equals(u.getScheme())) return false;
                Intent data = new Intent();
                if (u.getQueryParameter("id") != null) {
                    data.putExtra("id", u.getQueryParameter("id")).putExtra("name", u.getQueryParameter("name"));
                    setResult(RESULT_OK, data);
                } else {
                    setResult(RESULT_CANCELED, data.putExtra("error", u.getQueryParameter("error")));
                }
                finish();
                return true;
            }
        });
        setContentView(web);
        web.loadUrl(url);
    }

    private class Bridge {
        /** The Google access token, only for the RD SK website (never in a URL or the page's history). */
        @JavascriptInterface
        public String token() {
            return allowedHost != null && allowedHost.equals(pageHost) ? token : "";
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else { setResult(RESULT_CANCELED); super.onBackPressed(); }
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
