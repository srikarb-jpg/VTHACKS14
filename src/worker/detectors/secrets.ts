/**
 * API keys, tokens and private keys. High tier: these auto-redact, so every
 * pattern here must be shaped tightly enough that a false positive is rare.
 *
 * Prefer vendor-specific prefixes over generic entropy checks. "Long random
 * string" catches base64 image data and git hashes; "sk-ant-" catches an
 * Anthropic key and nothing else.
 */
import type { Finding } from '../../shared/types';

interface SecretRule {
  pattern: RegExp;
  label: string;
  detector: string;
}

const RULES: SecretRule[] = [
  { pattern: /sk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{40,}/g, label: 'Anthropic API key', detector: 'secrets.anthropic' },
  { pattern: /sk-proj-[A-Za-z0-9_-]{40,}/g, label: 'OpenAI project key', detector: 'secrets.openai_proj' },
  { pattern: /sk-[A-Za-z0-9]{32,}/g, label: 'OpenAI API key', detector: 'secrets.openai' },
  { pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g, label: 'GitHub token', detector: 'secrets.github' },
  { pattern: /AKIA[0-9A-Z]{16}/g, label: 'AWS access key ID', detector: 'secrets.aws_akid' },
  { pattern: /ASIA[0-9A-Z]{16}/g, label: 'AWS temporary key ID', detector: 'secrets.aws_asia' },
  { pattern: /AIza[0-9A-Za-z_-]{35}/g, label: 'Google API key', detector: 'secrets.google' },
  { pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/g, label: 'Slack token', detector: 'secrets.slack' },
  { pattern: /(?:r8_|hf_)[A-Za-z0-9]{32,}/g, label: 'Model host token', detector: 'secrets.modelhost' },
  { pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, label: 'JWT', detector: 'secrets.jwt' },
  {
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/g,
    label: 'Private key block',
    detector: 'secrets.private_key',
  },
  {
    // Assignment shape: catches `api_key = "..."` for vendors we do not know.
    pattern: /(?:api[_-]?key|secret|passwd|password|token|bearer)\s*[:=]\s*["']([A-Za-z0-9_\-./+@:]{16,})["']/gi,
    label: 'Credential assignment',
    detector: 'secrets.assignment',
  },
];

function kindFor(detector: string): 'api_key' | 'private_key' | 'jwt' {
  if (detector === 'secrets.jwt') return 'jwt';
  if (detector === 'secrets.private_key') return 'private_key';
  return 'api_key';
}

export function detectSecrets(text: string): Finding[] {
  const findings: Finding[] = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (const m of text.matchAll(rule.pattern)) {
      if (m.index === undefined) continue;
      // For the assignment shape, redact only the captured value, not the
      // whole `api_key = "..."` expression -- the user still wants the code
      // to read sensibly on the other side.
      const whole = m[0];
      const capture = m[1];
      const value = capture ?? whole;
      const start = capture === undefined ? m.index : m.index + whole.indexOf(capture);
      findings.push({
        kind: kindFor(rule.detector),
        severity: 'high',
        label: rule.label,
        start,
        end: start + value.length,
        value,
        detector: rule.detector,
      });
    }
  }
  return findings;
}
