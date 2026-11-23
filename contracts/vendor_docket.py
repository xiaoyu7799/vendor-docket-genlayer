# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json
from dataclasses import dataclass


@allow_storage
@dataclass
class Trial:
    buyer: Address
    supplier: Address
    brief: str
    current: u256
    status: str


@allow_storage
@dataclass
class Invitation:
    supplier: Address
    lei: str
    decision: str
    legal_name: str
    registration: str
    entity: str
    updated: str


def observe(lei: str) -> list[str]:
    url = "https://api.gleif.org/api/v1/lei-records/" + lei
    response = gl.nondet.web.get(url)
    if response.status == 404:
        return ["NOT_FOUND", "", "", "", ""]
    if response.status != 200 or response.body is None:
        raise gl.vm.UserError("GLEIF_UNAVAILABLE")
    record = json.loads(response.body.decode("utf-8"))["data"]["attributes"]
    if record["lei"] != lei:
        raise gl.vm.UserError("RECORD_ID_MISMATCH")
    legal_name = record["entity"]["legalName"]["name"]
    entity = record["entity"]["status"]
    registration = record["registration"]["status"]
    updated = record["registration"]["lastUpdateDate"]
    if any(not isinstance(field, str) or not field for field in
           [legal_name, entity, registration, updated]):
        raise gl.vm.UserError("INCOMPLETE_RECORD")
    decision = "CLEARED" if registration == "ISSUED" and entity == "ACTIVE" else "BLOCKED"
    return [decision, legal_name, registration, entity, updated]


def check_lei(lei: str) -> None:
    if len(lei) != 20 or not lei[-2:].isdigit():
        raise gl.vm.UserError("INVALID_LEI")
    remainder = 0
    for char in lei:
        if "0" <= char <= "9":
            remainder = (remainder * 10 + ord(char) - ord("0")) % 97
        elif "A" <= char <= "Z":
            remainder = (remainder * 100 + ord(char) - ord("A") + 10) % 97
        else:
            raise gl.vm.UserError("INVALID_LEI")
    if remainder != 1:
        raise gl.vm.UserError("INVALID_LEI_CHECKSUM")


class VendorDocket(gl.Contract):
    trials: TreeMap[u256, Trial]
    invitations: TreeMap[str, Invitation]
    count: u256

    def __init__(self):
        self.count = u256(0)

    @gl.public.write
    def open_trial(self, brief: str) -> u256:
        brief = brief.strip()
        if not brief or len(brief) > 280:
            raise gl.vm.UserError("INVALID_BRIEF")
        self.count += u256(1)
        buyer = gl.message.sender_address
        self.trials[self.count] = Trial(buyer, buyer, brief, u256(0), "OPEN")
        return self.count

    @gl.public.write
    def invite(self, trial_id: u256, supplier: Address, lei: str) -> None:
        trial = self.trials[trial_id]
        if gl.message.sender_address != trial.buyer:
            raise gl.vm.UserError("BUYER_ONLY")
        if trial.status != "OPEN":
            raise gl.vm.UserError("SLOT_UNAVAILABLE")
        if supplier == trial.buyer or supplier == Address("0x" + "0" * 40):
            raise gl.vm.UserError("DISTINCT_SUPPLIER_REQUIRED")
        check_lei(lei)
        trial.current += u256(1)
        trial.supplier = supplier
        trial.status = "INVITED"
        key = str(trial_id) + ":" + str(trial.current)
        self.invitations[key] = Invitation(supplier, lei, "PENDING", "", "", "", "")

    @gl.public.write
    def review_invitation(self, trial_id: u256, expected: u256) -> str:
        trial = self.trials[trial_id]
        if expected != trial.current:
            raise gl.vm.UserError("INVITATION_CHANGED")
        if trial.status != "INVITED" or gl.message.sender_address != trial.supplier:
            raise gl.vm.UserError("ACTIVE_SUPPLIER_INVITATION_REQUIRED")
        invitation = self.invitations[str(trial_id) + ":" + str(trial.current)]
        lei = invitation.lei
        def fetch_record() -> list[str]:
            return observe(lei)

        decision, name, registration, entity, updated = gl.eq_principle.strict_eq(fetch_record)
        invitation.decision = decision
        invitation.legal_name = name
        invitation.registration = registration
        invitation.entity = entity
        invitation.updated = updated
        trial.status = "CLEARED" if decision == "CLEARED" else "OPEN"
        return decision

    @gl.public.write
    def accept(self, trial_id: u256, expected: u256) -> str:
        trial = self.trials[trial_id]
        if expected != trial.current:
            raise gl.vm.UserError("INVITATION_CHANGED")
        if trial.status != "CLEARED" or gl.message.sender_address != trial.supplier:
            raise gl.vm.UserError("CLEARED_SUPPLIER_REQUIRED")
        trial.status = "AWARDED"
        return "VD-" + str(trial_id) + "-" + str(trial.current)

    @gl.public.write
    def withdraw(self, trial_id: u256, expected: u256) -> None:
        trial = self.trials[trial_id]
        if expected != trial.current:
            raise gl.vm.UserError("INVITATION_CHANGED")
        if gl.message.sender_address != trial.buyer:
            raise gl.vm.UserError("BUYER_ONLY")
        if trial.status not in ("INVITED", "CLEARED"):
            raise gl.vm.UserError("NO_WITHDRAWABLE_INVITATION")
        invitation = self.invitations[str(trial_id) + ":" + str(trial.current)]
        invitation.decision = "WITHDRAWN"
        trial.status = "OPEN"

    @gl.public.view
    def get_count(self) -> u256:
        return self.count

    @gl.public.view
    def get_trial(self, trial_id: u256) -> dict:
        trial = self.trials[trial_id]
        return {
            "buyer": str(trial.buyer), "supplier": str(trial.supplier), "brief": trial.brief,
            "current": int(trial.current), "status": trial.status,
            "work_order": ("VD-" + str(trial_id) + "-" + str(trial.current))
            if trial.status == "AWARDED" else "",
        }

    @gl.public.view
    def get_invitation(self, trial_id: u256, number: u256) -> dict:
        invitation = self.invitations[str(trial_id) + ":" + str(number)]
        return {
            "supplier": str(invitation.supplier), "lei": invitation.lei,
            "decision": invitation.decision, "legal_name": invitation.legal_name,
            "registration": invitation.registration, "entity": invitation.entity,
            "updated": invitation.updated,
        }
