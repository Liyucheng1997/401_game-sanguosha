"""用本机 F5-TTS（F:\\我的编程项目\\123_AI视频自动化）生成武将台词与出牌配音。

必须用那个项目自带的 Python 环境运行：
  "F:\\我的编程项目\\123_AI视频自动化\\tools\\f5-tts-env\\python.exe" tools/gen_voice.py            # 只生成新增/改动的台词
  ... tools/gen_voice.py skill_jianxiong card_m_杀                                              # 指定条目重新生成
台词表在 tools/voice_lines.json：[{id, text, voice}]。
每条合成后用 faster-whisper 识别，和原文按拼音比对，读错就换随机种子重试（最多 3 次）；
输出 assets/voice/<id>.mp3（24kHz 单声道），以及 assets/voice/manifest.json。
"""
import difflib, hashlib, json, os, re, subprocess, sys, tempfile, time, wave
from concurrent.futures import ThreadPoolExecutor

AUTO_PROJECT = os.environ.get("AUTO_PROJECT", r"F:\我的编程项目\123_AI视频自动化")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LINES = os.environ.get("VOICE_LINES", os.path.join(ROOT, "tools", "voice_lines.json"))
OUT = os.environ.get("VOICE_OUT", os.path.join(ROOT, "assets", "voice"))
MANIFEST = os.path.join(OUT, "manifest.json")

sys.path.insert(0, AUTO_PROJECT)
from src import config  # noqa: E402  导入时设置 HF 缓存与 CUDA dll 路径
from src import tts_f5  # noqa: E402

import numpy as np  # noqa: E402

PARALLEL = 3


# 参考音频是英文的音色：F5 按参考文本长度估算时长，念短中文会被压得太短，所以按字数显式给时长
FIX_DURATION = {"浑厚男声", "沉稳男声", "温柔女声"}
# 额外音色：f5_tts 自带的中文女声参考
EXTRA_VOICES = {"中文女声": ("basic/basic_ref_zh.wav", "对，这就是我，万人敬仰的太乙真人。")}


def key(item):
    ver = "v3" if item["voice"] in FIX_DURATION else "v2"
    return hashlib.md5((ver + "|" + item["voice"] + "|" + item["text"]).encode()).hexdigest()[:12]


def est_seconds(text):
    """按字数和标点估算台词时长。"""
    n = len(han(text))
    s = 0.24 * n + 0.32 * text.count("……") + 0.14 * len(re.findall(r"[，。、；]", text)) + 0.06 * len(re.findall(r"[！？]", text))
    return max(0.5, s + 0.12)


def han(s):
    return re.findall(r"[一-鿿]", s)


def pinyin(chars):
    from pypinyin import lazy_pinyin
    return [lazy_pinyin(c)[0] for c in chars]


_asr = None


def asr(x16, text):
    global _asr
    from faster_whisper import WhisperModel
    if _asr is None:
        try:
            _asr = WhisperModel("small", device="cuda", compute_type="float16")
        except Exception:
            _asr = WhisperModel("small", device="cpu", compute_type="int8")
    # 短句不给提示词，否则 Whisper 容易把提示词当成识别结果
    prompt = "以下是普通话朗读。" if len(han(text)) > 4 else None
    segs, _ = _asr.transcribe(x16, language="zh", vad_filter=False, condition_on_previous_text=False, initial_prompt=prompt)
    return "".join(s.text for s in segs)


def score(text, said):
    a, b = pinyin(han(text)), pinyin(han(said))
    if not a:
        return 1.0
    return difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()


def trim(x, sr):
    hop = sr // 100
    n = len(x) // hop * hop
    if n == 0:
        return x
    e = np.sqrt(np.mean(x[:n].reshape(-1, hop) ** 2, 1))
    on = np.where(e > max(0.004, e.max() * 0.03))[0]
    if not len(on):
        return x
    a = max(0, (on[0] - 4) * hop)
    b = min(len(x), (on[-1] + 10) * hop)
    return x[a:b]


