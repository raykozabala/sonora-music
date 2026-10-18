package com.sonoramusic.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.util.Base64;
import android.util.Log;
import android.widget.RemoteViews;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

/**
 * Widget de la pantalla de inicio: muestra la canción que está sonando con su
 * carátula y tres controles (anterior, play/pausa y siguiente).
 *
 * Los botones reutilizan el mismo canal que la notificación (PlaybackService),
 * de modo que si la app está viva el control es inmediato. La carátula se
 * descarga en un hilo aparte y el bitmap se reduce antes de enviarlo al
 * widget (RemoteViews tiene un límite de tamaño en la transacción).
 */
public class SonoraWidgetProvider extends AppWidgetProvider {

    public static final String TAG = "SonoraWidget";
    private static final String CMD_PREFIX = "com.sonoramusic.app.CMD_";
    private static final int ART_MAX = 180;

    private static Bitmap sArt = null;
    private static String sArtFrom = "";
    private static volatile boolean sLoadingArt = false;

    // El APK se compila sin clase R, así que resolvemos los ids por nombre.
    private static final Map<String, Integer> IDS = new HashMap<String, Integer>();

    private static int rid(Context ctx, String name, String type) {
        String key = type + "/" + name;
        Integer cached = IDS.get(key);
        if (cached != null) return cached;
        int res = ctx.getResources().getIdentifier(name, type, ctx.getPackageName());
        IDS.put(key, res);
        return res;
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
        try {
            for (int id : ids) mgr.updateAppWidget(id, buildViews(context));
        } catch (Exception e) {
            Log.e(TAG, "onUpdate: " + e.getMessage());
        }
        refresh(context);
    }

    @Override
    public void onEnabled(Context context) {
        refresh(context);
    }

    /** Repinta el widget con el estado actual del reproductor. */
    public static void refresh(Context ctx) {
        if (ctx == null) return;
        final Context app = ctx.getApplicationContext();
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(app);
            ComponentName cn = new ComponentName(app, SonoraWidgetProvider.class);
            int[] ids = mgr.getAppWidgetIds(cn);
            if (ids == null || ids.length == 0) return;

            RemoteViews views = buildViews(app);
            for (int i : ids) mgr.updateAppWidget(i, views);

            final String url = PlaybackService.sArtwork;
            if (url != null && !url.isEmpty() && !url.equals(sArtFrom) && !sLoadingArt) {
                sLoadingArt = true;
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        Bitmap bmp = decodeArtwork(url);
                        sLoadingArt = false;
                        if (bmp == null) return;
                        sArt = bmp;
                        sArtFrom = url;
                        try {
                            AppWidgetManager m2 = AppWidgetManager.getInstance(app);
                            ComponentName c2 = new ComponentName(app, SonoraWidgetProvider.class);
                            int[] ids2 = m2.getAppWidgetIds(c2);
                            RemoteViews v2 = buildViews(app);
                            for (int i : ids2) m2.updateAppWidget(i, v2);
                        } catch (Exception ignored) {}
                    }
                }).start();
            }
        } catch (Exception e) {
            Log.e(TAG, "refresh: " + e.getMessage());
        }
    }

    private static Bitmap decodeArtwork(String url) {
        try {
            Bitmap bmp = null;
            if (url.startsWith("data:image")) {
                int comma = url.indexOf(',');
                if (comma <= 0) return null;
                byte[] raw = Base64.decode(url.substring(comma + 1), Base64.DEFAULT);
                bmp = BitmapFactory.decodeByteArray(raw, 0, raw.length);
            } else {
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(8000);
                conn.setInstanceFollowRedirects(true);
                InputStream in = conn.getInputStream();
                bmp = BitmapFactory.decodeStream(in);
                try { in.close(); } catch (Exception ignored) {}
                conn.disconnect();
            }
            return bmp == null ? null : scaleDown(bmp, ART_MAX);
        } catch (Exception e) {
            Log.e(TAG, "artwork: " + e.getMessage());
            return null;
        }
    }

    private static Bitmap scaleDown(Bitmap bmp, int max) {
        try {
            int w = bmp.getWidth();
            int h = bmp.getHeight();
            if (w <= max && h <= max) return bmp;
            float s = Math.min((float) max / w, (float) max / h);
            return Bitmap.createScaledBitmap(bmp, Math.max(1, Math.round(w * s)),
                    Math.max(1, Math.round(h * s)), true);
        } catch (Exception e) {
            return bmp;
        }
    }

    private static PendingIntent servicePI(Context ctx, String cmd, int reqCode) {
        Intent i = new Intent(ctx, PlaybackService.class);
        i.setAction(CMD_PREFIX + cmd);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getService(ctx, reqCode, i, flags);
    }

    private static RemoteViews buildViews(Context ctx) {
        int layout = rid(ctx, "sonora_widget", "layout");
        RemoteViews v = new RemoteViews(ctx.getPackageName(), layout);

        String title = PlaybackService.sTitle;
        String artist = PlaybackService.sArtist;
        boolean hasTrack = title != null && !title.isEmpty();

        v.setTextViewText(rid(ctx, "widget_title", "id"), hasTrack ? title : "Sonora Music");
        v.setTextViewText(rid(ctx, "widget_artist", "id"),
                hasTrack ? (artist == null || artist.isEmpty() ? "Sonora Music" : artist)
                         : "Toca para abrir la app");

        // Sólo sustituimos la carátula si tenemos una reducida (si no, el
        // propio layout ya muestra el icono de la app).
        if (sArt != null) {
            v.setImageViewBitmap(rid(ctx, "widget_art", "id"), sArt);
        }

        v.setImageViewResource(rid(ctx, "widget_toggle", "id"),
                PlaybackService.sPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play);

        v.setOnClickPendingIntent(rid(ctx, "widget_toggle", "id"), servicePI(ctx, "toggle", 21));
        v.setOnClickPendingIntent(rid(ctx, "widget_next", "id"), servicePI(ctx, "next", 22));
        v.setOnClickPendingIntent(rid(ctx, "widget_prev", "id"), servicePI(ctx, "prev", 23));

        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) piFlags |= PendingIntent.FLAG_IMMUTABLE;
        v.setOnClickPendingIntent(rid(ctx, "widget_root", "id"),
                PendingIntent.getActivity(ctx, 24, open, piFlags));

        return v;
    }
}
