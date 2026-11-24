# Vendor Docket

[Open the official Vendor Docket website](https://xiaoyu7799.github.io/vendor-docket-genlayer/)

Vendor Docket is a supplier trial desk for buyers who require a current Legal Entity Identifier (LEI) registration before assigning pilot work. The buyer records the trial brief and invites a known supplier wallet. The invited wallet requests independent review against the Global Legal Entity Identifier Foundation (GLEIF) public register. A successful review grants that wallet the right to accept the trial and receive an on-chain work-order identifier. A blocked review records its evidence and returns the slot to the buyer.

## Workflow

| State | Authorized action | Result |
| --- | --- | --- |
| Open | Buyer invites one supplier wallet and supplies its LEI | The trial slot is reserved |
| Invited | Invited supplier requests review | Validators independently fetch the pinned GLEIF endpoint and agree on the normalized registry record |
| Invited or cleared | Buyer withdraws the invitation | The trial slot reopens and invitation history is retained |
| Cleared | The invited supplier accepts the same invitation revision | The trial is awarded and the contract issues a work-order identifier |
| Blocked or record absent | Buyer can issue a new invitation | The previous wallet cannot accept the blocked invitation |

The rule requires both `ISSUED` registration and `ACTIVE` entity status. The contract uses a fixed HTTPS source and validates the LEI checksum before fetching. Validators agree on the same decision, legal name, registration status, entity status and source record update time. A failed fetch or validator disagreement does not grant an award. Invitation revision arguments prevent a pending action from landing against a replacement invitation.

GLEIF is the registry of record used for this pilot policy. The buyer links a wallet to its own contact through the invitation. LEI status is a point-in-time observation and does not establish wallet ownership, commercial suitability, or independent compliance clearance. The trial has no escrow or payment. Use synthetic briefs and keep private procurement information off the public chain.

## Run locally

Use Node.js 24 and run `npm ci` followed by `npm run dev`. `npm run build` creates the static site. Browser-generated test wallets are session-only and can be funded with test GEN through Studionet. The only supported network is Stable Studionet (61999).

The protocol uses GenLayerJS 2.0.0 because the Stable Studionet RPC requires fee-distribution data for new writes. The client estimates fees before signing and waits for finality before reading final contract state.

## Contract validation

```sh
python -m pip install genvm-linter==0.11.0
genvm-lint check contracts/vendor_docket.py
sha256sum contracts/vendor_docket.py
```

The runner is pinned in the first line of the contract. The site uses `deployment.json` for the contract address and recorded receipts.

## Reproducible checks

Run `python scripts/test_contract.py` for state-machine and registry-adapter tests with controlled failure inputs. Those tests cover missing records, interrupted or incomplete responses, disagreement, duplicate acceptance, and stale invitation numbers. They do not replace Studionet receipts.

`npm run verify` independently checks recorded transaction finality and execution, compares the exact deployed source with the repository file, and reads both final demo records using `latest-final`. `npm run verify:live` creates a separate Stable Studionet deployment and executes the scenario using distinct test signers. Keep its generated test keys and journal outside the repository. Rerunning with the same journal resumes the existing transactions. Run `npm run verify:live -- --existing` to exercise invitation revision boundaries against the published Studionet contract. This mode opens a separate test trial and journals its receipts independently.

Earlier deployment addresses and their observed receipts are preserved in [release history](release-history.json).

## Live examples

- [Trial 1](https://xiaoyu7799.github.io/vendor-docket-genlayer/?trial=1) assigns pilot work order `VD-1-1` after a cleared registration. An uninvited wallet and a duplicate acceptance are rejected.
- [Trial 2](https://xiaoyu7799.github.io/vendor-docket-genlayer/?trial=2) releases the slot after a lapsed registration. A follow-up invitation reuses the slot, and its independent review also blocks the lapsed LEI. Writes against the superseded invitation revision are rejected.
- [Trial 3](https://xiaoyu7799.github.io/vendor-docket-genlayer/?trial=3) was opened by an in-browser session wallet after a Studionet faucet transfer. Its receipt and final trial record are included in the evidence.

[Trial 4](https://xiaoyu7799.github.io/vendor-docket-genlayer/?trial=4) demonstrates the full website workflow using two Studionet session wallets. The buyer opened the trial and invited the supplier, then the supplier passed the GLEIF check and accepted work order `VD-4-1`. The four receipts and recorded readbacks are in [deployment.json](deployment.json).
