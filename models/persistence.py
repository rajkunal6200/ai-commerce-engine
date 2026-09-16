import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

PERSISTENCE_LOGS_FILE = Path(os.environ.get("PERSISTENCE_LOGS_FILE", "persistence_logs.json"))


def atomic_write_json(file_path: Path, data: Any) -> None:
    tmp_path = file_path.with_suffix(file_path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp_path.replace(file_path)


def load_logs() -> List[Dict[str, Any]]:
    if not PERSISTENCE_LOGS_FILE.exists():
        return []
    try:
        content = PERSISTENCE_LOGS_FILE.read_text(encoding="utf-8")
        return json.loads(content)
    except Exception:
        return []


def log_security_event(
    event_type: str,
    details: Dict[str, Any],
    buyer_id: Optional[str] = None
) -> Dict[str, Any]:
    logs = load_logs()
    event_record = {
        "timestamp": time.time(),
        "iso_timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "event_type": event_type,
        "buyer_id": buyer_id or "anonymous",
        "details": details
    }
    logs.append(event_record)
    atomic_write_json(PERSISTENCE_LOGS_FILE, logs)
    return event_record


def log_firewall_interception(
    buyer_id: str,
    input_valuation: float,
    current_floor: float,
    metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    details = {
        "action": "KILL_TEXT_PROCESSING_LOOP",
        "input_valuation": input_valuation,
        "current_floor": current_floor,
        "reason": f"Input valuation of ₹{input_valuation:.2f} INR is below authorized baseline floor of ₹{current_floor:.2f} INR",
        "pivoted_assets": ["BUNDLE_HP_MS", "BUNDLE_LAP_MS"],
        "telemetry": {
            "event": "MUTATION_BLOCKED",
            "input_valuation": input_valuation,
            "current_floor": current_floor,
            "timestamp": time.time()
        },
        **(metadata or {})
    }
    # Write MUTATION_BLOCKED record to persistence_logs.json
    log_security_event(event_type="MUTATION_BLOCKED", buyer_id=buyer_id, details=details)
    # Also record FIREWALL_INTERCEPTION for full quorum telemetry backwards compatibility
    return log_security_event(event_type="FIREWALL_INTERCEPTION", buyer_id=buyer_id, details=details)


def log_quorum_consensus(
    buyer_id: str,
    item_id: str,
    final_price_inr: float,
    votes: Dict[str, str],
    consensus_reached: bool
) -> Dict[str, Any]:
    return log_security_event(
        event_type="QUORUM_CONSENSUS",
        buyer_id=buyer_id,
        details={
            "item_id": item_id,
            "final_price_inr": final_price_inr,
            "votes": votes,
            "consensus_reached": consensus_reached,
            "quorum_ratio": f"{sum(1 for v in votes.values() if v == 'APPROVED')}/{len(votes)}"
        }
    )
