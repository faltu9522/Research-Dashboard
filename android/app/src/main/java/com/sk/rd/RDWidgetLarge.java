package com.sk.rd;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** The larger home-screen widget: the numbers, this week's to-do list and the next deadline. Data comes from RDWidget.save. */
public class RDWidgetLarge extends AppWidgetProvider {
    private static final int[] LINES = {R.id.wl_1, R.id.wl_2, R.id.wl_3, R.id.wl_4};

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, views(ctx));
    }

    static void refresh(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, RDWidgetLarge.class));
        if (ids.length > 0) mgr.updateAppWidget(ids, views(ctx));
    }

    private static RemoteViews views(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_large);
        try {
            JSONObject d = new JSONObject(ctx.getSharedPreferences(RDWidget.PREFS, Context.MODE_PRIVATE).getString("data", "{}"));
            v.setTextViewText(R.id.wl_under, String.valueOf(d.optInt("under", 0)));
            v.setTextViewText(R.id.wl_wait, String.valueOf(d.optInt("waiting", 0)));
            v.setTextViewText(R.id.wl_days, d.optString("deadlineDays", "–"));
            v.setTextViewText(R.id.wl_streak, d.optString("streak", ""));
            JSONArray w = d.optJSONArray("week");
            for (int i = 0; i < LINES.length; i++) {
                String t = w != null && i < w.length() ? w.optString(i) : (i == 0 ? "Nothing urgent this week ✨" : "");
                v.setTextViewText(LINES[i], t);
            }
            v.setTextViewText(R.id.wl_deadline, d.optString("deadline", ""));
        } catch (Exception e) {
            v.setTextViewText(R.id.wl_1, "Open RD SK to load your papers");
        }
        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        v.setOnClickPendingIntent(R.id.wl_root, PendingIntent.getActivity(ctx, 42, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        return v;
    }
}
