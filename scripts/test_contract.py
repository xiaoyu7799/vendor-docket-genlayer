"""Exercise contract state transitions with injected SDK and registry results."""
from pathlib import Path
from types import SimpleNamespace
import json
import unittest


class UserError(Exception):
    pass


class Contract:
    pass


class Registry:
    status = 200
    registration = "ISSUED"
    disagree = False
    last_url = None

    @classmethod
    def get(cls, url):
        cls.last_url = url
        record = {
            "lei": url.split("/")[-1],
            "entity": {"status": "ACTIVE", "legalName": {"name": "Example Supply"}},
            "registration": {"status": cls.registration, "lastUpdateDate": "2026-10-01"},
        }
        return SimpleNamespace(
            status=cls.status,
            body=json.dumps({"data": {"attributes": record}}).encode(),
        )

    @classmethod
    def strict_eq(cls, fetch):
        value = fetch()
        if cls.disagree:
            raise UserError("VALIDATOR_DISAGREEMENT")
        return value


def decorator(value):
    return value


gl = SimpleNamespace(
    Contract=Contract,
    message=SimpleNamespace(sender_address="buyer"),
    vm=SimpleNamespace(UserError=UserError),
    public=SimpleNamespace(write=decorator, view=decorator),
    nondet=SimpleNamespace(web=Registry),
    eq_principle=Registry,
)
source = Path(__file__).resolve().parents[1] / "contracts/vendor_docket.py"
scope = dict(gl=gl, allow_storage=decorator, Address=str, u256=int, TreeMap=dict, __name__=__name__)
exec(compile(source.read_text().replace("from genlayer import *\n", ""), str(source), "exec"), scope)
VendorDocket = scope["VendorDocket"]


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        Registry.status, Registry.registration, Registry.disagree = 200, "ISSUED", False
        self.docket = VendorDocket()
        self.docket.trials, self.docket.invitations = {}, {}
        self.as_wallet("buyer")
        self.docket.open_trial("Test order")
        self.docket.invite(1, "supplier", "5493001KJTIIGC8Y1R12")
        self.as_wallet("supplier")

    def as_wallet(self, wallet):
        gl.message.sender_address = wallet

    def test_award_requires_cleared_supplier_and_is_one_time(self):
        self.assertEqual(self.docket.review_invitation(1, 1), "CLEARED")
        self.as_wallet("buyer")
        with self.assertRaisesRegex(UserError, "CLEARED_SUPPLIER_REQUIRED"):
            self.docket.accept(1, 1)
        self.as_wallet("supplier")
        self.assertEqual(self.docket.accept(1, 1), "VD-1-1")
        with self.assertRaisesRegex(UserError, "CLEARED_SUPPLIER_REQUIRED"):
            self.docket.accept(1, 1)

    def test_lapsed_and_absent_records_release_slot(self):
        for status, registration, decision in [(200, "LAPSED", "BLOCKED"), (404, "", "NOT_FOUND")]:
            with self.subTest(decision=decision):
                self.setUp()
                Registry.status = status
                Registry.registration = registration
                self.assertEqual(self.docket.review_invitation(1, 1), decision)
                self.assertEqual(self.docket.get_trial(1)["status"], "OPEN")
                self.assertEqual(self.docket.get_trial(1)["work_order"], "")
                with self.assertRaisesRegex(UserError, "CLEARED_SUPPLIER_REQUIRED"):
                    self.docket.accept(1, 1)

    def test_unavailable_incomplete_and_divergent_sources_preserve_invitation(self):
        for status, registration, disagree, error in [
            (503, "ISSUED", False, "GLEIF_UNAVAILABLE"),
            (200, "", False, "INCOMPLETE_RECORD"),
            (200, "ISSUED", True, "VALIDATOR_DISAGREEMENT"),
        ]:
            with self.subTest(error=error):
                Registry.status, Registry.registration, Registry.disagree = status, registration, disagree
                before = (self.docket.get_trial(1), self.docket.get_invitation(1, 1))
                with self.assertRaisesRegex(UserError, error):
                    self.docket.review_invitation(1, 1)
                self.assertEqual((self.docket.get_trial(1), self.docket.get_invitation(1, 1)), before)

    def test_stale_action_cannot_apply_to_replacement_invitation(self):
        self.as_wallet("buyer")
        self.docket.withdraw(1, 1)
        self.docket.invite(1, "supplier", "353800SZHNPYLZTIX835")
        self.as_wallet("supplier")
        with self.assertRaisesRegex(UserError, "INVITATION_CHANGED"):
            self.docket.review_invitation(1, 1)
        self.assertEqual(self.docket.get_invitation(1, 1)["decision"], "WITHDRAWN")
        self.assertEqual(self.docket.get_invitation(1, 2)["decision"], "PENDING")


if __name__ == "__main__":
    unittest.main()
