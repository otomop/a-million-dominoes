"""Fetch and parse the public datasets used to train and test the final network.

Self-contained on purpose (standard library + numpy only, no project imports):
run it in isolated mode from the ``compiler`` folder,

    ..\\.venv\\Scripts\\python.exe -I dominoes\\prepare_data.py

Downloads are treated as data only.  Each archive stays in its own folder under
``data/``, nothing is extracted to disk and nothing downloaded is executed; the
members are read in memory and re-written as plain arrays in ``data/prepared/``.

Sources (see SOURCES below for the exact URLs):
  * UCI "Optical Recognition of Handwritten Digits" (Alpaydin & Kaynak, 1998),
    CC BY 4.0.  ``optdigits-orig.*.Z`` hold the original 32x32 bitmaps.
  * UCI "Pen-Based Recognition of Handwritten Digits" (Alpaydin & Alimoglu,
    1996), CC BY 4.0.  ``pendigits-orig.*.Z`` hold the raw tablet strokes.
  * MNIST (LeCun, Cortes, Burges), CC BY-SA 3.0, from the PyTorch mirror.
"""

import gzip
import io
import os
import sys
import urllib.request
import zipfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "data")
OUT = os.path.join(DATA, "prepared")

SOURCES = {
    "optdigits_orig/optdigits.zip": "https://archive.ics.uci.edu/static/public/80/optical+recognition+of+handwritten+digits.zip",
    "pendigits_orig/pendigits.zip": "https://archive.ics.uci.edu/static/public/81/pen+based+recognition+of+handwritten+digits.zip",
    "mnist/train-images-idx3-ubyte.gz": "https://ossci-datasets.s3.amazonaws.com/mnist/train-images-idx3-ubyte.gz",
    "mnist/train-labels-idx1-ubyte.gz": "https://ossci-datasets.s3.amazonaws.com/mnist/train-labels-idx1-ubyte.gz",
    "mnist/t10k-images-idx3-ubyte.gz": "https://ossci-datasets.s3.amazonaws.com/mnist/t10k-images-idx3-ubyte.gz",
    "mnist/t10k-labels-idx1-ubyte.gz": "https://ossci-datasets.s3.amazonaws.com/mnist/t10k-labels-idx1-ubyte.gz",
}


def fetch(rel):
    path = os.path.join(DATA, *rel.split("/"))
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        print("downloading", SOURCES[rel], flush=True)
        with urllib.request.urlopen(SOURCES[rel], timeout=120) as r:
            blob = r.read()
        with open(path, "wb") as f:
            f.write(blob)
    with open(path, "rb") as f:
        return f.read()


def unlzw(data):
    """Decode a Unix ``compress`` (.Z) stream.  Follows Mark Adler's unlzw.c."""
    if len(data) < 3 or data[0] != 0x1F or data[1] != 0x9D:
        raise ValueError("not a .Z stream")
    flags = data[2] & 0x80
    maxbits = data[2] & 0x1F
    if maxbits < 9 or maxbits > 16:
        raise ValueError("bad code size")
    n = len(data)
    if n == 3:
        return b""
    bits, mask = 9, 0x1FF
    end = 256 if flags else 255
    prefix = [0] * 65536
    suffix = [0] * 65536
    out = bytearray()
    if n < 5:
        raise ValueError("truncated")
    buf = data[3] | (data[4] << 8)
    final = prev = buf & mask
    buf >>= bits
    left = 16 - bits
    if prev > 255:
        raise ValueError("first code is not a literal")
    out.append(final)
    mark, nxt = 3, 5
    while nxt < n:
        flush = False
        if end >= mask and bits < maxbits:
            flush = True
            bits += 1
            mask = (mask << 1) | 1
            old_bits = bits - 1
        if flush:
            left = 0
            rem = (nxt - mark) % old_bits
            if rem:
                rem = old_bits - rem
                if rem >= n - nxt:
                    break
                nxt += rem
            buf = 0
            mark = nxt
        if left == 0:
            buf = 0
        buf += data[nxt] << left
        nxt += 1
        left += 8
        if left < bits:
            if nxt == n:
                raise ValueError("truncated")
            buf += data[nxt] << left
            nxt += 1
            left += 8
        code = buf & mask
        buf >>= bits
        left -= bits
        if code == 256 and flags:
            left = 0
            rem = (nxt - mark) % bits
            if rem:
                rem = bits - rem
                if rem >= n - nxt:
                    break
                nxt += rem
            buf = 0
            mark = nxt
            bits, mask = 9, 0x1FF
            end = 255
            continue
        temp = code
        stack = []
        if code > end:
            if code != end + 1 or prev > end:
                raise ValueError("invalid code")
            stack.append(final)
            code = prev
        while code >= 256:
            stack.append(suffix[code])
            code = prefix[code]
        stack.append(code)
        final = code
        if end < mask:
            end += 1
            prefix[end] = prev
            suffix[end] = final
        prev = temp
        stack.reverse()
        out.extend(stack)
    return bytes(out)


