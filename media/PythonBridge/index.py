# index.py（协议配套骨架，Header v2：12B）
# 0..3   frameId  u32 LE
# 4..11  tsMs     u64 LE
# payload: 固定 BGR24 = W*H*3
#
# 说明：
# - 这里仅提供“读一帧 -> 原样写回一帧”的最小骨架，便于你在此处编排门控/YOLO/图像处理。
# - 任何异常直接抛出，让进程失败（符合 demo 阶段 fail-fast 风格）。

import sys
import struct
import argparse

from utils.utils import log

W = 640 # 默认宽度 后被覆盖
H = 480 # 默认高度 后被覆盖
PAYLOAD_LEN = W * H * 3 # 默认 payload 长度 后被覆盖

# struct 格式码说明
# - I：unsigned int（4 字节，无符号 32 位 / u32）
# - Q：unsigned long long（8 字节，无符号 64 位 / u64）
# - "<"：小端序（little-endian）
HDR_FMT = "<IQ"  # u32 frameId, u64 tsMs (LE)
HDR_SIZE = struct.calcsize(HDR_FMT)  # 12

def read_exact(n: int) -> bytes:
    buf = bytearray()
    r = sys.stdin.buffer.read
    while len(buf) < n:
        chunk = r(n - len(buf))
        if not chunk:
            raise EOFError("stdin closed")
        buf += chunk
    return bytes(buf)

def write_all(b: bytes) -> None:
    sys.stdout.buffer.write(b)
    sys.stdout.buffer.flush()

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--w", type=int, required=True)
    p.add_argument("--h", type=int, required=True)
    return p.parse_args()

def main():
    args = parse_args()
    W, H = args.w, args.h
    PAYLOAD_LEN = W * H * 3
    log(f"READY w={W} h={H} payload={PAYLOAD_LEN} hdr={HDR_SIZE} fmt={HDR_FMT}")

    while True:
        hdr = read_exact(HDR_SIZE)
        frame_id, ts_ms = struct.unpack(HDR_FMT, hdr)
        payload = read_exact(PAYLOAD_LEN)

        # TODO: 在这里做你的门控/拦截/图像处理（输入 BGR payload，输出 BGR out_payload）
        out_payload = payload

        out_hdr = struct.pack(HDR_FMT, frame_id, ts_ms)
        write_all(out_hdr + out_payload)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        log(f"FATAL: {e}")
        traceback.print_exc(file=sys.stderr)
        sys.stderr.flush()
        raise
