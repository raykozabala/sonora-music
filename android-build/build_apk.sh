#!/bin/bash
set -e

echo "🔨 Iniciando compilación de Sonora Music v7.17.4 APK..."

# D8 y apksigner necesitan JDK 11+. Preferimos el JBR de Android Studio;
# si no está instalado, usamos OpenJDK 17 de Homebrew.
if [ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]; then
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
elif [ -d "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" ]; then
    export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
elif [ -d "/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" ]; then
    export JAVA_HOME="/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
fi

if [ -z "$JAVA_HOME" ] || [ ! -x "$JAVA_HOME/bin/javac" ]; then
    echo "❌ No se encontró un JDK 17. Instala OpenJDK 17 (brew install openjdk@17)."
    exit 1
fi

export PATH="$JAVA_HOME/bin:$PATH"

SDK_ROOT="/Users/rayko/Library/Android/sdk"
BUILD_TOOLS="$SDK_ROOT/build-tools/34.0.0"
PLATFORM="$SDK_ROOT/platforms/android-34/android.jar"
BUILD_DIR="/Users/rayko/Documents/Codex/SONORA MUSIC ANTI2/sonora-music/android-build"
PUBLIC_DIR="/Users/rayko/Documents/Codex/SONORA MUSIC ANTI2/sonora-music/public"
PROJECT_ROOT="/Users/rayko/Documents/Codex/SONORA MUSIC ANTI2"

AAPT2="$BUILD_TOOLS/aapt2"
D8="$BUILD_TOOLS/d8"
ZIPALIGN="$BUILD_TOOLS/zipalign"
APKSIGNER="$BUILD_TOOLS/apksigner"

echo "📂 Sincronizando recursos web en assets..."
mkdir -p "$BUILD_DIR/assets"
rsync -av --delete --exclude="*.apk" "$PUBLIC_DIR/" "$BUILD_DIR/assets/"

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

if [ ! -f "$BUILD_DIR/classes.dex" ]; then
    echo "❌ Falta classes.dex (contiene PlaybackService, SonoraWidgetProvider y"
    echo "   los métodos nativos de guardado/carátulas que no están en src/)."
    echo "   Restaura android-build/classes.dex antes de compilar."
    exit 1
fi

echo "⚡ 3/6 & 4/6: Incorporando classes.dex (con soporte para Widget y PlaybackService)..."
cp "$BUILD_DIR/classes.dex" bin/classes.dex

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

FINAL_APK="$PROJECT_ROOT/SonoraMusic_v7.17.4.apk"
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

# Copiar a Desktop y a la raíz de sonora-music
cp "$FINAL_APK" /Users/rayko/Desktop/SonoraMusic_v7.17.4.apk 2>/dev/null || true
cp "$FINAL_APK" "$PROJECT_ROOT/sonora-music/SonoraMusic_v7.17.4.apk" 2>/dev/null || true

SIZE=$(du -h "$FINAL_APK" | cut -f1)
echo "🎉 ¡ÉXITO! APK v7.17.4 generado con éxito:"
echo "📂 $FINAL_APK ($SIZE)"
echo "📂 $PROJECT_ROOT/sonora-music/SonoraMusic_v7.17.4.apk"
echo "📂 /Users/rayko/Desktop/SonoraMusic_v7.17.4.apk"
