package com.sonoramusic.app;

import android.app.Activity;
import android.os.Bundle;
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

public class MainActivity extends Activity {
    private static final String TAG = "SonoraMusic";
    private static final int FILE_CHOOSER_REQ = 1001;

    private WebView webView;
    private ValueCallback<Uri[]> uploadMessage;

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

        @android.webkit.JavascriptInterface
        public String getDeviceMusicFiles() {
            JSONArray arr = new JSONArray();
            Cursor cursor = null;
            try {
                String[] projection = {
                    MediaStore.Audio.Media._ID,
                    MediaStore.Audio.Media.TITLE,
                    MediaStore.Audio.Media.ARTIST,
                    MediaStore.Audio.Media.ALBUM,
                    MediaStore.Audio.Media.DURATION,
                    MediaStore.Audio.Media.DATA
                };
                String selection = MediaStore.Audio.Media.IS_MUSIC + " != 0";
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

                        obj.put("id", "device_" + id);
                        obj.put("title", title != null ? title : "Canción local");
                        obj.put("artist", artist != null ? artist : "Artista desconocido");
                        obj.put("album", album != null ? album : "Dispositivo");
                        obj.put("duration", durMs > 0 ? (durMs / 1000) : 180);
                        obj.put("filePath", path != null ? ("file://" + path) : "");
                        obj.put("rawPath", path != null ? path : "");
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
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
