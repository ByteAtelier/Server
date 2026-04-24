import os
import sys


def log(msg: str) -> None:
    try:
        fr = sys._getframe(1)  # caller frame
        filename = os.path.basename(fr.f_code.co_filename) or "<?>"
        lineno = fr.f_lineno
        prefix = f"[{filename}:{lineno}] "
    except Exception:
        prefix = "[<?>:0] "

    sys.stderr.write(f"{prefix}{msg}\n")
    sys.stderr.flush()
