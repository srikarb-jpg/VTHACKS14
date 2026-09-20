# HokieAI Side Kick: the policy author

A personal agent built inside HokieAI that turns a plain-English description of
an organization's sensitive formats into a policy Deadbolt enforces
locally.

## The division of labour

- **HokieAI (authoring time):** turns "our contract numbers look like
  W15P7T-19-D-0042" into a validated pattern. It only ever sees a description of
  a FORMAT, using a made-up example. No real data.
- **The extension (every keystroke):** enforces the pattern on the user's own
  device. Deterministic, no network, no model.

Why patterns and not model labels: on the bench (`node scripts/ner-policy.mjs`)
the on-device model found 3-4 of 12 structured identifiers when given their
names as labels. Patterns found all of them.

## Setup

1. In HokieAI (VT login), create a personal agent named **Policy Author**.
2. Paste the instructions. Get them from the extension: Settings -> Your policy
   -> **Copy assistant instructions** (source: `POLICY_ASSISTANT_INSTRUCTIONS`
   in `src/shared/policy.ts`, so the agent and the validator cannot drift).
3. Describe your formats. Copy the JSON it returns.
4. Extension -> Settings -> Your policy -> paste -> **Check** -> try it on
   sample text -> **Save policy**.

The agent is not trusted. The extension re-validates everything: it refuses
lookarounds, backreferences, nested repeats, oversized patterns and any attempt
to block a send, and it re-checks stored rules on every load.

## Not decided (ask the organizers)

- Does an agent built inside HokieAI count as a "standalone HokieAI experience"?
- Where must the post live, and can judges open it without VT credentials?
