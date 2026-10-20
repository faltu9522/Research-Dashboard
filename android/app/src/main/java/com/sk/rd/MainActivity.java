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
    private static final int PICK_FILE = 1;
    private WebView web;
    private ValueCallback<Uri[]> pendingChooser;

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

    /** A tapped reminder carries "open" = the tab to show. */
    private void openFromIntent(Intent intent) {
        String open = intent == null ? null : intent.getStringExtra("open");
        if (open == null) return;
        intent.removeExtra("open");
        web.evaluateJavascript("window.rdOpen && rdOpen(" + JSONObject.quote(open) + ")", null);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
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

        @JavascriptInterface
        public void openInBrowser(String url) {
            runOnUiThread(() -> MainActivity.this.openInBrowser(url));
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

        /** Calls the GitHub API off the UI thread and reports back via window.rdHttpDone(id, status, body). */
        @JavascriptInterface
        public void httpAsync(String id, String method, String url, String token, String body) {
            new Thread(() -> {
                int status = 0;
                String text;
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    c.setRequestMethod(method);
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(30000);
                    c.setUseCaches(false);
                    c.setRequestProperty("Authorization", "Bearer " + token);
                    c.setRequestProperty("Accept", "application/vnd.github+json");
                    c.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
                    if (body != null && !body.isEmpty()) {
                        c.setDoOutput(true);
                        c.setRequestProperty("Content-Type", "application/json");
                        try (OutputStream os = c.getOutputStream()) {
                            os.write(body.getBytes(StandardCharsets.UTF_8));
                        }
                    }
                    status = c.getResponseCode();
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
