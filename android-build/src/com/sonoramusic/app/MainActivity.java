package com.sonoramusic.app;

import android.app.Activity;
import android.Manifest;
import android.os.Bundle;
import android.os.Build;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.app.DownloadManager;
import android.content.ContentUris;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Environment;
import android.content.Context;
import android.content.Intent;
import android.widget.Toast;
import android.util.Log;
import android.database.Cursor;
import android.provider.MediaStore;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import android.content.ContentValues;
import android.util.Base64;

public class MainActivity extends Activity {
    private static final String TAG = "SonoraMusic";
    private static final int FILE_CHOOSER_REQ = 1001;
    private static final int AUDIO_PERM_REQ = 1002;
    private static final int NOTIF_PERM_REQ = 1003;

    private WebView webView;
    private ValueCallback<Uri[]> uploadMessage;

    // Instancia viva: el servicio de reproducción la usa para mandar órdenes
    // (play/pausa/siguiente...) al reproductor que vive en el WebView.
    private static volatile MainActivity sInstance = null;

    public static void sendCommandToWeb(final String cmd) {
        MainActivity a = sInstance;
        if (a == null || a.webView == null) return;
        final WebView wv = a.webView;
        wv.post(new Runnable() {
            @Override
            public void run() {
                try {
                    wv.evaluateJavascript(
                        "window.SonoraNativeMedia && window.SonoraNativeMedia.onAction('" + cmd + "');",
                        null);
                } catch (Exception e) {
                    Log.e(TAG, "sendCommandToWeb: " + e.getMessage());
                }
            }
        });
    }

    private String[] audioPermissions() {
        if (Build.VERSION.SDK_INT >= 33) {
            return new String[]{ Manifest.permission.READ_MEDIA_AUDIO };
        }
        return new String[]{ Manifest.permission.READ_EXTERNAL_STORAGE };
    }

