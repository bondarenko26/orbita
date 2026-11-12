"""One private image on stdin; one bounded JSON result on stdout. Never log image or OCR text."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError


RUNTIME = Path(os.environ.get("DATING_RUNTIME", "/opt/orbita/runtime/dating-v1"))
MODEL = RUNTIME / "model/nsfw_vit_tiny_384_int8.onnx"
DIGEST = "20cc99a8986320972273253325975203f2a647ca0010a1ac9c869a0dbb9eb77d"
MAX_BYTES = 600_000
Image.MAX_IMAGE_PIXELS = 9_000_000
warnings.simplefilter("error", Image.DecompressionBombWarning)


def read_words(canvas):
    if os.name == "nt":
        from tesserocr import PyTessBaseAPI, PSM, get_languages
        data = str(RUNTIME / "tessdata")
        if not {"rus", "eng"}.issubset(get_languages(data)[1]):
            raise RuntimeError("OCR languages")
        with PyTessBaseAPI(path=data, lang="rus+eng", psm=PSM.SPARSE_TEXT) as api:
            api.SetImage(canvas)
            return api.GetUTF8Text()[:12000]
    png = io.BytesIO()
    canvas.save(png, "PNG")
    sysroot = RUNTIME / "sysroot/usr"
    env = {**os.environ, "LD_LIBRARY_PATH": str(sysroot / "lib/x86_64-linux-gnu"),
           "TESSDATA_PREFIX": str(sysroot / "share/tesseract-ocr/5/tessdata"), "OMP_THREAD_LIMIT": "1"}
    executable = str(sysroot / "bin/tesseract")
    languages = subprocess.run([executable, "--list-langs"], env=env,
                               capture_output=True, check=True, timeout=8).stdout.decode().splitlines()
    if not {"rus", "eng"}.issubset(languages):
        raise RuntimeError("OCR languages")
    ocr = subprocess.run([executable, "stdin", "stdout", "-l", "rus+eng", "--psm", "11"],
                         input=png.getvalue(), capture_output=True, env=env, timeout=22, check=True)
    return ocr.stdout.decode("utf-8")[:12000]


def moderate(raw):
    try:
        if not 0 < len(raw) <= MAX_BYTES:
            raise ValueError()
        with Image.open(io.BytesIO(raw), formats=("JPEG", "PNG", "WEBP")) as original:
            w, h = original.size
            if min(w, h) < 120 or max(w, h) > 4096 or w * h > Image.MAX_IMAGE_PIXELS or getattr(original, "n_frames", 1) != 1:
                raise ValueError()
            original.thumbnail((960, 960), Image.Resampling.LANCZOS)
            image = ImageOps.exif_transpose(original).convert("RGBA")
        canvas = Image.new("RGB", image.size, "white")
        canvas.paste(image, mask=image.getchannel("A"))
    except (ValueError, OSError, SyntaxError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        return {"invalid": True}

    import numpy as np
    import onnxruntime as ort
    import zxingcpp

    options = ort.SessionOptions()
    options.intra_op_num_threads = options.inter_op_num_threads = 1
    options.enable_cpu_mem_arena = False
    options.enable_mem_pattern = False
    if hashlib.sha256(MODEL.read_bytes()).hexdigest() != DIGEST:
        raise RuntimeError("model integrity")
    model = ort.InferenceSession(str(MODEL), sess_options=options, providers=["CPUExecutionProvider"])
    sample = canvas.resize((384, 384), Image.Resampling.BICUBIC)
    tensor = np.asarray(sample, dtype=np.float32) / 127.5 - 1.0
    logits = model.run(["logits"], {"pixel_values": tensor.transpose(2, 0, 1)[None]})[0][0]
    if logits.shape != (2,) or not np.isfinite(logits).all():
        raise RuntimeError("model result")
    weights = np.exp(logits - logits.max())
    score = float(weights[0] / weights.sum())
    del model

    found_qr = bool(zxingcpp.read_barcodes(np.asarray(canvas.convert("L")), formats=zxingcpp.BarcodeFormat.QRCode))
    words = read_words(canvas)
    jpeg = io.BytesIO()
    canvas.save(jpeg, "JPEG", quality=81, optimize=True)
    return {"jpeg": base64.b64encode(jpeg.getvalue()).decode("ascii"), "ocr": words,
            "qr": found_qr, "score": score}


if __name__ == "__main__":
    try:
        print(json.dumps(moderate(sys.stdin.buffer.read(MAX_BYTES + 1)), ensure_ascii=True))
    except Exception:
        # The caller retries infrastructure failures. Do not write personal data in diagnostics.
        sys.exit(2)
