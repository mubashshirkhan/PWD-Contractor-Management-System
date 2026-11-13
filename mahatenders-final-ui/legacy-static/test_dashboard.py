import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parent


class DashboardWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script = (ROOT / "script.js").read_text(encoding="utf-8")
        cls.index = (ROOT / "index.html").read_text(encoding="utf-8")

    def test_captcha_controls_are_not_form_submit_controls(self):
        self.assertNotIn("<form", self.index.lower())
        self.assertIn('id="submitCaptcha" class="button button-secondary" type="button"', self.index)
        self.assertIn('id="cancelLocationSearch" class="button button-quiet" type="button"', self.index)

    def test_location_workflow_has_single_flight_guards(self):
        for name in ("locationStartInFlight", "captchaSubmitInFlight", "locationPollInFlight", "locationState"):
            self.assertIn(name, self.script)
        self.assertIn("event?.preventDefault()", self.script)
        self.assertIn("clearLocationPolling()", self.script)

    def test_document_reload_diagnostics_are_registered(self):
        for event_name in ("beforeunload", "pagehide", "pageshow", "DOMContentLoaded"):
            self.assertIn(f'"{event_name}"', self.script)
        self.assertIn("performance.getEntriesByType(\"navigation\")", self.script)
        self.assertIn("window.__mahaTendersDiagnostics", self.script)

    def test_request_trace_records_safe_metadata(self):
        for field in ("sequence", "timestamp", "endpoint", "method", "reference", "state", "responseStatus"):
            self.assertIn(field, self.script)
        self.assertIn("request.responseReference = body.reference || null", self.script)
        self.assertNotIn("captchaAnswer.value", self.script.split("function fetchJson", 1)[1].split("async function checkApiAnythingHealth", 1)[0])

    def test_captcha_submission_preserves_reference(self):
        section = self.script.split("async function submitCaptcha", 1)[1].split(
            "async function cancelLocationSearch", 1
        )[0]
        self.assertIn("locationReference", section)
        self.assertNotIn("locationReference = null", section)
        self.assertEqual(self.script.count('$("#submitCaptcha").addEventListener'), 1)

    def test_polling_is_scheduled_through_one_helper(self):
        self.assertEqual(len(re.findall(r"locationPoll\s*=\s*window\.setTimeout", self.script)), 1)
        self.assertIn("if (locationPollInFlight", self.script)


if __name__ == "__main__":
    unittest.main()
