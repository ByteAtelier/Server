import os
from typing import List, Optional, Tuple

import cv2
import numpy as np
import torch
from ultralytics import YOLO


def _letterbox(
    image: np.ndarray,
    new_shape: Tuple[int, int],
    color: Tuple[int, int, int] = (114, 114, 114),
) -> Tuple[np.ndarray, float, Tuple[int, int]]:
    h, w = image.shape[:2]
    nh, nw = new_shape

    ratio = min(nh / h, nw / w)
    new_unpad_w, new_unpad_h = int(round(w * ratio)), int(round(h * ratio))

    resized = cv2.resize(
        image, (new_unpad_w, new_unpad_h), interpolation=cv2.INTER_LINEAR
    )

    dw = nw - new_unpad_w
    dh = nh - new_unpad_h
    left, right = dw // 2, dw - dw // 2
    top, bottom = dh // 2, dh - dh // 2

    out = cv2.copyMakeBorder(
        resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=color
    )
    return out, ratio, (left, top)


class YoloSegEngine:
    def __init__(
        self,
        model_path: str,
        input_size: int = 640,
        conf: float = 0.25,
        iou: float = 0.45,
        device: Optional[str] = None,
        max_det: int = 100,
        mask_alpha: float = 0.45,
    ) -> None:
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"model not found: {model_path}")

        self.model = YOLO(model_path)
        self.input_size = input_size
        self.conf = conf
        self.iou = iou
        self.max_det = max_det
        self.mask_alpha = mask_alpha

        if device is None:
            self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        else:
            self.device = device

        self.palette: List[Tuple[int, int, int]] = [
            (0, 200, 255),
            (30, 255, 30),
            (255, 180, 0),
            (255, 80, 80),
            (180, 80, 255),
            (0, 255, 180),
        ]

    def _preprocess(
        self, bgr: np.ndarray
    ) -> Tuple[torch.Tensor, float, Tuple[int, int]]:
        letterboxed, ratio, pad = _letterbox(bgr, (self.input_size, self.input_size))
        rgb = cv2.cvtColor(letterboxed, cv2.COLOR_BGR2RGB)
        chw = np.transpose(rgb, (2, 0, 1)).astype(np.float32) / 255.0
        chw = np.ascontiguousarray(chw)
        tensor = torch.from_numpy(chw).unsqueeze(0).to(self.device)
        return tensor, ratio, pad

    def _clip_box(self, box: np.ndarray, w: int, h: int) -> Tuple[int, int, int, int]:
        x1, y1, x2, y2 = box.tolist()
        x1 = int(max(0, min(w - 1, x1)))
        y1 = int(max(0, min(h - 1, y1)))
        x2 = int(max(0, min(w - 1, x2)))
        y2 = int(max(0, min(h - 1, y2)))
        return x1, y1, x2, y2

    def _postprocess(
        self,
        orig_bgr: np.ndarray,
        result,
        ratio: float,
        pad: Tuple[int, int],
    ) -> np.ndarray:
        out = orig_bgr.copy()
        h0, w0 = out.shape[:2]
        left, top = pad

        if result.boxes is None or len(result.boxes) == 0:
            return out

        boxes = result.boxes.xyxy.detach().cpu().numpy()
        scores = result.boxes.conf.detach().cpu().numpy()
        classes = result.boxes.cls.detach().cpu().numpy().astype(int)

        masks = None
        if result.masks is not None and result.masks.data is not None:
            masks = result.masks.data.detach().cpu().numpy()

        overlay = out.copy()
        target_h = int(round(h0 * ratio))
        target_w = int(round(w0 * ratio))

        for i in range(len(boxes)):
            color = self.palette[i % len(self.palette)]

            if masks is not None and i < masks.shape[0]:
                m = masks[i]
                y1 = max(0, top)
                x1 = max(0, left)
                y2 = min(m.shape[0], top + target_h)
                x2 = min(m.shape[1], left + target_w)
                if y2 > y1 and x2 > x1:
                    m = m[y1:y2, x1:x2]
                    m = cv2.resize(m, (w0, h0), interpolation=cv2.INTER_LINEAR)
                    mask_bin = m > 0.5
                    overlay[mask_bin] = color

            b = boxes[i].copy()
            b[0] = (b[0] - left) / ratio
            b[1] = (b[1] - top) / ratio
            b[2] = (b[2] - left) / ratio
            b[3] = (b[3] - top) / ratio
            x1, y1, x2, y2 = self._clip_box(b, w0, h0)
            cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)

            cls_id = classes[i]
            name = (
                str(result.names.get(cls_id, cls_id))
                if isinstance(result.names, dict)
                else str(cls_id)
            )
            label = f"{name} {scores[i]:.2f}"
            cv2.putText(
                out,
                label,
                (x1, max(18, y1 - 6)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                color,
                2,
            )

        cv2.addWeighted(overlay, self.mask_alpha, out, 1.0 - self.mask_alpha, 0.0, out)
        return out

    def infer_bgr(self, bgr: np.ndarray) -> np.ndarray:
        tensor, ratio, pad = self._preprocess(bgr)
        results = self.model(
            tensor,
            conf=self.conf,
            iou=self.iou,
            max_det=self.max_det,
            verbose=False,
            device=self.device,
        )
        return self._postprocess(bgr, results[0], ratio, pad)
