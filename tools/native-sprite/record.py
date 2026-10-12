"""Record what the original engines draw for each scaler case.

    npx tsx tools/native-sprite/cases.mts 1 600 > /tmp/cases.json
    uv run --no-project --with unicorn --with pefile python -I \\
        tools/native-sprite/record.py /tmp/cases.json 1 > engine/tests/golden/sprite-scaler.json

Each case runs through DF.EXE's, TI.EXE's and tl.exe's world-sprite draw (see
native.py) and is kept as the SHA-1 of the whole canvas, 0xEE where nothing was
drawn. Needs the three rips under */gamefiles.

Every case runs on a freshly loaded engine. TI.EXE and tl.exe carry state from
one draw to the next: a sprite clipped at the top can take the colours of its
first rows from the previous draw. DF.EXE does not, and the fresh result is what
DF.EXE draws whatever came before.
"""
import base64, hashlib, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from native import Engine, CONFIGS, PATHS

cases = json.load(open(sys.argv[1]))
seed = int(sys.argv[2])
results = []
for i, c in enumerate(cases):
    sprite = base64.b64decode(c["sprite"])
    mask = base64.b64decode(c["mask"]) if c["mask"] else None
    clip = c["clip"]
    row = {}
    for k in ("df", "ti", "tl"):
        e = Engine(PATHS[k], CONFIGS[k])
        canvas = e.draw(sprite, c["ax"], c["ay"], c["dw"], c["dh"], 1 if c["flip"] else 0,
                        c["canvasW"], c["canvasH"],
                        clip=(clip["top"], clip["left"], clip["bottom"], clip["right"]),
                        mask=mask, level=c["level"])
        row[k] = hashlib.sha1(canvas).hexdigest()
    results.append(row)
    print(f"{i + 1}/{len(cases)}", file=sys.stderr, end="\r")
digest = hashlib.sha1(b"".join(base64.b64decode(c["sprite"]) for c in cases)).hexdigest()
json.dump({"seed": seed, "count": len(cases), "sprites": digest, "results": results}, sys.stdout, indent=0)
