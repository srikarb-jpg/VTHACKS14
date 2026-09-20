import type { Finding, FindingKind } from '../shared/types';

const HEADING_WORD = 'profile|summary|objective|experience|work|professional|employment|internships?|technical|skills|education|academic|background|projects?|personal|research|leadership|activities|extracurricular|honors|awards|certifications?|certificates|publications|volunteer(?:ing)?|interests|languages|coursework|relevant|additional|references|history|involvement|achievements|qualifications|highlights|competencies|tools|technologies|and|of';
/** "EXPERIENCE", "Technical Skills", "Projects & Research": document structure, not personal data. */
export const SECTION_HEADING = new RegExp(String.raw`^(?:${HEADING_WORD})(?:[ \t]*[&/,]?[ \t]*(?:${HEADING_WORD})){0,3}[ \t]*:?$`, 'i');
const DEGREE_LINE = /^(?:B\.?\s?S|B\.?\s?A|M\.?\s?S|M\.?\s?A|B\.?\s?Eng|M\.?\s?Eng|M\.?B\.?A|Ph\.?\s?D|BSc|MSc|A\.?\s?A|A\.?\s?S)\.?(?=[\s,]|$)/;

/** Drop name, organization and place findings that are only a section heading. Applied to the
 * model's output as well, which sometimes tags a capitalised heading as an organization. */
export function withoutHeadings(findings: Finding[]): Finding[] {
  return findings.filter((f) => !((f.kind === 'person' || f.kind === 'organization' || f.kind === 'location') && SECTION_HEADING.test(f.value.trim())));
}

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
      // Small-caps and title-case headings ("Experience", "Technical Skills") end the section too.
      if (education && (/^[A-Z][A-Z &/\-]{2,}:?$/.test(line.text) || SECTION_HEADING.test(line.text))) { education = false; continue; }
      if (!education) continue;
      // Institution title lines, including names without a "School" suffix.
      // Exclude bullets and degree/course metadata.
      const title = line.text.split(/\t|,|\s[–—|]\s/)[0]!.trim();
      if (title.length < 3 || title.length > 90 || !/^[\p{Lu}]/u.test(title) || /[\d:•▪]/.test(title) || DEGREE_LINE.test(title) || SECTION_HEADING.test(title) ||
          /\b(?:Major|Minor|Degree|Diploma|Bachelor|Master|Doctor|GPA|Honors|Course|Courses|Graduation|Placement|Placements|Languages)\b/i.test(title)) continue;
      if (/^[\p{L}'’.&-]+(?:[ \t]+[\p{L}'’.&-]+){1,9}$/u.test(title)) {
        seeds.push({ value: title, kind: 'organization', label: 'Education institution' });
      }
    }
  }
  // Complete US locality line, including ZIP+4. The street detector alone
  // intentionally ends before this part of an address.
  const STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
  const locality = new RegExp(String.raw`\b[\p{Lu}][\p{L}'’.-]*(?:[ \t]+[\p{Lu}][\p{L}'’.-]*){0,4},[ \t]*(?:${STATES})[ \t]+\d{5}(?:-\d{4})?\b`, 'gu');
  for (const m of text.matchAll(locality)) add(m.index, m.index + m[0].length, 'location', 'City, state and ZIP');
  // "Dearborn, MI" without a ZIP is how resumes usually give a job or school
  // location. Two-letter states collide with words (OR, IN, ME), so require
  // a line end, separator, or date after it. Multi-word cities start with a
  // known prefix so a job title before the city is not swallowed.
  const CITY_PREFIX = 'New|San|Los|Las|Fort|Ft|Saint|St|Mount|Mt|Port|Santa|Salt|Ann|Des|El|Baton|Grand|Palm|Long|Cape|Lake|North|South|East|West|Kansas|Oklahoma|Little|Corpus|Colorado|Sioux|Green|Falls|Cedar|Chapel|Myrtle|Jersey|Rio|Boca|Rock|Panama|Overland|Bowling|Pearl|Silver|Virginia|Wilkes|Palo|Mountain|Newport|Huntington|Coral|Daly|Simi|Thousand|Rancho|Hilton|Cherry|Council|Iowa|Jefferson|Johnson|Michigan|Oak|Park|Sandy|Sun|West Palm|Winter|Chula|College|Grand|Lees|Fond|Eau|Coeur';
  const cityState = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:(?:${CITY_PREFIX})\.?[ \t]+(?:[\p{Lu}][\p{L}'’.-]*[ \t]+)?)?[\p{Lu}][\p{L}'’.-]*,[ \t]*(?:${STATES})(?![\p{L}\p{N}])(?=[ \t]*(?:$|[|•·–—,;.)\]/]|(?:19|20)\d\d\b|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b|Present\b|Current\b))`, 'gmu');
  for (const m of text.matchAll(cityState)) add(m.index, m.index + m[0].length, 'location', 'City and state');
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
