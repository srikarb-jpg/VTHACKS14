import { describe, expect, it, vi } from 'vitest';
import { detectAttachmentEntities } from '../src/worker/attachment-entities';
import { detectAttachmentNames } from '../src/content/attachment-ner';
import { scrubAttachment } from '../src/content/attachments';

const resume = `Jordan Example
1069 Sample Grove Ct
Springfield, MO 63005
(202) 555-0147 jordan@example.com
PROFILE
Motivated student with hands-on experience.
EDUCATION
Northern Tech
Major: Computer Science
Expected Graduation Date: May 2028
Westhaven High School
High School Diploma – General Education
GPA: 3.92/4.0
Honors: Language Arts, Algebra, Biology
SKILLS
Programming, teamwork, customer service
EXTRACURRICULAR ACTIVITIES
Key Club, Outreach Chair, Westhaven High School, 2022–2025
Robotics Captain, Westhaven High School, 2022–2025`;

describe('attachment identity coverage', () => {
  it('redacts resume names, complete localities and every school occurrence without NER', async () => {
    const result = await scrubAttachment(new File([resume], 'resume.txt'));
    const redacted = await result.file.text();
    for (const value of ['Jordan Example', 'Springfield', 'MO 63005', 'Northern Tech', 'Westhaven High School']) {
      expect(redacted).not.toContain(value);
    }
    for (const safe of ['PROFILE', 'Major: Computer Science', 'GPA: 3.92/4.0', 'Programming, teamwork', 'High School Diploma']) expect(redacted).toContain(safe);
    const found = detectAttachmentEntities(resume);
    expect(found.filter((f) => f.value === 'Westhaven High School')).toHaveLength(3);
    for (const f of found) expect(resume.slice(f.start, f.end)).toBe(f.value);
  });

  it('uses structure rather than a hardcoded person or institution list', () => {
    const text = resume.replace('Jordan Example', 'Zoë O’Connor').replaceAll('Westhaven High School', 'Lakeside Academy').replace('Northern Tech', 'Eastbridge Conservatory');
    const found = detectAttachmentEntities(text);
    expect(found.some((f) => f.kind === 'person' && f.value === 'Zoë O’Connor')).toBe(true);
    expect(found.filter((f) => f.value === 'Lakeside Academy')).toHaveLength(3);
    expect(found.some((f) => f.value === 'Eastbridge Conservatory')).toBe(true);
  });
  it('redacts a repeated school name across a wrapped PDF line', async () => {
    const text = resume + '\nVolunteer, Westhaven High\nSchool, 2025';
    const result = await scrubAttachment(new File([text], 'wrapped.txt'));
    expect(await result.file.text()).not.toContain('Westhaven');
    expect(result.placeholders.some((p) => p.value === 'Westhaven High\nSchool')).toBe(true);
  });

  it('does not treat arbitrary document titles or degree lines as personal names', () => {
    expect(detectAttachmentEntities('Project Report\nteam@example.com\nQuarterly review.')).toEqual([]);
    const found = detectAttachmentEntities(resume.replace('Jordan Example', 'Software Engineer'));
    expect(found.some((f) => f.kind === 'person')).toBe(false);
    expect(found.some((f) => /Diploma|Major|GPA|Honors/.test(f.value))).toBe(false);
  });

  it('promotes attachment model entities independently of composer confirmation', async () => {
    const text = 'Jordan Example attends Eastbridge Conservatory in Springfield.';
    const detected = await detectAttachmentNames(text, async () => ({ error: null, spans: [[
      { text: 'Jordan Example', start: 0, end: 14, label: 'person', score: 0.55 },
      { text: 'Eastbridge Conservatory', start: text.indexOf('Eastbridge'), end: text.indexOf(' in'), label: 'school', score: 0.6 },
      { text: 'Springfield', start: text.indexOf('Springfield'), end: text.length - 1, label: 'city', score: 0.65 },
    ]] }));
    expect(detected.map((f) => f.kind)).toEqual(['person', 'organization', 'location']);
    expect(detected.every((f) => f.severity === 'medium')).toBe(true);
  });

  it('keeps context across chunk boundaries and repairs offsets locally', async () => {
    const text = 'x'.repeat(700) + '\nJordan Example\n' + 'z'.repeat(700);
    const detect = vi.fn(async (texts: string[]) => ({ error: null, spans: texts.map((chunk) => chunk.includes('Jordan Example')
      ? [{ start: 0, end: 14, text: 'Jordan Example', label: 'person', score: 0.6 }] : []) }));
    const findings = await detectAttachmentNames(text, detect);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.start === 701 && text.slice(f.start, f.end) === 'Jordan Example')).toBe(true);
    expect(detect.mock.calls[0]![0]![0]!.slice(600)).toBe(detect.mock.calls[0]![0]![1]!.slice(0, 200));
  });

  it('blocks a failed or incomplete model response', async () => {
    await expect(detectAttachmentNames('Example', async () => ({ error: 'failed', spans: [] }))).rejects.toThrow('Upload blocked');
    await expect(detectAttachmentNames('Example', async () => ({ error: null, spans: [] }))).rejects.toThrow('Upload blocked');
  });
});