_voice_cache = {}


def resolve(voice):
    if voice not in _voice_cache:
        if voice in EXTRA_VOICES:
            rel, text = EXTRA_VOICES[voice]
            _voice_cache[voice] = (os.path.join(tts_f5._f5_examples_dir(), rel), text)
        else:
            config.TTS_VOICE = voice
            _voice_cache[voice] = tts_f5._resolve_voice()
    return _voice_cache[voice]


def synth(item, attempt):
    import soundfile as sf
    ref_audio, ref_text = resolve(item["voice"])
    seed = 1234 + attempt * 7919 + int(hashlib.md5(item["id"].encode()).hexdigest()[:6], 16)
    fix = None
    if item["voice"] in FIX_DURATION:
        fix = min(sf.info(ref_audio).duration, 12) + est_seconds(item["text"]) * (1 + 0.08 * attempt)
    wav, sr, _ = tts_f5._get_model().infer(
        ref_file=ref_audio, ref_text=ref_text, gen_text=item["text"], speed=1.0, nfe_step=32,
        cross_fade_duration=0.15, fix_duration=fix, seed=seed, show_info=lambda *a, **k: None, progress=None)
    x = trim(np.asarray(wav, np.float32), sr)
    peak = float(np.abs(x).max() or 1)
    x = x / peak * 0.92
    f = int(0.008 * sr)
    if len(x) > f * 4:
        x[:f] *= np.linspace(0, 1, f)
        x[-f * 3:] *= np.linspace(1, 0, f * 3)
    return x, sr


def write_mp3(x, sr, path):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        tmp = tf.name
    with wave.open(tmp, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-ac", "1", "-ar", "24000", "-b:a", "56k", path], check=True)
    os.remove(tmp)


def main():
    os.makedirs(OUT, exist_ok=True)
    items = json.load(open(LINES, encoding="utf-8"))
    man = json.load(open(MANIFEST, encoding="utf-8")) if os.path.exists(MANIFEST) else {}
    only = set(sys.argv[1:])
    todo = [it for it in items if (it["id"] in only) or (not only and (man.get(it["id"], {}).get("key") != key(it) or not os.path.exists(os.path.join(OUT, it["id"] + ".mp3"))))]
    print(f"共 {len(items)} 条，需要生成 {len(todo)} 条", flush=True)
    if not todo:
        return
    tts_f5._get_model()
    from scipy.signal import resample_poly

    def work(it):
        best = None
        for attempt in range(3):
            x, sr = synth(it, attempt)
            said = asr(resample_poly(x, 16000, sr).astype(np.float32), it["text"])
            sc = score(it["text"], said)
            if not best or sc > best[2]:
                best = (x, sr, sc, said)
            if sc >= 0.9:
                break
        return it, best

    t0 = time.time()
    done = 0
    with ThreadPoolExecutor(max_workers=PARALLEL) as pool:
        for it, (x, sr, sc, said) in pool.map(work, todo):
            write_mp3(x, sr, os.path.join(OUT, it["id"] + ".mp3"))
            man[it["id"]] = {"key": key(it), "text": it["text"], "voice": it["voice"], "dur": round(len(x) / sr, 2), "asr": said, "score": round(sc, 2)}
            done += 1
            flag = "" if sc >= 0.9 else f"  <-- 识别为「{said}」"
            print(f"[{done}/{len(todo)}] {it['id']} {len(x) / sr:.1f}s {sc:.2f} {it['text']}{flag}", flush=True)
            if done % 20 == 0:
                json.dump(man, open(MANIFEST, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(man, open(MANIFEST, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    bad = [k for k, v in man.items() if v["score"] < 0.9]
    print(f"完成，用时 {time.time() - t0:.0f}s。识别不完全吻合的条目：{bad or '无'}", flush=True)


if __name__ == "__main__":
    main()
