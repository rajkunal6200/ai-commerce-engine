from pathlib import Path

import json

import main
from models.audit import AuditEvent


def test_intents_persist_and_reload(tmp_path, monkeypatch):
    intents_file = tmp_path / "intents.json"

    monkeypatch.setattr(main, "INTENTS_FILE", intents_file)

    intent_id = "test-intent-001"

    main.intents.clear()
    main.intents[intent_id] = {
        "intent": {
            "merchant": "Amazon",
            "purpose": "Buy SoundMax Headphones",
            "max_amount": 5000,
            "currency": "INR",
            "user_approval_required": True
        },
        "policy": {
            "allowed": True,
            "reason": "Policy check passed."
        },
        "approved": False,
        "status": "intent_created",
        "payment": None,
        "execution_count": 0
    }

    main.save_intents()

    assert intents_file.exists()

    saved_data = json.loads(intents_file.read_text())

    assert intent_id in saved_data
    assert saved_data[intent_id]["status"] == "intent_created"

    reloaded = json.loads(intents_file.read_text())

    assert reloaded[intent_id]["intent"]["merchant"] == "Amazon"
    assert reloaded[intent_id]["intent"]["max_amount"] == 5000
    assert reloaded[intent_id]["execution_count"] == 0


def test_audit_logs_persist_and_reload(tmp_path, monkeypatch):
    audit_file = tmp_path / "audit_logs.json"

    monkeypatch.setattr(main, "AUDIT_LOGS_FILE", audit_file)

    event = AuditEvent(
        intent_id="test-intent-001",
        event="intent_created",
        status="success",
        reason="Test audit event."
    )

    main.audit_logs.clear()
    main.audit_logs.append(event)

    main.save_audit_logs()

    assert audit_file.exists()

    saved_data = json.loads(audit_file.read_text())

    assert len(saved_data) == 1
    assert saved_data[0]["intent_id"] == "test-intent-001"
    assert saved_data[0]["event"] == "intent_created"
    assert saved_data[0]["status"] == "success"
    assert saved_data[0]["reason"] == "Test audit event."

    reloaded = main.load_audit_logs()

    assert len(reloaded) == 1
    assert isinstance(reloaded[0], AuditEvent)
    assert reloaded[0].intent_id == "test-intent-001"
    assert reloaded[0].event == "intent_created"


def test_atomic_write_failure_preserves_existing_file(tmp_path, monkeypatch):
    target = tmp_path / "intents.json"

    original_data = {
        "existing-intent": {
            "status": "intent_created"
        }
    }

    target.write_text(json.dumps(original_data, indent=2))

    def failing_write_text(self, *args, **kwargs):
        raise OSError("simulated disk write failure")

    monkeypatch.setattr(Path, "write_text", failing_write_text)

    try:
        main.atomic_write_json(
            target,
            {"new-intent": {"status": "changed"}}
        )
    except OSError:
        pass

    saved_data = json.loads(target.read_text())

    assert saved_data == original_data
    assert not (tmp_path / "intents.json.tmp").exists()
