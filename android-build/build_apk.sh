#!/bin/bash
set -e

echo "🔨 Iniciando compilación de Sonora Music v${VERSION} APK..."

export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"

SDK_ROOT="${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}"
BUILD_TOOLS="$SDK_ROOT/build-tools/34.0.0"
PLATFORM="$SDK_ROOT/platforms/android-34/android.jar"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR"
PUBLIC_DIR="$SCRIPT_DIR/../public"
VERSION="${VERSION:-7.6}"

AAPT2="$BUILD_TOOLS/aapt2"
D8="$BUILD_TOOLS/d8"
ZIPALIGN="$BUILD_TOOLS/zipalign"
APKSIGNER="$BUILD_TOOLS/apksigner"

echo "📂 Sincronizando recursos web en assets..."
mkdir -p "$BUILD_DIR/assets"
rsync -av --exclude="*.apk" "$PUBLIC_DIR/" "$BUILD_DIR/assets/"

cd "$BUILD_DIR"

rm -rf obj bin compiled_res
mkdir -p obj bin compiled_res

echo "📦 1/6: Compilando recursos con AAPT2..."
"$AAPT2" compile --dir res -o compiled_res/resources.zip

echo "🔗 2/6: Enlazando paquete APK base..."
"$AAPT2" link \
    -I "$PLATFORM" \
    --manifest AndroidManifest.xml \
    -A assets \
    -o bin/base.apk \
    --auto-add-overlay \
    compiled_res/resources.zip

echo "☕ 3/6: Compilando código Java..."
javac -g:none -source 8 -target 8 -cp "$PLATFORM" -d obj src/com/sonoramusic/app/MainActivity.java

echo "⚡ 4/6: Generando Dalvik Executable (classes.dex) con D8..."
"$D8" --lib "$PLATFORM" --min-api 24 --release --output bin obj/com/sonoramusic/app/*.class

echo "📥 5/6: Empaquetando dex en APK..."
cd bin
zip -u base.apk classes.dex
cd ..

echo "🔐 6/6: Zipalign y Firma criptográfica..."
"$ZIPALIGN" -f -v 4 bin/base.apk bin/unaligned.apk > /dev/null

KEYSTORE="debug.keystore"
if [ ! -f "$KEYSTORE" ]; then
    keytool -genkeypair -v \
        -keystore "$KEYSTORE" \
        -alias androiddebugkey \
        -keyalg RSA \
        -keysize 2048 \
        -validity 10000 \
        -storepass android \
        -keypass android \
        -dname "CN=SonoraMusic, OU=App, O=Sonora, L=City, S=State, C=US"
fi

FINAL_APK="$SCRIPT_DIR/../SonoraMusic_v${VERSION}.apk"
rm -f "$FINAL_APK"

"$APKSIGNER" sign \
    --ks "$KEYSTORE" \
    --ks-pass pass:android \
    --key-pass pass:android \
    --ks-key-alias androiddebugkey \
    --out "$FINAL_APK" \
    bin/unaligned.apk

echo "✅ Verificando firma del APK..."
"$APKSIGNER" verify "$FINAL_APK"

# Copy to Desktop and web public directory
cp "$FINAL_APK" "$HOME/Desktop/SonoraMusic_v${VERSION}.apk" 2>/dev/null || true
cp "$FINAL_APK" "$PUBLIC_DIR/SonoraMusic_v${VERSION}.apk" 2>/dev/null || true

SIZE=$(du -h "$FINAL_APK" | cut -f1)
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || echo 192.168.1.132)"
echo "🎉 ¡ÉXITO! APK v${VERSION} generado con éxito:"
echo "📂 $FINAL_APK ($SIZE)"
echo "📂 $HOME/Desktop/SonoraMusic_v${VERSION}.apk"
echo "🌐 http://$LAN_IP:3000/SonoraMusic_v${VERSION}.apk"
