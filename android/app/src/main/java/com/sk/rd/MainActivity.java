package com.sk.rd;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Hosts the offline dashboard (assets/index.html) in a WebView; data is kept in the WebView's localStorage. */
public class MainActivity extends Activity {
    private static final int PICK_FILE = 1, CHECK_STATUS = 5, PICK_ACCOUNT = 7, GOOGLE_AUTH = 8;
    private static final String SCOPE_DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";
    private String pendingGoogle = null;
    private WebView web;
    private ValueCallback<Uri[]> pendingChooser;
    private android.webkit.PermissionRequest pendingCamera;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);

        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                openFromIntent(getIntent());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("file".equals(u.getScheme())) return false;
                openExternal(u.toString());
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            /** Camera for the in-app QR scanner. */
            @Override
            public void onPermissionRequest(android.webkit.PermissionRequest request) {
                runOnUiThread(() -> {
                    if (checkSelfPermission(android.Manifest.permission.CAMERA) == 0) {
                        request.grant(new String[]{android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                    } else {
                        pendingCamera = request;
                        requestPermissions(new String[]{android.Manifest.permission.CAMERA}, 4);
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (pendingChooser != null) pendingChooser.onReceiveValue(null);
                pendingChooser = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "Choose .xlsx or .json"), PICK_FILE);
                } catch (ActivityNotFoundException e) {
                    pendingChooser = null;
                    return false;
                }
                return true;
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        openFromIntent(intent);
    }

    /** A tapped reminder carries "open" = the tab to show; text shared from another app (e.g. an editor's email) is parsed by the page. */
    private void openFromIntent(Intent intent) {
        if (intent == null) return;
        String open = intent.getStringExtra("open");
        if (open != null) {
            intent.removeExtra("open");
            web.evaluateJavascript("window.rdOpen && rdOpen(" + JSONObject.quote(open) + ")", null);
        }
        if (Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null && "rdsk".equals(intent.getData().getScheme())) {
            String link = intent.getDataString();
            intent.setAction(null);
            web.evaluateJavascript("window.rdSharedText && rdSharedText(" + JSONObject.quote(link) + ")", null);
        }
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            intent.setAction(null);
            String all = (subject != null ? subject + "\n" : "") + (text != null ? text : "");
            if (!all.trim().isEmpty()) {
                web.evaluateJavascript("window.rdSharedText && rdSharedText(" + JSONObject.quote(all) + ")", null);
            }
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    // ---------- Google sign-in: access only to the files RD SK creates (drive.file) ----------
    private android.content.SharedPreferences prefs() { return getSharedPreferences("rdsk-google", MODE_PRIVATE); }

    private void googleDone(String id, boolean ok, String tokenOrError) {
        String email = prefs().getString("account", "");
        String js = "window.rdGoogleDone && rdGoogleDone(" + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(tokenOrError == null ? "" : tokenOrError)
                + "," + JSONObject.quote(email) + ")";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    /** Lets you pick one of the Google accounts on the phone, then asks for access. */
    private void googleChooseAccount(String id) {
        pendingGoogle = id;
        String current = prefs().getString("account", "");
        android.accounts.Account sel = current.isEmpty() ? null : new android.accounts.Account(current, "com.google");
        Intent pick = android.accounts.AccountManager.newChooseAccountIntent(sel, null, new String[]{"com.google"}, null, null, null, null);
        try {
            startActivityForResult(pick, PICK_ACCOUNT);
        } catch (ActivityNotFoundException e) {
            googleDone(id, false, "No account chooser on this phone");
        }
    }

    /** An access token for the chosen account; with interactive=false it never shows a screen. */
    private void googleToken(String id, boolean interactive) {
        String email = prefs().getString("account", "");
        if (email.isEmpty()) { googleDone(id, false, "not-signed-in"); return; }
        com.google.android.gms.auth.api.identity.AuthorizationRequest req = new com.google.android.gms.auth.api.identity.AuthorizationRequest.Builder()
                .setRequestedScopes(java.util.Collections.singletonList(new com.google.android.gms.common.api.Scope(SCOPE_DRIVE_FILE)))
                .setAccount(new android.accounts.Account(email, "com.google"))
                .build();
        com.google.android.gms.auth.api.identity.Identity.getAuthorizationClient(this).authorize(req)
                .addOnSuccessListener(res -> {
                    if (res.hasResolution()) {
                        if (!interactive) { googleDone(id, false, "consent-needed"); return; }
                        try {
                            pendingGoogle = id;
                            startIntentSenderForResult(res.getPendingIntent().getIntentSender(), GOOGLE_AUTH, null, 0, 0, 0);
                        } catch (Exception e) {
                            googleDone(id, false, "Couldn't open Google sign-in: " + e.getMessage());
                        }
                    } else {
                        googleDone(id, true, res.getAccessToken());
                    }
                })
                .addOnFailureListener(e -> googleDone(id, false, googleError(e)));
    }

    /** Google's reason in words, with its status code, so a setup problem is never silent. */
    private static String googleError(Exception e) {
        int code = e instanceof com.google.android.gms.common.api.ApiException
                ? ((com.google.android.gms.common.api.ApiException) e).getStatusCode() : -1;
        String m = String.valueOf(e.getMessage());
        if (code == 16 || code == 12501) return "cancelled";
        if (code == 10 || m.contains("DEVELOPER_ERROR"))
            return "setup|Google doesn't recognise this app yet (error 10). In Google Cloud → Clients, the Android client needs package name com.sk.rd "
                    + "and SHA-1 A5:16:32:A3:02:C3:E4:C1:BC:F6:EF:FA:07:12:CB:F9:BB:C9:43:C3, in the same project where the consent screen is set up.";
        if (code == 7) return "No internet connection (error 7). Try again.";
        if (code == 17 || code == 8)
            return "setup|Google Play services couldn't finish sign-in (error " + code + "). Update Google Play services (Play Store), then try again.";
        return "setup|Google sign-in failed (error " + code + "): " + m;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == PICK_ACCOUNT) {
            String id = pendingGoogle; pendingGoogle = null;
            String name = (resultCode == RESULT_OK && data != null) ? data.getStringExtra(android.accounts.AccountManager.KEY_ACCOUNT_NAME) : null;
            if (name == null) { googleDone(id, false, "cancelled"); return; }
            prefs().edit().putString("account", name).apply();
            googleToken(id, true);
            return;
        }
        if (requestCode == GOOGLE_AUTH) {
            String id = pendingGoogle; pendingGoogle = null;
            if (data == null) {
                // the permission screen closed without any answer: almost always an incomplete Google Cloud setup
                googleDone(id, false, resultCode == RESULT_OK ? "setup|Google sent no answer." : "closed");
                return;
            }
            try {
                com.google.android.gms.auth.api.identity.AuthorizationResult r =
                        com.google.android.gms.auth.api.identity.Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data);
                googleDone(id, r.getAccessToken() != null, r.getAccessToken() != null ? r.getAccessToken() : "closed");
            } catch (Exception e) {
                googleDone(id, false, googleError(e));
            }
            return;
        }
        if (requestCode == CHECK_STATUS) {
            String res = data != null ? data.getStringExtra("results") : null;
            if (res != null) web.evaluateJavascript("window.rdStatusResults && rdStatusResults(" + JSONObject.quote(res) + ")", null);
            return;
        }
        if (requestCode == PICK_FILE && pendingChooser != null) {
            Uri[] result = (resultCode == RESULT_OK && data != null && data.getData() != null)
                    ? new Uri[]{data.getData()} : null;
            pendingChooser.onReceiveValue(result);
            pendingChooser = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == 4 && pendingCamera != null) {
            if (results.length > 0 && results[0] == 0) pendingCamera.grant(new String[]{android.webkit.PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else pendingCamera.deny();
            pendingCamera = null;
        }
        web.evaluateJavascript("window.rdPermissionsChanged && rdPermissionsChanged()", null);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.rdBack ? rdBack() : false", handled -> {
            if (!"true".equals(handled)) MainActivity.super.onBackPressed();
        });
    }

    private void openExternal(String url) {
        try {
            Uri u = Uri.parse(url);
            startActivity(new Intent("mailto".equals(u.getScheme()) ? Intent.ACTION_SENDTO : Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No browser found", Toast.LENGTH_SHORT).show();
        }
    }

    /** Opens a URL in the user's web browser itself, skipping apps (like GitHub's) that claim the link. */
    private static final String GEMINI_APP = "com.google.android.apps.bard";

    /**
     * Hands a question to the Gemini app: shared straight in when the app accepts shared text, else the app is
     * opened (the question is already on the clipboard), else gemini.google.com (the app opens it if it handles the link).
     */
    private String openGemini(String text) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, text);
        send.setPackage(GEMINI_APP);
        try {
            startActivity(send);
            return "sent";
        } catch (ActivityNotFoundException | SecurityException e) {
            // not a share target on this version: open the app instead
        }
        Intent launch = getPackageManager().getLaunchIntentForPackage(GEMINI_APP);
        if (launch != null) {
            try {
                startActivity(launch);
                return "app";
            } catch (ActivityNotFoundException | SecurityException e) {
                // fall through to the link
            }
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://gemini.google.com/app")));
        } catch (ActivityNotFoundException e) {
            openExternal("https://gemini.google.com/app");
        }
        return "link";
    }

    private void openInBrowser(String url) {
        Intent probe = new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com/"));
        android.content.pm.ResolveInfo ri = getPackageManager().resolveActivity(probe, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY);
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        if (ri != null && ri.activityInfo != null && !"android".equals(ri.activityInfo.packageName)) {
            i.setPackage(ri.activityInfo.packageName);
        }
        try {
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            openExternal(url);
        }
    }

    private class Bridge {
        /** Opens each journal's author page in the in-app browser; results come back via rdStatusResults(). */
        @JavascriptInterface
        public void checkStatuses(String targetsJson) {
            runOnUiThread(() -> startActivityForResult(
                    new Intent(MainActivity.this, BrowserActivity.class).putExtra("targets", targetsJson), CHECK_STATUS));
        }

        @JavascriptInterface
        public void setReminderData(String json) {
            Reminders.setData(MainActivity.this, json);
        }

        @JavascriptInterface
        public boolean notificationsAllowed() {
            if (Build.VERSION.SDK_INT >= 33
                    && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != 0) return false;
            return ((android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE)).areNotificationsEnabled();
        }

        @JavascriptInterface
        public void requestNotifications() {
            if (Build.VERSION.SDK_INT >= 33) {
                runOnUiThread(() -> requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 3));
            }
        }

        @JavascriptInterface
        public void testReminder() {
            Reminders.test(MainActivity.this);
        }

        /** Version and device details for the About section. */
        @JavascriptInterface
        public String appInfo() {
            JSONObject o = new JSONObject();
            try {
                android.content.pm.PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                o.put("versionName", pi.versionName);
                o.put("versionCode", Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode);
                o.put("installed", pi.firstInstallTime);
                o.put("updated", pi.lastUpdateTime);
                o.put("android", Build.VERSION.RELEASE);
                o.put("device", Build.MANUFACTURER + " " + Build.MODEL);
                if (Build.VERSION.SDK_INT >= 26 && WebView.getCurrentWebViewPackage() != null) {
                    o.put("webview", WebView.getCurrentWebViewPackage().versionName);
                }
            } catch (Exception ignored) {
            }
            return o.toString();
        }

        @JavascriptInterface
        public void openInBrowser(String url) {
            runOnUiThread(() -> MainActivity.this.openInBrowser(url));
        }

        @JavascriptInterface
        public void googleChooseAccount(String id) { runOnUiThread(() -> MainActivity.this.googleChooseAccount(id)); }

        @JavascriptInterface
        public void googleToken(String id, boolean interactive) { runOnUiThread(() -> MainActivity.this.googleToken(id, interactive)); }

        @JavascriptInterface
        public String googleAccount() { return prefs().getString("account", ""); }

        @JavascriptInterface
        public void googleSignOut() { prefs().edit().remove("account").apply(); }

        /** Uploads an xlsx from the app's assets to Drive as a new Google Sheet (converted), answering via rdHttpDone. */
        @JavascriptInterface
        public void driveCreateFromAsset(String id, String token, String asset, String metadataJson) {
            new Thread(() -> {
                int status = 0;
                String text;
                try {
                    InputStream in = getAssets().open(asset);
                    ByteArrayOutputStream file = new ByteArrayOutputStream();
                    byte[] b = new byte[16384];
                    for (int n; (n = in.read(b)) > 0; ) file.write(b, 0, n);
                    in.close();
                    String bnd = "rdsk" + System.currentTimeMillis();
                    ByteArrayOutputStream body = new ByteArrayOutputStream();
                    body.write(("--" + bnd + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + metadataJson + "\r\n--" + bnd
                            + "\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                    file.writeTo(body);
                    body.write(("\r\n--" + bnd + "--").getBytes(StandardCharsets.UTF_8));
                    HttpURLConnection c = (HttpURLConnection) new URL("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink").openConnection();
                    c.setRequestMethod("POST");
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(120000);
                    c.setDoOutput(true);
                    c.setRequestProperty("Authorization", "Bearer " + token);
                    c.setRequestProperty("Content-Type", "multipart/related; boundary=" + bnd);
                    try (OutputStream os = c.getOutputStream()) { body.writeTo(os); }
                    status = c.getResponseCode();
                    InputStream rin = status >= 400 ? c.getErrorStream() : c.getInputStream();
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    if (rin != null) { for (int n; (n = rin.read(b)) > 0; ) buf.write(b, 0, n); rin.close(); }
                    text = buf.toString("UTF-8");
                } catch (Exception e) {
                    text = "{\"error\":{\"message\":" + JSONObject.quote("Network error: " + e.getMessage()) + "}}";
                }
                String js = "window.rdHttpDone(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(text) + ")";
                runOnUiThread(() -> web.evaluateJavascript(js, null));
            }).start();
        }

        @JavascriptInterface
        public String openGemini(String text) {
            return MainActivity.this.openGemini(text);
        }

        @JavascriptInterface
        public void copyText(String text) {
            runOnUiThread(() -> {
                android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(android.content.ClipData.newPlainText("RD SK", text));
            });
        }

        @JavascriptInterface
        public String getClipboard() {
            android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            if (cm == null || !cm.hasPrimaryClip() || cm.getPrimaryClip().getItemCount() == 0) return "";
            CharSequence s = cm.getPrimaryClip().getItemAt(0).coerceToText(MainActivity.this);
            return s == null ? "" : s.toString();
        }

        @JavascriptInterface
        public void openUrl(String url) {
            runOnUiThread(() -> openExternal(url));
        }

        @JavascriptInterface
        public void shareText(String subject, String text) {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_SUBJECT, subject);
            i.putExtra(Intent.EXTRA_TEXT, text);
            runOnUiThread(() -> startActivity(Intent.createChooser(i, subject)));
        }

        /**
         * Calls the GitHub API or the Google Sheets script off the UI thread and reports back via
         * window.rdHttpDone(id, status, body). Redirects are followed by hand: Apps Script answers a POST with a
         * redirect to the result, which must be fetched with GET.
         */
        @JavascriptInterface
        public void httpAsync(String id, String method, String url, String token, String body) {
            new Thread(() -> {
                int status = 0;
                String text;
                try {
                    HttpURLConnection c = null;
                    String target = url, verb = method;
                    for (int hop = 0; hop < 6; hop++) {
                        c = (HttpURLConnection) new URL(target).openConnection();
                        c.setInstanceFollowRedirects(false);
                        c.setRequestMethod(verb);
                        c.setConnectTimeout(20000);
                        c.setReadTimeout(120000);
                        c.setUseCaches(false);
                        if (token != null && !token.isEmpty()) {
                            c.setRequestProperty("Authorization", "Bearer " + token);
                            if (target.startsWith("https://api.github.com/")) {
                                c.setRequestProperty("Accept", "application/vnd.github+json");
                                c.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
                            }
                        }
                        if (hop == 0 && body != null && !body.isEmpty()) {
                            c.setDoOutput(true);
                            c.setRequestProperty("Content-Type", "application/json");
                            try (OutputStream os = c.getOutputStream()) {
                                os.write(body.getBytes(StandardCharsets.UTF_8));
                            }
                        }
                        status = c.getResponseCode();
                        String next = c.getHeaderField("Location");
                        if (status < 300 || status >= 400 || next == null) break;
                        target = new URL(new URL(target), next).toString();
                        if (status != 307 && status != 308) verb = "GET";
                        c.disconnect();
                    }
                    InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    if (in != null) {
                        byte[] b = new byte[16384];
                        for (int n; (n = in.read(b)) > 0; ) buf.write(b, 0, n);
                        in.close();
                    }
                    text = buf.toString("UTF-8");
                } catch (Exception e) {
                    status = 0;
                    text = "{\"message\":" + JSONObject.quote("Network error: " + e.getMessage()) + "}";
                }
                String js = "window.rdHttpDone(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(text) + ")";
                runOnUiThread(() -> web.evaluateJavascript(js, null));
            }).start();
        }

        /** Saves a file to the public Downloads folder and returns a message for the UI. */
        @JavascriptInterface
        public String saveFile(String name, String content, String mime, boolean isBase64) {
            byte[] bytes = isBase64 ? Base64.decode(content, Base64.DEFAULT) : content.getBytes(StandardCharsets.UTF_8);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    v.put(MediaStore.Downloads.MIME_TYPE, mime);
                    v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) return "Could not save " + name;
                    try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                        os.write(bytes);
                    }
                    return "Saved to Downloads: " + name;
                }
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists() || checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != 0) {
                    dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != 0) {
                        runOnUiThread(() -> requestPermissions(new String[]{android.Manifest.permission.WRITE_EXTERNAL_STORAGE}, 2));
                    }
                }
                File f = new File(dir, name);
                try (FileOutputStream os = new FileOutputStream(f)) {
                    os.write(bytes);
                }
                return "Saved: " + f.getAbsolutePath();
            } catch (Exception e) {
                return "Could not save: " + e.getMessage();
            }
        }
    }
}
