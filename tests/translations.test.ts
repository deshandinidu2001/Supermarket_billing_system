import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';
import si from '../src/i18n/si.json';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
describe('English and Sinhala', () => {
  it('has a Sinhala translation for every English key', () => {
    expect(Object.keys(si).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(si))
      if (key !== 'noTax') expect(value.trim(), key).not.toBe('');
  });
  it('covers every literal UI translation key', () => {
    function files(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? files(join(dir, e.name))
          : /\.tsx$/.test(e.name)
            ? [join(dir, e.name)]
            : [],
      );
    }
    for (const file of files('src'))
      for (const match of readFileSync(file, 'utf8').matchAll(/\bt\('([^']+)'\)/g))
        expect(match[1] in en, `${file}: ${match[1]}`).toBe(true);
  });
});
