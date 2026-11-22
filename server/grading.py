"""One score contract shared by grading and offline evaluation."""
import math

SUBJECTIVE_PASS_SCORE = 70


def normalize_subjective_score(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("Invalid grading score")
    return math.floor(max(0, min(100, value)) + 0.5)
