import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { uk } from './uk';
import { en } from './en';

export type Lang = 'uk' | 'en';
export type Translations = typeof uk;

const translations: Record<Lang, Translations> = { uk, en };

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LangContext = createContext<LangContextValue>({
  lang: 'uk',
  setLang: () => {},
  t: (key) => key,
});

function getNestedValue(obj: any, path: string): string | undefined {
  return path.split('.').reduce((acc, part) => acc?.[part], obj);
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    return params[key] !== undefined ? String(params[key]) : `{${key}}`;
  });
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('lang');
    return (saved === 'en' || saved === 'uk') ? saved : 'uk';
  });

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    localStorage.setItem('lang', newLang);
  }, []);

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    const value = getNestedValue(translations[lang], key);
    if (!value) {
      // Fallback to English, then to key itself
      const fallback = getNestedValue(translations.en, key);
      return interpolate(fallback ?? key, params);
    }
    return interpolate(value, params);
  }, [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useT() {
  return useContext(LangContext);
}
