def check_policy(intent):

    if intent.max_amount > 100000:
        return {
            "allowed": False,
            "reason": "Amount exceeds the maximum allowed limit"
        }

    return {
        "allowed": True,
        "reason": "Policy passed"
    }