package com.sonoramusic.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Controles de reproducción en la barra de notificaciones (play/pausa,
 * anterior, siguiente, retroceder y adelantar 10 s) + pantalla de bloqueo.
 *
 * El audio sigue sonando en el reproductor del WebView; este servicio sólo
 * publica la sesión multimedia y reenvía los botones a la web.
 */
public class PlaybackService extends Service {

    public static final String TAG = "SonoraPlayback";
    private static final String CHANNEL_ID = "sonora_playback";
    private static final int NOTIF_ID = 4821;
    private static final String CMD_PREFIX = "com.sonoramusic.app.CMD_";

    // Estado que MainActivity escribe desde JavaScript.
    public static volatile String sTitle = "";
    public static volatile String sArtist = "";
    public static volatile String sAlbum = "";
    public static volatile String sArtwork = "";
    public static volatile boolean sPlaying = false;
    public static volatile boolean sHasPrev = false;
    public static volatile boolean sHasNext = false;
    public static volatile long sPosition = 0;
    public static volatile long sDuration = 0;

    private MediaSession session;
    private Bitmap artworkBitmap;
    private String artworkLoadedFrom = "";
    private boolean loadingArtwork = false;

    // ---------------------------------------------------------------------
    // API estática para MainActivity
    // ---------------------------------------------------------------------

    public static void push(Context ctx) {
        if (ctx == null) return;
        try {
            Intent i = new Intent(ctx, PlaybackService.class);
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (Exception e) {
            Log.e(TAG, "push: " + e.getMessage());
        }
    }

    public static void shutdown(Context ctx) {
        if (ctx == null) return;
        sPlaying = false;
        try {
            ctx.stopService(new Intent(ctx, PlaybackService.class));
        } catch (Exception e) {
            Log.e(TAG, "shutdown: " + e.getMessage());
        }
    }

    // ---------------------------------------------------------------------
    // Ciclo de vida
    // ---------------------------------------------------------------------

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        try {
            session = new MediaSession(this, "SonoraMusic");
            session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS
                    | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
            session.setCallback(new MediaSession.Callback() {
                @Override public void onPlay() { forward("play"); }
                @Override public void onPause() { forward("pause"); }
                @Override public void onStop() { forward("pause"); }
                @Override public void onSkipToNext() { forward("next"); }
                @Override public void onSkipToPrevious() { forward("prev"); }
                @Override public void onFastForward() { forward("forward"); }
                @Override public void onRewind() { forward("rewind"); }
            });
            session.setActive(true);
        } catch (Exception e) {
            Log.e(TAG, "onCreate(session): " + e.getMessage());
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = (intent != null) ? intent.getAction() : null;

        // Pulsación de un botón de la notificación: se reenvía a la web.
        if (action != null && action.startsWith(CMD_PREFIX)) {
            forward(action.substring(CMD_PREFIX.length()).toLowerCase());
            return START_STICKY;
        }

        updateSession();
        loadArtworkIfNeeded();
        try {
            Notification notification = buildNotification();
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIF_ID, notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIF_ID, notification);
            }
        } catch (Exception e) {
            Log.e(TAG, "startForeground: " + e.getMessage());
            // Si no se pudo pasar a primer plano (permiso denegado, etc.)
            // paramos el servicio para no provocar un ANR.
            stopSelf();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        try {
            if (session != null) {
                session.setActive(false);
                session.release();
                session = null;
            }
        } catch (Exception e) {
            Log.e(TAG, "onDestroy: " + e.getMessage());
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ---------------------------------------------------------------------
    // Interno
    // ---------------------------------------------------------------------

    private void forward(String cmd) {
        Log.i(TAG, "comando -> web: " + cmd);
        MainActivity.sendCommandToWeb(cmd);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        try {
            NotificationManager nm =
                    (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "Reproducción", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Controles del reproductor de Sonora Music");
            ch.setShowBadge(false);
            ch.setSound(null, null);
            nm.createNotificationChannel(ch);
        } catch (Exception e) {
            Log.e(TAG, "createChannel: " + e.getMessage());
        }
    }

    private void updateSession() {
        if (session == null) return;
        try {
            MediaMetadata.Builder md = new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, sTitle)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, sArtist)
                    .putString(MediaMetadata.METADATA_KEY_ALBUM, sAlbum)
                    .putLong(MediaMetadata.METADATA_KEY_DURATION, sDuration);
            if (artworkBitmap != null) {
                md.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artworkBitmap);
            }
            session.setMetadata(md.build());

            long actions = PlaybackState.ACTION_PLAY
                    | PlaybackState.ACTION_PAUSE
                    | PlaybackState.ACTION_PLAY_PAUSE
                    | PlaybackState.ACTION_SKIP_TO_NEXT
                    | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                    | PlaybackState.ACTION_FAST_FORWARD
                    | PlaybackState.ACTION_REWIND
                    | PlaybackState.ACTION_SEEK_TO;
            PlaybackState.Builder pb = new PlaybackState.Builder()
                    .setActions(actions)
                    .setState(sPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                            sPosition, sPlaying ? 1.0f : 0.0f);
            session.setPlaybackState(pb.build());
        } catch (Exception e) {
            Log.e(TAG, "updateSession: " + e.getMessage());
        }
    }