    public boolean hasAudioPermission() {
        for (String p : audioPermissions()) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) return false;
        }
        return true;
    }

    public void requestAudioPermission() {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                requestPermissions(audioPermissions(), AUDIO_PERM_REQ);
            }
        });
    }

    public static class SonoraNativeInterface {
        private final MainActivity activity;

        public SonoraNativeInterface(MainActivity activity) {
            this.activity = activity;
        }

        @android.webkit.JavascriptInterface
        public boolean isLarkPlayerInstalled() {
            String[] packages = {"com.cplayer.music", "com.dywx.larkplayer"};
            for (String pkg : packages) {
                try {
                    activity.getPackageManager().getPackageInfo(pkg, 0);
                    return true;
                } catch (Exception ignored) {}
            }
            return false;
        }

        @android.webkit.JavascriptInterface
        public boolean openInLarkPlayer(String title, String artist) {
            return openInLarkPlayerWithFile(title, artist, null);
        }

        @android.webkit.JavascriptInterface
        public boolean openInLarkPlayerWithFile(String title, String artist, String filePath) {
            String[] packages = {"com.cplayer.music", "com.dywx.larkplayer"};

            // 1. If an actual downloaded file path is passed and exists, open it directly
            if (filePath != null && !filePath.isEmpty()) {
                try {
                    String cleanPath = filePath.replace("file://", "");
                    File f = new File(cleanPath);
                    if (f.exists()) {
                        Uri contentUri = Uri.fromFile(f);
                        for (String pkg : packages) {
                            try {
                                Intent intent = new Intent(Intent.ACTION_VIEW);
                                intent.setDataAndType(contentUri, "audio/*");
                                intent.setPackage(pkg);
                                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                activity.startActivity(intent);
                                return true;
                            } catch (Exception ignored) {}
                        }

                        // Open with any music player chooser
                        Intent generic = new Intent(Intent.ACTION_VIEW);
                        generic.setDataAndType(contentUri, "audio/*");
                        generic.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        activity.startActivity(Intent.createChooser(generic, "Abrir canción en..."));
                        return true;
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Failed to open specific audio file: " + e.getMessage());
                }
            }

            // 2. Launch Lark Player app directly if installed
            for (String pkg : packages) {
                try {
                    Intent intent = activity.getPackageManager().getLaunchIntentForPackage(pkg);
                    if (intent != null) {
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        activity.startActivity(intent);
                        return true;
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Lark launch failed for " + pkg + ": " + e.getMessage());
                }
            }

            // 3. Fallback: Search for downloaded MP3 in Download directory
            try {
                File dlDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (dlDir != null && dlDir.exists()) {
                    File[] files = dlDir.listFiles();
                    if (files != null) {
                        for (File f : files) {
                            String name = f.getName().toLowerCase();
                            if ((name.endsWith(".mp3") || name.endsWith(".m4a")) &&
                                (title != null && !title.isEmpty() && name.contains(title.toLowerCase().substring(0, Math.min(title.length(), 10))))) {
                                Intent playIntent = new Intent(Intent.ACTION_VIEW);
                                playIntent.setDataAndType(Uri.fromFile(f), "audio/*");
                                playIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                activity.startActivity(Intent.createChooser(playIntent, "Reproducir con..."));
                                return true;
                            }
                        }
                    }
                }
            } catch (Exception ignored) {}

            // 4. Fallback: Open Play Store to install Lark Player
            try {
                Intent market = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.cplayer.music"));
                market.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(market);
                return true;
            } catch (Exception e) {
                try {
                    Intent webMarket = new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.cplayer.music"));
                    webMarket.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(webMarket);
                    return true;
                } catch (Exception ex) {
                    Log.e(TAG, "Market intent failed: " + ex.getMessage());
                }
            }

            return false;
        }

        @android.webkit.JavascriptInterface
        public boolean downloadFile(String url, String filename, String mimetype) {
            try {
                Uri uri = Uri.parse(url);
                DownloadManager.Request request = new DownloadManager.Request(uri);
                if (mimetype != null && !mimetype.isEmpty()) {
                    request.setMimeType(mimetype);
                } else if (filename != null && filename.endsWith(".mp3")) {
                    request.setMimeType("audio/mpeg");
                } else if (filename != null && filename.endsWith(".mp4")) {
                    request.setMimeType("video/mp4");
                }

                String cleanName = (filename != null && !filename.isEmpty()) ? filename : "sonora_track.mp3";
                request.setDescription("Descargando desde Sonora Music");
                request.setTitle(cleanName);
                request.allowScanningByMediaScanner();
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, cleanName);

                DownloadManager dm = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
                if (dm != null) {
                    dm.enqueue(request);
                    activity.runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            Toast.makeText(activity, "📥 Descargando al teléfono: " + cleanName, Toast.LENGTH_SHORT).show();
                        }
                    });
                    return true;
                }
            } catch (Exception e) {
                Log.e(TAG, "Native download failed: " + e.getMessage());
            }
            return false;
        }

        // ------------------------------------------------------------------
        // Guardar en la carpeta Descargas del teléfono el audio que la app ya
        // descargó. Se hace por trozos (base64) porque el audio puede pesar
        // varios MB y el puente JS no admite binarios directos.
        // ------------------------------------------------------------------
        private SaveSession saveSession = null;

        private static class SaveSession {
            final Uri uri;
            final OutputStream stream;
            final String name;
            final boolean modern;
            long bytes = 0;
            SaveSession(Uri uri, OutputStream stream, String name, boolean modern) {
                this.uri = uri; this.stream = stream; this.name = name; this.modern = modern;
            }
            void close() throws Exception {
                try { stream.flush(); } catch (Exception ignored) {}
                stream.close();
            }
        }

        private static String sanitizeFileName(String name) {
            if (name == null) return "";
            String s = name.replaceAll("[\\\\/:*?\"<>|\\r\\n\\t]", "_").trim();
            if (s.length() > 120) {
                int dot = s.lastIndexOf('.');
                s = (dot > 0) ? (s.substring(0, 110) + s.substring(dot)) : s.substring(0, 120);
            }
            return s;
        }

        @android.webkit.JavascriptInterface
        public String startSaveToDownloads(String filename, String mimetype) {
            try {
                if (saveSession != null) {
                    try { saveSession.close(); } catch (Exception ignored) {}
                    saveSession = null;
                }
                String clean = sanitizeFileName(filename);
                if (clean.isEmpty()) clean = "sonora_" + System.currentTimeMillis() + ".mp3";
                String mime = (mimetype != null && !mimetype.isEmpty()) ? mimetype : "audio/mpeg";

                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Audio.Media.DISPLAY_NAME, clean);
                    values.put(MediaStore.Audio.Media.MIME_TYPE, mime);
                    values.put(MediaStore.Audio.Media.RELATIVE_PATH,
                            Environment.DIRECTORY_DOWNLOADS + "/Sonora Music");
                    values.put(MediaStore.Audio.Media.IS_MUSIC, 1);
                    values.put(MediaStore.Audio.Media.IS_PENDING, 1);
                    Uri uri = activity.getContentResolver()
                            .insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) { Log.e(TAG, "startSave: MediaStore devolvió null"); return ""; }
                    OutputStream os = activity.getContentResolver().openOutputStream(uri);
                    if (os == null) { Log.e(TAG, "startSave: sin stream"); return ""; }
                    saveSession = new SaveSession(uri, os, clean, true);
                    Log.i(TAG, "startSave: " + clean);
                    return "ok:" + clean;
                }

                // Android 9 o anterior: carpeta pública + escaneo
                File dir = new File(Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_DOWNLOADS), "Sonora Music");
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, clean);
                OutputStream os = new FileOutputStream(f);
                saveSession = new SaveSession(Uri.fromFile(f), os, clean, false);
                Log.i(TAG, "startSave(legacy): " + f.getAbsolutePath());
                return "ok:" + clean;
            } catch (Exception e) {
                Log.e(TAG, "startSaveToDownloads: " + e.getMessage());
                saveSession = null;
                return "";
            }
        }

        @android.webkit.JavascriptInterface
        public boolean appendSaveChunk(String base64) {
            if (saveSession == null || base64 == null || base64.isEmpty()) return false;
            try {
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                saveSession.stream.write(data);
                saveSession.bytes += data.length;
                return true;
            } catch (Exception e) {
                Log.e(TAG, "appendSaveChunk: " + e.getMessage());
                return false;
            }
        }

        @android.webkit.JavascriptInterface
        public String finishSaveToDownloads() {
            if (saveSession == null) return "";
            String name = saveSession.name;
            long bytes = saveSession.bytes;
            boolean modern = saveSession.modern;
            Uri uri = saveSession.uri;
            try {
                saveSession.close();
                if (modern && Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Audio.Media.IS_PENDING, 0);
                    activity.getContentResolver().update(uri, v, null, null);
                }
                saveSession = null;
                Log.i(TAG, "finishSave: " + name + " (" + bytes + " bytes)");
                final String msg = "💾 Guardado en Descargas/Sonora Music: " + name;
                activity.runOnUiThread(new Runnable() {
                    @Override public void run() {
                        Toast.makeText(activity, msg, Toast.LENGTH_LONG).show();
                    }
                });
                return "ok";
            } catch (Exception e) {
                Log.e(TAG, "finishSaveToDownloads: " + e.getMessage());
                saveSession = null;
                return "";
            }
        }

        @android.webkit.JavascriptInterface
        public void abortSaveToDownloads() {
            if (saveSession == null) return;
            try {
                saveSession.close();
                if (saveSession.modern && Build.VERSION.SDK_INT >= 29) {
                    activity.getContentResolver().delete(saveSession.uri, null, null);
                }
            } catch (Exception e) {
                Log.e(TAG, "abortSave: " + e.getMessage());
            }
            saveSession = null;
        }

        // ------------------------------------------------------------------
        // Controles de reproducción en la barra de notificaciones
        // ------------------------------------------------------------------
        @android.webkit.JavascriptInterface
        public String updatePlaybackInfo(String json) {
            try {
                JSONObject o = new JSONObject(json == null ? "{}" : json);
                PlaybackService.sTitle = o.optString("title", "");
                PlaybackService.sArtist = o.optString("artist", "");
                PlaybackService.sAlbum = o.optString("album", "");
                PlaybackService.sArtwork = o.optString("artwork", "");
                PlaybackService.sPlaying = o.optBoolean("playing", false);
                PlaybackService.sHasPrev = o.optBoolean("hasPrev", true);
                PlaybackService.sHasNext = o.optBoolean("hasNext", true);
                PlaybackService.sPosition = (long) (o.optDouble("position", 0) * 1000);
                PlaybackService.sDuration = (long) (o.optDouble("duration", 0) * 1000);

                if (PlaybackService.sTitle.isEmpty()) {
                    PlaybackService.shutdown(activity);
                    return "stopped";
                }
                PlaybackService.push(activity);
                return "ok";
            } catch (Exception e) {
                Log.e(TAG, "updatePlaybackInfo: " + e.getMessage());
                return "error";
            }
        }

        @android.webkit.JavascriptInterface
        public boolean hasStoragePermission() {
            return activity.hasAudioPermission();
        }

        @android.webkit.JavascriptInterface
        public void requestStoragePermission() {
            activity.requestAudioPermission();
        }

        @android.webkit.JavascriptInterface
        public String getDeviceMusicFiles() {
            JSONArray arr = new JSONArray();

            // Sin permiso no se puede leer la música del teléfono (Android 6+)
            if (!activity.hasAudioPermission()) {
                return "{\"__needsPermission\":true}";
            }

            Cursor cursor = null;
            try {
                String[] projection = {
                    MediaStore.Audio.Media._ID,
                    MediaStore.Audio.Media.TITLE,
                    MediaStore.Audio.Media.ARTIST,
                    MediaStore.Audio.Media.ALBUM,
                    MediaStore.Audio.Media.DURATION,
                    MediaStore.Audio.Media.DATA,
                    MediaStore.Audio.Media.ALBUM_ID
                };
                // IS_MUSIC deja fuera lo que está en Descargas, así que también
                // aceptamos cualquier MIME de audio (y descartamos tonos cortos).
                String selection = "(" + MediaStore.Audio.Media.IS_MUSIC + " != 0 OR "
                    + MediaStore.Audio.Media.MIME_TYPE + " LIKE 'audio/%')"
                    + " AND (" + MediaStore.Audio.Media.DURATION + " IS NULL OR "
                    + MediaStore.Audio.Media.DURATION + " > 20000)";
                cursor = activity.getContentResolver().query(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                    projection,
                    selection,
                    null,
                    MediaStore.Audio.Media.TITLE + " ASC"
                );

                if (cursor != null) {
                    while (cursor.moveToNext()) {
                        JSONObject obj = new JSONObject();
                        long id = cursor.getLong(0);
                        String title = cursor.getString(1);
                        String artist = cursor.getString(2);
                        String album = cursor.getString(3);
                        long durMs = cursor.getLong(4);
                        String path = cursor.getString(5);
                        long albumId = cursor.getLong(6);

                        // URI de contenido: reproducible por el WebView en Android 10+
                        Uri contentUri = ContentUris.withAppendedId(
                            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);

                        obj.put("id", "device_" + id);
                        obj.put("title", title != null ? title : "Canción local");
                        obj.put("artist", (artist != null && !artist.equals("<unknown>")) ? artist : "Artista desconocido");
                        obj.put("album", album != null ? album : "Dispositivo");
                        obj.put("duration", durMs > 0 ? (durMs / 1000) : 180);
                        obj.put("filePath", contentUri.toString());
                        obj.put("rawPath", path != null ? path : "");
                        obj.put("albumId", albumId);
                        obj.put("isDownloaded", 1);
                        obj.put("isDeviceTrack", 1);
                        arr.put(obj);
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Error listing device music: " + e.getMessage());
            } finally {
                if (cursor != null) {
                    try { cursor.close(); } catch (Exception ignored) {}
                }
            }
            return arr.toString();
        }
    }

    public static class SonoraWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            if (url != null && (url.startsWith("file://") || url.startsWith("http://") || url.startsWith("https://"))) {
                view.loadUrl(url);
                return true;
            }
            return false;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError error) {
            Log.w(TAG, "WebView error");
        }
    }

    public class SonoraChromeClient extends WebChromeClient {
        @Override
        public boolean onConsoleMessage(ConsoleMessage cm) {
            Log.d(TAG, "[Console] " + cm.message());
            return true;
        }

        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
            if (uploadMessage != null) {
                uploadMessage.onReceiveValue(null);
                uploadMessage = null;
            }
            uploadMessage = filePathCallback;

            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("image/*");

            try {
                startActivityForResult(Intent.createChooser(intent, "Seleccionar foto"), FILE_CHOOSER_REQ);
                return true;
            } catch (Exception e) {
                Log.e(TAG, "Cannot open file chooser: " + e.getMessage());
                if (uploadMessage != null) {
                    uploadMessage.onReceiveValue(null);
                    uploadMessage = null;
                }
                return false;
            }
        }
    }

    public static class SonoraDownloadListener implements DownloadListener {
        private final MainActivity activity;

        public SonoraDownloadListener(MainActivity activity) {
            this.activity = activity;
        }

        @Override
        public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
            try {
                Uri uri = Uri.parse(url);
                DownloadManager.Request request = new DownloadManager.Request(uri);
                if (mimetype != null && !mimetype.isEmpty()) {
                    request.setMimeType(mimetype);
                }
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) {
                    request.addRequestHeader("cookie", cookies);
                }
                if (userAgent != null) {
                    request.addRequestHeader("User-Agent", userAgent);
                }
                request.setDescription("Descargando archivo...");
                String filename = URLUtil.guessFileName(url, contentDisposition, mimetype);
                request.setTitle(filename);
                request.allowScanningByMediaScanner();
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);

                DownloadManager dm = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
                if (dm != null) {
                    dm.enqueue(request);
                    Toast.makeText(activity, "Descargando: " + filename, Toast.LENGTH_SHORT).show();
                }
            } catch (Exception e) {
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setData(Uri.parse(url));
                    activity.startActivity(i);
                } catch (Exception ex) {
                    Log.e(TAG, "Download intent error: " + ex.getMessage());
                }
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQ) {
            if (uploadMessage != null) {
                Uri[] results = null;
                if (resultCode == Activity.RESULT_OK && data != null) {
                    String dataString = data.getDataString();
                    if (dataString != null) {
                        results = new Uri[]{Uri.parse(dataString)};
                    } else if (data.getClipData() != null) {
                        int num = data.getClipData().getItemCount();
                        results = new Uri[num];
                        for (int i = 0; i < num; i++) {
                            results[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    }
                }
                uploadMessage.onReceiveValue(results);
                uploadMessage = null;
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == AUDIO_PERM_REQ) {
            final boolean granted = hasAudioPermission();
            Log.d(TAG, "Audio permission granted: " + granted);
            if (webView != null) {
                webView.post(new Runnable() {
                    @Override
                    public void run() {
                        webView.evaluateJavascript(
                            "window.onSonoraPermissionResult && window.onSonoraPermissionResult(" + granted + ");",
                            null);
                    }
                });
            }
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = new WebView(this);
        webView.setBackgroundColor(0xFF121212);
        webView.setLayoutParams(new android.view.ViewGroup.LayoutParams(
            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
            android.view.ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(webView);

        WebView.setWebContentsDebuggingEnabled(true);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setUseWideViewPort(false);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setWebViewClient(new SonoraWebViewClient());
        webView.setWebChromeClient(new SonoraChromeClient());
        webView.setDownloadListener(new SonoraDownloadListener(this));
        webView.addJavascriptInterface(new SonoraNativeInterface(this), "SonoraNative");

        webView.loadUrl("file:///android_asset/index.html");

        sInstance = this;

        // Android 13+: sin este permiso no se muestra la notificación con los
        // controles de reproducción.
        try {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(
                    Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{ Manifest.permission.POST_NOTIFICATIONS }, NOTIF_PERM_REQ);
            }
        } catch (Exception e) {
            Log.e(TAG, "permiso de notificaciones: " + e.getMessage());
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (webView != null && webView.canGoBack()) {
                webView.goBack();
                return true;
            }
            moveTaskToBack(true);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (sInstance == this) sInstance = null;
        try {
            PlaybackService.shutdown(this);
        } catch (Exception e) {
            Log.e(TAG, "onDestroy(playback): " + e.getMessage());
        }
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
