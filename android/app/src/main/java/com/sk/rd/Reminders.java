package com.sk.rd;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;

/**
 * Daily check (about 9 am) for submissions that passed the chase limit, plus a weekly nudge when nothing
 * has been updated. The web page pushes a small summary of its data here via setData() on every save.
 */
public class Reminders extends BroadcastReceiver {
    static final String ACTION_CHECK = "com.sk.rd.CHECK_REMINDERS";
    private static final String PREFS = "reminders";
    private static final String CHANNEL = "chase";
    private static final int ID_CHASE = 1, ID_NUDGE = 2, ID_TEST = 3, ID_WEEK = 4, ID_CITE = 5, ID_ALERT = 100;

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        if (ACTION_CHECK.equals(a)) { check(ctx); citations(ctx, goAsync()); }
        else schedule(ctx); // boot completed / app updated
    }

    static void setData(Context ctx, String json) {
        prefs(ctx).edit().putString("data", json).apply();
        schedule(ctx);
    }

    static void schedule(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 0,
                new Intent(ctx, Reminders.class).setAction(ACTION_CHECK),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.cancel(pi);
        if (!data(ctx).optBoolean("enabled", true)) return;
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, 9);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        if (c.getTimeInMillis() <= System.currentTimeMillis()) c.add(Calendar.DAY_OF_MONTH, 1);
        am.setInexactRepeating(AlarmManager.RTC_WAKEUP, c.getTimeInMillis(), AlarmManager.INTERVAL_DAY, pi);
    }

    static void check(Context ctx) {
        JSONObject d = data(ctx);
        if (!d.optBoolean("enabled", true)) return;
        SharedPreferences p = prefs(ctx);
        long today = todayNum();
        int chase = Math.max(1, d.optInt("chaseDays", 90));

        // Chase reminders: once when a submission reaches the limit, and once more at twice the limit.
        Set<String> notified = new HashSet<>(p.getStringSet("notified", new HashSet<>()));
        Set<String> stillOpen = new HashSet<>();
        List<String> lines = new ArrayList<>();
        String firstTitle = null, firstText = null;
        JSONArray subs = d.optJSONArray("subs");
        for (int i = 0; subs != null && i < subs.length(); i++) {
            JSONObject s = subs.optJSONObject(i);
            long sub = dayNum(s.optString("submitted"));
            if (sub < 0) continue;
            long days = today - sub;
            String id = s.optString("id");
            stillOpen.add(id + ":1");
            stillOpen.add(id + ":2");
            int level = days >= 2L * chase ? 2 : days >= chase ? 1 : 0;
            if (level == 0 || notified.contains(id + ":" + level)) continue;
            notified.add(id + ":1");
            if (level == 2) notified.add(id + ":2");
            String journal = s.optString("journal"), paper = s.optString("paper");
            lines.add(journal + " · " + days + " days" + (level == 2 ? " (overdue)" : ""));
            if (firstTitle == null) {
                firstTitle = (level == 2 ? "Overdue: chase " : "Time to chase ") + journal;
                firstText = "“" + paper + "” has been under review for " + days + " days. Tap to email the editor.";
            }
        }
        notified.retainAll(stillOpen);
        p.edit().putStringSet("notified", notified).apply();
        if (lines.size() == 1) {
            post(ctx, ID_CHASE, firstTitle, firstText, null, "review");
        } else if (lines.size() > 1) {
            post(ctx, ID_CHASE, lines.size() + " submissions need a status check",
                    "Tap to see them and email the editors.", lines, "review");
        }

        // Deadlines worked out by the app: calls for papers, reviews due, revision due dates. Each fires once, on its day.
        Set<String> alerted = new HashSet<>(p.getStringSet("alerted", new HashSet<>()));
        Set<String> keys = new HashSet<>();
        JSONArray al = d.optJSONArray("alerts");
        int shown = 0;
        for (int i = 0; al != null && i < al.length(); i++) {
            JSONObject a = al.optJSONObject(i);
            if (a == null) continue;
            String key = a.optString("key");
            keys.add(key);
            long day = dayNum(a.optString("day"));
            if (day < 0 || day > today || today - day > 2 || alerted.contains(key)) continue;
            alerted.add(key);
            post(ctx, ID_ALERT + (shown++ % 20), a.optString("title"), a.optString("text"), null, a.optString("open", "home"));
        }
        alerted.retainAll(keys);
        p.edit().putStringSet("alerted", alerted).apply();

        // Monday morning: this week's plan.
        JSONObject wk = d.optJSONObject("weekly");
        if (wk != null && Calendar.getInstance().get(Calendar.DAY_OF_WEEK) == Calendar.MONDAY && p.getLong("lastWeekly", -1) != today) {
            List<String> wl = new ArrayList<>();
            JSONArray ls = wk.optJSONArray("lines");
            for (int i = 0; ls != null && i < ls.length(); i++) wl.add(ls.optString(i));
            post(ctx, ID_WEEK, wk.optString("title", "This week"), wl.isEmpty() ? "Tap to see this week's plan." : wl.get(0), wl.isEmpty() ? null : wl, "home");
            p.edit().putLong("lastWeekly", today).apply();
        }

        // Weekly nudge if nothing has been recorded for 7+ days.
        long last = dayNum(d.optString("lastUpdated"));
        long lastNudge = p.getLong("lastNudge", -1);
        if (last >= 0 && today - last >= 7 && (lastNudge < 0 || today - lastNudge >= 7)) {
            post(ctx, ID_NUDGE, "Any news on your submissions?",
                    "Nothing recorded for " + (today - last) + " days. Tap to log new submissions or decisions.", null, "home");
            p.edit().putLong("lastNudge", today).apply();
        }
    }

    /**
     * Once a week: asks Crossref for the citation count of each published paper the app listed (DOIs only, no
     * personal data) and posts one notification when any went up. Runs off the main thread.
     */
    static void citations(Context ctx, PendingResult done) {
        JSONObject d = data(ctx);
        JSONArray list = d.optJSONArray("cites");
        SharedPreferences p = prefs(ctx);
        long today = todayNum();
        if (list == null || list.length() == 0 || !d.optBoolean("enabled", true) || today - p.getLong("lastCite", -99) < 7) { done.finish(); return; }
        new Thread(() -> {
            try {
                JSONObject known = new JSONObject(p.getString("citeCounts", "{}"));
                List<String> lines = new ArrayList<>();
                int ok = 0;
                for (int i = 0; i < list.length() && i < 80; i++) {
                    JSONObject c = list.optJSONObject(i);
                    if (c == null) continue;
                    String doi = c.optString("doi");
                    int before = known.has(doi) ? known.optInt(doi) : c.optInt("count", -1);
                    int now = crossrefCount(doi);
                    if (now < 0) continue;
                    ok++;
                    if (before >= 0 && now > before) {
                        String t = c.optString("title");
                        lines.add("“" + (t.length() > 48 ? t.substring(0, 46) + "…" : t) + "” +" + (now - before) + " (now " + now + ")");
                    }
                    known.put(doi, now);
                }
                p.edit().putString("citeCounts", known.toString()).putLong("lastCite", ok > 0 ? today : p.getLong("lastCite", -99)).apply();
                if (lines.size() == 1) post(ctx, ID_CITE, "📈 New citation" + (lines.get(0).contains("+1 ") ? "" : "s"), lines.get(0), null, "home");
                else if (lines.size() > 1) post(ctx, ID_CITE, "📈 New citations for " + lines.size() + " papers", "Tap to see them in RD SK.", lines, "home");
            } catch (Exception ignored) {
            } finally {
                done.finish();
            }
        }).start();
    }

    private static int crossrefCount(String doi) {
        java.net.HttpURLConnection c = null;
        try {
            c = (java.net.HttpURLConnection) new java.net.URL("https://api.crossref.org/works/" + java.net.URLEncoder.encode(doi, "UTF-8").replace("%2F", "/")).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(15000);
            c.setRequestProperty("User-Agent", "RD-SK/5.2 (https://github.com/faltu9522/Research-Dashboard)");
            if (c.getResponseCode() != 200) return -1;
            java.io.InputStream in = c.getInputStream();
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            return new JSONObject(out.toString("UTF-8")).getJSONObject("message").optInt("is-referenced-by-count", -1);
        } catch (Exception e) {
            return -1;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    static void test(Context ctx) {
        post(ctx, ID_TEST, "RD SK reminders are on",
                "You'll get a note at about 9 am when a submission passes the chase limit.", null, "review");
    }

    private static void post(Context ctx, int id, String title, String text, List<String> lines, String open) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Submission reminders", NotificationManager.IMPORTANCE_DEFAULT));
        }
        Intent i = new Intent(ctx, MainActivity.class).putExtra("open", open)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(ctx, CHANNEL) : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_stat_rd).setContentTitle(title).setContentText(text)
                .setColor(0xFF2F5D8A).setAutoCancel(true).setContentIntent(pi);
        if (lines != null) {
            Notification.InboxStyle st = new Notification.InboxStyle();
            for (String l : lines) st.addLine(l);
            b.setStyle(st);
        } else {
            b.setStyle(new Notification.BigTextStyle().bigText(text));
        }
        try {
            nm.notify(id, b.build());
        } catch (SecurityException ignored) {
            // notification permission not granted
        }
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static JSONObject data(Context ctx) {
        try {
            return new JSONObject(prefs(ctx).getString("data", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static long todayNum() {
        Calendar c = Calendar.getInstance();
        return dayNum(String.format(Locale.US, "%04d-%02d-%02d",
                c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH)));
    }

    /** "yyyy-MM-dd" -> days since epoch, or -1. */
    private static long dayNum(String s) {
        if (s == null || s.length() < 10) return -1;
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            return f.parse(s.substring(0, 10)).getTime() / 86400000L;
        } catch (Exception e) {
            return -1;
        }
    }
}
