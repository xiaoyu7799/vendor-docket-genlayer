# Vendor Docket

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
