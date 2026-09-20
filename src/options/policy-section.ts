/**
 * Import a policy: paste the JSON an assistant wrote from a description of your
 * organization's sensitive formats. Rules are patterns; the extension enforces
 * them on this device. Includes a tester so you can see what a rule matches
 * before trusting it, because a wrong pattern silently rewrites prompts.
 */
import { h } from '../shared/dom';
import { sendToBackground } from '../shared/messages';
import { POLICY_ASSISTANT_INSTRUCTIONS, compileRules, parsePolicy, type Policy } from '../shared/policy';
import type { Settings } from '../shared/types';
import { detectCustom } from '../worker/detectors/custom';

export function policySection(settings: Settings): HTMLElement {
  let saved: Policy | null = settings.policy;
  let draft: Policy | null = null;

  const status = h('p', { class: 'note', role: 'status' });
  const say = (msg: string, ok = true): void => {
    status.textContent = msg;
    status.style.color = ok ? '' : '#b42318';
  };

  const errors = h('ul', { class: 'note', style: 'color:#b42318;margin:8px 0 0 18px' });
  const rules = h('div', {});
  const paste = h('textarea', {
    rows: '8',
    'aria-label': 'Policy JSON',
    placeholder: 'Paste the JSON your assistant returned…',
    style: 'width:100%;font:12px ui-monospace,monospace;padding:10px;border-radius:10px;border:1px solid #ddd3fa',
  });
  const sample = h('textarea', {
    rows: '3',
    'aria-label': 'Sample text to test the rules against',
    placeholder: 'Type or paste made-up sample text to see what the rules match…',
    style: 'width:100%;font:13px system-ui;padding:10px;border-radius:10px;border:1px solid #ddd3fa',
  });
  const matches = h('div', { class: 'note' });

  const active = (): Policy | null => draft ?? saved;

  const drawRules = (): void => {
    const p = active();
    rules.replaceChildren(
      ...(p
        ? [
            h('p', { class: 'sub' }, draft ? 'Checked, not saved yet:' : `Active${p.name ? `: ${p.name}` : ''}`),
            ...p.rules.map((r) =>
              h(
                'div',
                { class: 'kv' },
                h('span', {}, `${r.name} · ${r.severity ?? 'medium'}`),
                h('strong', { style: 'font:12px ui-monospace,monospace' }, r.pattern),
              ),
            ),
          ]
        : [h('p', { class: 'sub' }, 'No policy set.')]),
    );
  };

  const drawMatches = (): void => {
    const text = sample.value;
    const found = detectCustom(text, compileRules(active()));
    matches.replaceChildren(
      !text.trim()
        ? 'Matches appear here.'
        : found.length
          ? `${found.length} match${found.length === 1 ? '' : 'es'}: ` + found.map((f) => `“${f.value}” (${f.label})`).join(', ')
          : 'No matches.',
    );
  };
  sample.addEventListener('input', drawMatches);

  const check = h('button', { type: 'button', class: 'btn' }, 'Check');
  check.addEventListener('click', () => {
    const result = parsePolicy(paste.value);
    errors.replaceChildren();
    if (!result.ok) {
      draft = null;
      errors.replaceChildren(...result.errors.map((e) => h('li', {}, e)));
      say('Not accepted. Nothing was changed.', false);
    } else {
      draft = result.policy;
      say(`${result.policy.rules.length} rule${result.policy.rules.length === 1 ? '' : 's'} accepted. Test them below, then save.`);
    }
    drawRules();
    drawMatches();
  });

  const save = h('button', { type: 'button', class: 'btn' }, 'Save policy');
  save.addEventListener('click', () => {
    if (!draft) {
      say('Check the policy first.', false);
      return;
    }
    const next = draft;
    void sendToBackground({ type: 'settings:set', patch: { policy: next } }).then(() => {
      saved = next;
      draft = null;
      paste.value = '';
      say('Saved. Open chat tabs pick it up immediately.');
      drawRules();
      drawMatches();
    });
  });

  const clear = h('button', { type: 'button', class: 'btn ghost' }, 'Remove policy');
  clear.addEventListener('click', () => {
    void sendToBackground({ type: 'settings:set', patch: { policy: null } }).then(() => {
      saved = null;
      draft = null;
      say('Policy removed.');
      drawRules();
      drawMatches();
    });
  });

  const copy = h('button', { type: 'button', class: 'btn ghost' }, 'Copy assistant instructions');
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(POLICY_ASSISTANT_INSTRUCTIONS).then(
      () => say('Copied. Paste it into any assistant, then describe your formats.'),
      () => say('Could not copy.', false),
    );
  });

  drawRules();
  drawMatches();

  return h(
    'section',
    { class: 'block' },
    h('h2', {}, 'Your policy'),
    h(
      'p',
      { class: 'sub' },
      'Describe your organization’s sensitive formats to an AI assistant (for example, how contract numbers look), paste the JSON it returns, and Prompt Firewall enforces it on this device. Rules are patterns only. Describe formats with made-up examples, never real data.',
    ),
    h('div', { class: 'card' }, h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px' }, copy), paste, h('div', { style: 'display:flex;gap:10px;margin-top:10px' }, check, save, clear), errors, status, rules),
    h('div', { class: 'card', style: 'margin-top:16px' }, h('h2', {}, 'Try it'), sample, matches),
  );
}
