#!/bin/sh
# Ubuntu amd64. Install only inside the application's runtime directory.
set -eu
source_dir=$(cd "$(dirname "$0")" && pwd)
dest=${1:-/opt/orbita/runtime/dating-v1}
mkdir -p "$dest/packages" "$dest/sysroot" "$dest/model"
dest=$(cd "$dest" && pwd)
cd "$dest/packages"
extra=$(LC_ALL=C apt-get -s --no-install-recommends install tesseract-ocr tesseract-ocr-eng tesseract-ocr-rus | awk '/^Inst / {print $2}')
leptonica=$(LC_ALL=C apt-cache depends libtesseract5 | sed -n 's/.*Depends: \(libleptonica[0-9]*\).*/\1/p' | head -1)
apt-get download tesseract-ocr tesseract-ocr-eng tesseract-ocr-rus libtesseract5 "$leptonica" $extra
for package in ./*.deb; do dpkg-deb -x "$package" "$dest/sysroot"; done
if [ -n "${UV_BIN:-}" ]; then
    "$UV_BIN" venv --python "${PYTHON_VERSION:-3.12}" "$dest/venv"
    "$UV_BIN" pip install --python "$dest/venv/bin/python" --only-binary=:all: 'pillow==12.2.0' 'numpy==2.2.6' 'onnxruntime==1.22.1' 'zxing-cpp==2.3.0' 'tokenizers==0.21.4'
else
    python3 -m venv "$dest/venv"
    "$dest/venv/bin/pip" --disable-pip-version-check install --only-binary=:all: --no-cache-dir 'pillow==12.2.0' 'numpy==2.2.6' 'onnxruntime==1.22.1' 'zxing-cpp==2.3.0' 'tokenizers==0.21.4'
fi
model="$dest/model/nsfw_vit_tiny_384_int8.onnx"
digest=20cc99a8986320972273253325975203f2a647ca0010a1ac9c869a0dbb9eb77d
url=https://huggingface.co/kasimtmc/nsfw-image-detection-384-onnx/resolve/8a2d1b7d93d38688c6f9a38767c16acd7de4280b/nsfw_vit_tiny_384_int8.onnx
if ! echo "$digest  $model" | sha256sum -c --status 2>/dev/null; then
    curl --fail --location --retry 3 --max-time 180 "$url" -o "$model.part"
    echo "$digest  $model.part" | sha256sum --check
    mv "$model.part" "$model"
fi
cp /usr/share/common-licenses/Apache-2.0 "$dest/model/LICENSE"
echo 'Marqo/nsfw-image-detection-384, int8 ONNX export by kasimtmc, Apache-2.0.' > "$dest/model/NOTICE"
textbase=https://huggingface.co/onnx-community/rubert-tiny-toxicity-ONNX/resolve/3c117322c91030ff04846b72e15509ae7f5232f1
get_text_asset() {
    target="$dest/model/$1"
    if ! echo "$3  $target" | sha256sum -c --status 2>/dev/null; then
        curl --fail --location --retry 3 --max-time 180 "$textbase/$2" -o "$target.part"
        echo "$3  $target.part" | sha256sum --check
        mv "$target.part" "$target"
    fi
}
get_text_asset toxicity.onnx onnx/model_int8.onnx 8244bb3f1f75208123775e87c4648c682c2719f3a01200bab9db005b06fcc3e5
get_text_asset tokenizer.json tokenizer.json 064a132db204e46351abb4c3acb9da22fc4a837390be3b87877e79212e10dffa
echo 'cointegrated/rubert-tiny-toxicity; ONNX Community export, MIT.' > "$dest/model/TEXT-NOTICE"
cp "$source_dir/TEXT-LICENSE.txt" "$dest/model/TEXT-LICENSE.txt"
LD_LIBRARY_PATH="$dest/sysroot/usr/lib/x86_64-linux-gnu" TESSDATA_PREFIX="$dest/sysroot/usr/share/tesseract-ocr/5/tessdata" "$dest/sysroot/usr/bin/tesseract" --list-langs
"$dest/venv/bin/python" -c 'import PIL, numpy, onnxruntime, zxingcpp, tokenizers; print("Dating moderation runtime ready")'
