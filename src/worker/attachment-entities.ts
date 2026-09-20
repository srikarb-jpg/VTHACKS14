import type { Finding, FindingKind } from '../shared/types';

/** Document-specific fallbacks. These do not change live composer policy.
 * Resume structure supplies evidence that a short header is a person's name
 * and that title lines in EDUCATION identify institutions.
 */
export function detectAttachmentEntities(text: string): Finding[] {
  const findings: Finding[] = [];
  const add = (start: number, end: number, kind: FindingKind, label: string) => {
    findings.push({ start, end, value: text.slice(start, end), kind, label, severity: 'medium', detector: `attachment.${kind}` });
  };
  const lines = [...text.matchAll(/[^\r\n]+/g)].map((m) => ({ text: m[0].trim(), start: m.index + m[0].indexOf(m[0].trim()) }));
  const isResume = lines.some((l) => /^(?:EDUCATION|ACADEMIC BACKGROUND)\s*:?$/i.test(l.text)) &&
    lines.some((l) => /^(?:PROFILE|SUMMARY|EXPERIENCE|WORK EXPERIENCE|INTERNSHIP|SKILLS|EMPLOYMENT|EXTRACURRICULAR ACTIVITIES)\s*:?$/i.test(l.text));
  const seeds: { value: string; kind: FindingKind; label: string }[] = [];
  if (isResume) {
    const header = lines.slice(0, 8);
    const candidate = header.find((l) => !/^(?:resume|curriculum vitae)$/i.test(l.text));
    const contactNearby = /@|\b\d{5}(?:-\d{4})?\b|\(\d{3}\)/.test(header.map((l) => l.text).join('\n'));
    const nameShape = /^[\p{Lu}][\p{L}'’.-]*(?:[ \t]+(?:[\p{Lu}][\p{L}'’.-]*|de|van|von|da|del)){1,4}$/u;
    if (candidate && contactNearby && nameShape.test(candidate.text) && !/\b(?:Resume|Profile|Summary|Experience|Education|Skills|Curriculum|Vitae|Engineer|Developer|Manager|University|College|School)\b/i.test(candidate.text)) {
      seeds.push({ value: candidate.text, kind: 'person', label: 'Resume header name' });
    }
    let education = false;
    for (const line of lines) {
      if (/^(?:EDUCATION|ACADEMIC BACKGROUND)\s*:?$/i.test(line.text)) { education = true; continue; }
      if (education && /^[A-Z][A-Z &/\-]{2,}:?$/.test(line.text)) { education = false; continue; }
      if (!education) continue;
      // Institution title lines, including names without a "School" suffix.
      // Exclude bullets and degree/course metadata.
      const title = line.text.split(/\t|,|\s[–—|]\s/)[0]!.trim();
      if (title.length < 3 || title.length > 90 || !/^[\p{Lu}]/u.test(title) || /[\d:•▪]/.test(title) ||
          /\b(?:Major|Minor|Degree|Diploma|Bachelor|Master|Doctor|GPA|Honors|Course|Courses|Graduation|Placement|Placements|Languages)\b/i.test(title)) continue;
      if (/^[\p{L}'’.&-]+(?:[ \t]+[\p{L}'’.&-]+){1,9}$/u.test(title)) {
        seeds.push({ value: title, kind: 'organization', label: 'Education institution' });
      }
    }
  }
  // Complete US locality line, including ZIP+4. The street detector alone
  // intentionally ends before this part of an address.
  const locality = /\b[\p{Lu}][\p{L}'’.-]*(?:[ \t]+[\p{Lu}][\p{L}'’.-]*){0,4},[ \t]*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)[ \t]+\d{5}(?:-\d{4})?\b/gu;
  for (const m of text.matchAll(locality)) add(m.index, m.index + m[0].length, 'location', 'City, state and ZIP');
  const school = /\b(?:[\p{Lu}][\p{L}'’.-]*[ \t]+){1,6}(?:High School|Secondary School|University|College|Institute(?: of Technology)?|Polytechnic|Tech)\b(?:[ \t]+of[ \t]+[\p{Lu}][\p{L}'’.-]*(?:[ \t]+[\p{Lu}][\p{L}'’.-]*){0,3})?/gu;
  for (const m of text.matchAll(school)) {
    if (/^[ \t]+(?:Diploma|Degree|Courses)\b/i.test(text.slice(m.index + m[0].length))) continue;
    seeds.push({ value: m[0], kind: 'organization', label: 'School or university' });
  }
  // A school or header name learned once must be removed from activity and
  // employment sections too. Match whole names, not parts of larger words.
  const uniqueSeeds = new Map(seeds.map((seed) => [`${seed.kind}:${seed.value.toLocaleLowerCase()}`, seed]));
  for (const seed of uniqueSeeds.values()) {
    const escaped = seed.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[ \t]+/g, '\\s+');
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu');
    for (const m of text.matchAll(pattern)) add(m.index, m.index + m[0].length, seed.kind, seed.label);
  }
  return findings;
}
