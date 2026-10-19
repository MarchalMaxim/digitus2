"""Billing kill-switch: unlinks the project from its billing account once the budget is reached.

Shaped on Google's sample, "Disable billing usage with notifications"
(https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications, Apache-2.0).
Three differences from the sample: the switch acts when the cost reaches the budget (the sample waits
until it exceeds it); simulation is read from the SIMULATE environment variable, on unless it is
"false", so the deploy script turns it off without editing code; and in simulation a billing state
that cannot be read is logged as a failed test, because a live run needs the same permission.

Unlinking billing stops every paid service in the project, the scan service included.
"""
import base64
import json
import logging
import os
import urllib.request

import functions_framework
from google.api_core import exceptions
from google.cloud import billing_v1
from google.cloud import logging as cloud_logging

SIMULATE = os.environ.get("SIMULATE", "true").lower() != "false"

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("stop-billing")

_billing_client = None


def _client():
    """The billing client, created on first use."""
    global _billing_client
    if _billing_client is None:
        _billing_client = billing_v1.CloudBillingClient()
    return _billing_client


def get_project_id() -> str:
    """The project id from GOOGLE_CLOUD_PROJECT, else from the metadata server."""
    project_id = os.getenv("GOOGLE_CLOUD_PROJECT")
    if project_id:
        return project_id
    url = "http://metadata.google.internal/computeMetadata/v1/project/project-id"
    request = urllib.request.Request(url, headers={"Metadata-Flavor": "Google"})
    with urllib.request.urlopen(request, timeout=10) as response:
        project_id = response.read().decode()
    if not project_id:
        raise ValueError("project-id metadata not found")
    return project_id


def decide(cost: float, budget: float, billing_enabled: bool) -> str:
    """"keep" under the budget, else "disable", or "already-disabled" when billing is off."""
    if cost < budget:
        return "keep"
    return "disable" if billing_enabled else "already-disabled"


@functions_framework.cloud_event
def stop_billing(cloud_event) -> None:
    """Pub/Sub budget notification handler."""
    project_name = f"projects/{get_project_id()}"
    event_data = base64.b64decode(cloud_event.data["message"]["data"]).decode("utf-8")
    event_dict = json.loads(event_data)
    cost_amount = float(event_dict["costAmount"])
    budget_amount = float(event_dict["budgetAmount"])
    log.info("Cost: %s Budget: %s", cost_amount, budget_amount)

    if decide(cost_amount, budget_amount, True) == "keep":
        log.info("No action required. Current cost is within budget.")
        return

    billing_enabled = _read_billing_enabled(project_name)
    if billing_enabled is None:
        if SIMULATE:
            log.error(
                "simulation test failed: the function cannot read the billing state of %s; "
                "grant its service account Browser and Project Billing Manager on the project.",
                project_name,
            )
            return
        billing_enabled = True  # Google's sample: act rather than stall
    action = decide(cost_amount, budget_amount, billing_enabled)
    if action == "already-disabled":
        log.info("Billing is already disabled for %s.", project_name)
        return
    _disable_billing_for_project(project_name, SIMULATE)


def _read_billing_enabled(project_name: str):
    """Whether billing is enabled, or None when the billing state cannot be read."""
    try:
        log.info("Getting billing info for %s...", project_name)
        return _client().get_project_billing_info(name=project_name).billing_enabled
    except Exception as error:  # noqa: BLE001 - reported; the caller decides
        log.error("Error getting billing info for %s: %s", project_name, error)
        return None


def _disable_billing_for_project(project_name: str, simulate: bool) -> None:
    """Unlinks the billing account, or only logs that it would in simulation."""
    logger = cloud_logging.Client().logger(name="disable-billing")
    if simulate:
        entry_text = f"Billing disabled for {project_name}. (simulation: nothing was changed)"
        log.warning(entry_text)
        logger.log_text(entry_text, severity="CRITICAL")
        return
    try:
        # An empty billing_account_name unlinks the project; see projects.updateBillingInfo.
        response = _client().update_project_billing_info(
            name=project_name,
            project_billing_info={"billing_account_name": ""},
        )
        entry_text = f"Billing disabled for {project_name}: {response}"
        log.warning(entry_text)
        logger.log_text(entry_text, severity="CRITICAL")
    except exceptions.PermissionDenied:
        log.error("Failed to disable billing for %s, check permissions.", project_name)
