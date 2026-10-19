"""Kill-switch tests; the Google client modules are stubbed, so no cloud call is made."""
import base64
import importlib
import json
import logging
import sys
import types

import pytest

PROJECT = "digitus2-scan"


class PermissionDenied(Exception):
    pass


class FakeBillingClient:
    def __init__(self, billing_enabled=True, denied=False):
        self.billing_enabled = billing_enabled
        self.denied = denied
        self.gets = []
        self.updates = []

    def get_project_billing_info(self, name):
        self.gets.append(name)
        return types.SimpleNamespace(billing_enabled=self.billing_enabled)

    def update_project_billing_info(self, name, project_billing_info):
        if self.denied:
            raise PermissionDenied("denied")
        self.updates.append((name, project_billing_info))
        return types.SimpleNamespace(billing_account_name="")


class FakeCloudLogger:
    def __init__(self):
        self.entries = []

    def log_text(self, text, severity=None):
        self.entries.append((severity, text))


@pytest.fixture
def main(monkeypatch):
    """Imports main.py fresh against stub google.cloud modules, removed again after the test."""
    cloud_logger = FakeCloudLogger()
    google = types.ModuleType("google")
    google.__path__ = []
    api_core = types.ModuleType("google.api_core")
    api_core.__path__ = []
    exceptions = types.ModuleType("google.api_core.exceptions")
    exceptions.PermissionDenied = PermissionDenied
    cloud = types.ModuleType("google.cloud")
    cloud.__path__ = []
    billing_v1 = types.ModuleType("google.cloud.billing_v1")
    billing_v1.CloudBillingClient = FakeBillingClient
    cloud_logging = types.ModuleType("google.cloud.logging")
    cloud_logging.Client = lambda: types.SimpleNamespace(logger=lambda name: cloud_logger)
    framework = types.ModuleType("functions_framework")
    framework.cloud_event = lambda function: function
    google.api_core, google.cloud = api_core, cloud
    api_core.exceptions = exceptions
    cloud.billing_v1, cloud.logging = billing_v1, cloud_logging
    for name, module in {
        "google": google,
        "google.api_core": api_core,
        "google.api_core.exceptions": exceptions,
        "google.cloud": cloud,
        "google.cloud.billing_v1": billing_v1,
        "google.cloud.logging": cloud_logging,
        "functions_framework": framework,
    }.items():
        monkeypatch.setitem(sys.modules, name, module)
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", PROJECT)
    monkeypatch.delenv("SIMULATE", raising=False)
    monkeypatch.delitem(sys.modules, "main", raising=False)
    module = importlib.import_module("main")
    module.cloud_logger_for_tests = cloud_logger
    yield module
    sys.modules.pop("main", None)


def event(cost, budget):
    data = json.dumps({"costAmount": cost, "budgetAmount": budget}).encode()
    return types.SimpleNamespace(data={"message": {"data": base64.b64encode(data).decode()}})


def use_client(monkeypatch, main, client):
    monkeypatch.setattr(main, "_client", lambda: client)
    return client


def test_decide_keeps_billing_under_the_budget(main):
    assert main.decide(4.0, 5.0, True) == "keep"


def test_decide_disables_at_the_budget(main):
    assert main.decide(5.0, 5.0, True) == "disable"


def test_decide_reports_already_disabled(main):
    assert main.decide(6.0, 5.0, False) == "already-disabled"


def test_decide_keeps_under_the_budget_whatever_the_billing_state(main):
    assert main.decide(4.0, 5.0, False) == "keep"


def test_simulation_is_the_default(main):
    assert main.SIMULATE is True


def test_simulation_logs_and_never_calls_the_api(monkeypatch, caplog, main):
    caplog.set_level(logging.INFO)
    client = use_client(monkeypatch, main, FakeBillingClient())
    monkeypatch.setattr(main, "SIMULATE", True)
    main.stop_billing(event(6, 5))
    assert client.updates == []
    assert "simulation" in caplog.text
    assert main.cloud_logger_for_tests.entries[0][0] == "CRITICAL"


def test_a_real_run_unlinks_the_billing_account(monkeypatch, main):
    client = use_client(monkeypatch, main, FakeBillingClient())
    monkeypatch.setattr(main, "SIMULATE", False)
    main.stop_billing(event(6, 5))
    assert client.gets == [f"projects/{PROJECT}"]
    assert client.updates == [(f"projects/{PROJECT}", {"billing_account_name": ""})]


def test_under_the_budget_nothing_is_read_or_changed(monkeypatch, main):
    client = use_client(monkeypatch, main, FakeBillingClient())
    monkeypatch.setattr(main, "SIMULATE", False)
    main.stop_billing(event(4, 5))
    assert client.gets == [] and client.updates == []


def test_an_unlinked_project_is_left_alone(monkeypatch, caplog, main):
    caplog.set_level(logging.INFO)
    client = use_client(monkeypatch, main, FakeBillingClient(billing_enabled=False))
    monkeypatch.setattr(main, "SIMULATE", False)
    main.stop_billing(event(6, 5))
    assert client.updates == []
    assert "already disabled" in caplog.text


def test_permission_denied_is_logged_not_raised(monkeypatch, caplog, main):
    caplog.set_level(logging.INFO)
    use_client(monkeypatch, main, FakeBillingClient(denied=True))
    monkeypatch.setattr(main, "SIMULATE", False)
    main.stop_billing(event(6, 5))
    assert "permission" in caplog.text.lower()


def test_simulate_false_in_the_environment_turns_simulation_off(monkeypatch, main):
    monkeypatch.setenv("SIMULATE", "False")
    sys.modules.pop("main")
    assert importlib.import_module("main").SIMULATE is False
