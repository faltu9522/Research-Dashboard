package com.sk.rd;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** Home-screen widget: papers under review, waiting on you, and the longest wait. The app pushes the numbers on each save. */
public class RDWidget extends AppWidgetProvider {
    static final String PREFS = "rdsk-widget";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, views(ctx));
    }

    /** Saves the latest numbers from the app and redraws every RD SK widget. */
    static void save(Context ctx, String json) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("data", json).apply();
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, RDWidget.class));
        if (ids.length > 0) mgr.updateAppWidget(ids, views(ctx));
    }

    private static RemoteViews views(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget);
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONObject d = new JSONObject(p.getString("data", "{}"));
            v.setTextViewText(R.id.w_under, String.valueOf(d.optInt("under", 0)));
            v.setTextViewText(R.id.w_wait, String.valueOf(d.optInt("waiting", 0)));
            String longest = d.optString("longest", "");
            v.setTextViewText(R.id.w_longest, longest.isEmpty() ? "Open RD SK to load your papers" : longest);
            String flag = d.optString("flag", "");
            v.setTextViewText(R.id.w_flag, flag);
            v.setTextViewText(R.id.w_streak, d.optString("streak", ""));
        } catch (Exception e) {
            v.setTextViewText(R.id.w_longest, "Open RD SK to load your papers");
        }
        Intent open = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        v.setOnClickPendingIntent(R.id.w_root, PendingIntent.getActivity(ctx, 41, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        return v;
    }
}