    /** La carátula se descarga en segundo plano (nunca en el hilo de UI). */
    private void loadArtworkIfNeeded() {
        final String url = sArtwork;
        if (url == null || url.isEmpty()) return;
        if (url.equals(artworkLoadedFrom) || loadingArtwork) return;
        loadingArtwork = true;
        new Thread(new Runnable() {
            @Override
            public void run() {
                InputStream in = null;
                HttpURLConnection conn = null;
                try {
                    URL u = new URL(url);
                    conn = (HttpURLConnection) u.openConnection();
                    conn.setConnectTimeout(6000);
                    conn.setReadTimeout(8000);
                    conn.setInstanceFollowRedirects(true);
                    in = conn.getInputStream();
                    final Bitmap bmp = BitmapFactory.decodeStream(in);
                    if (bmp != null) {
                        artworkBitmap = bmp;
                        artworkLoadedFrom = url;
                        // Refresca la notificación ya con la carátula.
                        push(getApplicationContext());
                    }
                } catch (Exception e) {
                    Log.e(TAG, "artwork: " + e.getMessage());
                } finally {
                    try { if (in != null) in.close(); } catch (Exception ignored) {}
                    if (conn != null) conn.disconnect();
                    loadingArtwork = false;
                }
            }
        }).start();
    }

    private PendingIntent servicePI(String cmd, int reqCode) {
        Intent i = new Intent(this, PlaybackService.class);
        i.setAction(CMD_PREFIX + cmd);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getService(this, reqCode, i, flags);
    }

    private int systemIcon(String name) {
        try {
            return getResources().getIdentifier(name, "drawable", "android");
        } catch (Exception e) {
            return android.R.drawable.ic_media_play;
        }
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) piFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent contentPI = PendingIntent.getActivity(this, 0, open, piFlags);

        Notification.Builder b = (Build.VERSION.SDK_INT >= 26)
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);

        b.setContentTitle(sTitle.isEmpty() ? "Sonora Music" : sTitle)
         .setContentText(sArtist.isEmpty() ? "Sonora Music" : sArtist)
         .setSmallIcon(systemIcon("ic_media_play"))
         .setContentIntent(contentPI)
         .setShowWhen(false)
         .setOnlyAlertOnce(true)
         .setVisibility(Notification.VISIBILITY_PUBLIC);

        if (artworkBitmap != null) b.setLargeIcon(artworkBitmap);

        b.addAction(new Notification.Action.Builder(
                systemIcon("ic_media_previous"), "Anterior", servicePI("prev", 1)).build());
        b.addAction(new Notification.Action.Builder(
                systemIcon("ic_media_rew"), "-10s", servicePI("rewind", 2)).build());

        if (sPlaying) {
            b.addAction(new Notification.Action.Builder(
                    systemIcon("ic_media_pause"), "Pausar", servicePI("toggle", 3)).build());
        } else {
            b.addAction(new Notification.Action.Builder(
                    systemIcon("ic_media_play"), "Reproducir", servicePI("toggle", 3)).build());
        }

        b.addAction(new Notification.Action.Builder(
                systemIcon("ic_media_ff"), "+10s", servicePI("forward", 4)).build());
        b.addAction(new Notification.Action.Builder(
                systemIcon("ic_media_next"), "Siguiente", servicePI("next", 5)).build());

        try {
            Notification.MediaStyle style = new Notification.MediaStyle()
                    .setShowActionsInCompactView(0, 2, 4);
            if (session != null) style.setMediaSession(session.getSessionToken());
            b.setStyle(style);
        } catch (Exception e) {
            Log.e(TAG, "MediaStyle: " + e.getMessage());
        }

        return b.build();
    }
}