def parse_optdigits_orig(text):
    """32x32 bitmaps: 32 lines of 32 characters 0/1, then a line with the label."""
    lines = [ln.strip() for ln in text.splitlines()]
    rows = [i for i, ln in enumerate(lines) if len(ln) == 32 and set(ln) <= {"0", "1"}]
    imgs, labels = [], []
    i = rows[0]
    while i + 32 < len(lines):
        blk = lines[i : i + 32]
        if not all(len(ln) == 32 and set(ln) <= {"0", "1"} for ln in blk):
            break
        lab = lines[i + 32]
        if not (len(lab) == 1 and lab.isdigit()):
            raise ValueError("label expected at line %d" % (i + 32))
        imgs.append(np.array([[c == "1" for c in ln] for ln in blk], dtype=np.uint8))
        labels.append(int(lab))
        i += 33
    return np.stack(imgs), np.array(labels, dtype=np.int64)


def parse_pendigits_orig(text):
    """UNIPEN-style strokes.  Returns flat points, stroke offsets, digit offsets, labels."""
    pts, sptr, dptr, labels = [], [0], [0], []
    cur = None
    open_digit = False
    for ln in text.splitlines():
        s = ln.strip()
        if not s:
            continue
        if s.startswith(".SEGMENT"):
            if open_digit:
                dptr.append(len(sptr) - 1)
            q = s.split('"')
            labels.append(int(q[1]))
            open_digit = True
        elif s.startswith(".PEN_DOWN"):
            cur = []
        elif s.startswith(".PEN_UP"):
            if cur:
                pts.extend(cur)
                sptr.append(len(pts))
            cur = None
        elif s[0] == ".":
            continue
        elif cur is not None:
            a = s.split()
            cur.append((int(a[0]), int(a[1])))
    if open_digit:
        dptr.append(len(sptr) - 1)
    return (
        np.array(pts, dtype=np.int32).reshape(-1, 2),
        np.array(sptr, dtype=np.int64),
        np.array(dptr, dtype=np.int64),
        np.array(labels, dtype=np.int64),
    )


def idx(blob):
    raw = gzip.decompress(blob)
    magic = int.from_bytes(raw[0:4], "big")
    ndim = magic & 0xFF
    dims = [int.from_bytes(raw[4 + 4 * i : 8 + 4 * i], "big") for i in range(ndim)]
    return np.frombuffer(raw, dtype=np.uint8, offset=4 + 4 * ndim).reshape(dims).copy()


def main():
    os.makedirs(OUT, exist_ok=True)

    z = zipfile.ZipFile(io.BytesIO(fetch("optdigits_orig/optdigits.zip")))
    print("optdigits zip members:", z.namelist())
    out = {}
    for part in ("tra", "cv", "wdep", "windep"):
        text = unlzw(z.read("optdigits-orig.%s.Z" % part)).decode("latin-1")
        imgs, labels = parse_optdigits_orig(text)
        out[part + "_img"], out[part + "_y"] = imgs, labels
        print("optdigits-orig", part, imgs.shape, np.bincount(labels, minlength=10).tolist())
    np.savez_compressed(os.path.join(OUT, "optdigits_orig.npz"), **out)

    z = zipfile.ZipFile(io.BytesIO(fetch("pendigits_orig/pendigits.zip")))
    print("pendigits zip members:", z.namelist())
    out = {}
    for part in ("tra", "tes"):
        text = unlzw(z.read("pendigits-orig.%s.Z" % part)).decode("latin-1")
        pts, sptr, dptr, labels = parse_pendigits_orig(text)
        out[part + "_pts"], out[part + "_sptr"], out[part + "_dptr"], out[part + "_y"] = pts, sptr, dptr, labels
        print(
            "pendigits-orig",
            part,
            "digits",
            len(labels),
            "strokes",
            len(sptr) - 1,
            "points",
            len(pts),
            np.bincount(labels, minlength=10).tolist(),
        )
    np.savez_compressed(os.path.join(OUT, "pendigits_orig.npz"), **out)

    out = {
        "train_img": idx(fetch("mnist/train-images-idx3-ubyte.gz")),
        "train_y": idx(fetch("mnist/train-labels-idx1-ubyte.gz")).astype(np.int64),
        "test_img": idx(fetch("mnist/t10k-images-idx3-ubyte.gz")),
        "test_y": idx(fetch("mnist/t10k-labels-idx1-ubyte.gz")).astype(np.int64),
    }
    print("mnist", out["train_img"].shape, out["test_img"].shape)
    np.savez_compressed(os.path.join(OUT, "mnist.npz"), **out)


if __name__ == "__main__":
    sys.exit(main())
