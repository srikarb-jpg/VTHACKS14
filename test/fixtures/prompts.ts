/**
 * The labelled evaluation set.
 *
 * This doubles as the unit-test corpus and as the source of the precision
 * number that goes on the slide, so treat it as a deliverable rather than as
 * scaffolding. Grow it to ~50 cases; every false positive we hit while
 * dogfooding should land here as a `negative`.
 *
 * All secrets below are syntactically valid but fabricated.
 */
import type { FindingKind } from '../../src/shared/types';

export interface Case {
  name: string;
  text: string;
  /** Kinds we require the scanner to find. */
  expect: FindingKind[];
  /** Kinds that must NOT fire. Guards against known false positives. */
  forbid?: FindingKind[];
}

export const POSITIVES: Case[] = [
  {
    name: 'support ticket with name, email and API key (the demo prompt)',
    text: `Can you help me debug this? Customer Dana Whitfield (dana.whitfield@northlake-health.org, 540-555-0142) says the sync fails. Our key is sk-ant-api03-Xq7Rm2LpVn4Tz8Kw1Yb6Jd3Hs5Gf9Cc0Ae2Bi4Nu7Ok1Pl8Qm3Rt6Uv9Wx2Zy5A and the call 500s.`,
    expect: ['email', 'phone', 'api_key'],
  },
  {
    name: 'AWS key in a config paste',
    text: 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nregion=us-east-1',
    expect: ['api_key'],
  },
  {
    name: 'GitHub token',
    text: 'my token is ghp_16C7e42F292c6912E7710c838347Ae178B4a and it stopped working',
    expect: ['api_key'],
  },
  {
    name: 'JWT in an auth header',
    text: 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQ7vT3sKp2mNj5Lf8Hb1Ra6Yz0Uc9Ie4Xo',
    expect: ['jwt'],
  },
  {
    name: 'valid card number passes Luhn',
    text: 'The card on file is 4111 1111 1111 1111, expiry 04/27.',
    expect: ['credit_card'],
  },
  {
    name: 'plausible SSN',
    text: 'Employee SSN 536-22-4891 needs correcting in the HR record.',
    expect: ['ssn'],
  },
  {
    name: 'private key block',
    text: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA3Zf9xQ==\n-----END RSA PRIVATE KEY-----',
    expect: ['private_key'],
  },
  {
    name: 'CUI banner line',
    text: 'CONTROLLED UNCLASSIFIED INFORMATION\n\nSummarize the findings in section 3 for me.',
    expect: ['classification_marking'],
  },
  {
    name: 'portion marking with dissemination control',
    text: '(U//FOUO) The vendor assessment concluded the integration is feasible.',
    expect: ['classification_marking'],
  },
  {
    name: 'export control statement',
    text: 'This design data is ITAR-controlled. Rewrite the summary paragraph.',
    expect: ['classification_marking'],
  },
  {
    name: 'street address and DOB',
    text: 'Patient lives at 1425 Maple Avenue, DOB: 03/14/1978.',
    expect: ['street_address', 'date_of_birth'],
  },
];

/**
 * Cases that must stay clean. These are the ones that decide whether the
 * extension is usable: every entry here is a send we must not interrupt.
 */
export const NEGATIVES: Case[] = [
  {
    name: 'ordinary prose containing the word controlled',
    text: 'The experiment used a controlled environment with a control group.',
    expect: [],
    forbid: ['classification_marking'],
  },
  {
    name: 'export controlled as casual prose, not a marking',
    text: 'Is this library export restricted in any way? I want to check before shipping.',
    expect: [],
    forbid: ['classification_marking'],
  },
  {
    name: 'invalid card number fails Luhn',
    text: 'Try order number 1234 5678 9012 3456 in the admin panel.',
    expect: [],
    forbid: ['credit_card'],
  },
  {
    name: 'placeholder SSN is rejected',
    text: 'Use 123-45-6789 as the example value in the docs.',
    expect: [],
    forbid: ['ssn'],
  },
  {
    name: 'git hash is not a secret',
    text: 'Revert to commit 9f2a1c4e8b7d6035a2f1e9c8b7d6a5f4e3c2b1a0 please.',
    expect: [],
    forbid: ['api_key', 'jwt'],
  },
  {
    name: 'unclassified portion marking alone does not block',
    text: '(U) This paragraph is unclassified.',
    expect: [],
    forbid: ['classification_marking'],
  },
  {
    name: 'semver and dates are not identifiers',
    text: 'We upgraded from 1.2.3 to 2.0.0 on 2025-03-14 without incident.',
    expect: [],
    forbid: ['ssn', 'credit_card', 'bank_account'],
  },
];
