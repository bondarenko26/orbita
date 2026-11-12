"""Score only public profile text. Load the Russian classifier and tokenizer from disk."""
import json
import os
from pathlib import Path
import sys

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer


def score(texts):
    assets = Path(os.environ["DATING_RUNTIME"]) / "model"
    tokenizer = Tokenizer.from_file(str(assets / "tokenizer.json"))
    tokenizer.enable_truncation(max_length=192, stride=24)
    options = ort.SessionOptions()
    options.intra_op_num_threads = options.inter_op_num_threads = 1
    options.enable_cpu_mem_arena = options.enable_mem_pattern = False
    model = ort.InferenceSession(str(assets / "toxicity.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
    scores = []
    for text in texts:
        peak = 0.0
        if text.strip():
            encoding = tokenizer.encode(text[:1600])
            for part in [encoding, *encoding.overflowing]:
                arrays = {"input_ids": part.ids, "attention_mask": part.attention_mask, "token_type_ids": part.type_ids}
                inputs = {key.name: np.array([arrays[key.name]], dtype=np.int64) for key in model.get_inputs()}
                logits = model.run(["logits"], inputs)[0][0]
                if logits.shape != (5,) or not np.isfinite(logits).all():
                    raise RuntimeError("text model result")
                # Multilabel head: insult, obscenity and threat are independent sigmoid outputs.
                probabilities = 1 / (1 + np.exp(-logits[1:4]))
                peak = max(peak, float(probabilities.max()))
        scores.append(peak)
    return {"scores": scores}


if __name__ == "__main__":
    try:
        print(json.dumps(score(json.loads(sys.stdin.buffer.read(32000)))))
    except Exception:
        sys.exit(2)
