"""MVP deterministic review rules. Not an FSRS model or a mastery estimate."""
INTERVALS = (1, 3, 7, 14, 30, 60)


def next_review(feedback, assisted, successes):
    states = [item['status'] for item in feedback['criteria']]
    if not states or 'uncertain' in states:
        return None, False  # An uncertain judgment must not push a due date forward.
    passed = all(state == 'met' for state in states) and not assisted
    return (INTERVALS[min(max(0, successes) + 1, len(INTERVALS) - 1)] if passed else 1), passed
