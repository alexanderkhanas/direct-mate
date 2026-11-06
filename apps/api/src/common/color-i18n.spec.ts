import { canonicalColor, colorsMatch, findColorWords } from './color-i18n';

describe('colour matching', () => {
  it('resolves declined Ukrainian forms and English to one display name', () => {
    expect(canonicalColor('чорну')).toBe('чорний');
    expect(canonicalColor('чорного')).toBe('чорний');
    expect(canonicalColor('Black')).toBe('чорний');
    expect(canonicalColor('Чорний')).toBe('чорний');
  });

  it('declines soft-stem colours by their own table', () => {
    expect(canonicalColor('синю')).toBe(canonicalColor('синій'));
    expect(canonicalColor('синьою')).toBe(canonicalColor('синій'));
  });

  it('does not read «сина» (of a son) as a colour', () => {
    expect(findColorWords('Шукаю подарунок для сина')).toEqual([]);
  });

  it('matches by containment, so a plain colour matches its shade or a compound', () => {
    expect(colorsMatch('чорна', 'Black')).toBe(true);
    expect(colorsMatch('чорна', 'Чорний/Білий')).toBe(true);
    expect(colorsMatch('чорна', 'Білий')).toBe(false);
    expect(colorsMatch(null, 'Білий')).toBe(false);
  });

  it('finds colour words in free text', () => {
    expect(findColorWords('Є чорна і біла, а синьої немає').map((c) => c.word)).toEqual([
      'чорна',
      'біла',
      'синьої',
    ]);
  });
});
