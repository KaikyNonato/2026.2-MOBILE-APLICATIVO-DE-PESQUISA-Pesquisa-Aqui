import { ptBR } from './pt-BR';

// Textos do aplicativo fora do código. Hoje só há português; para novos idiomas, veja o cabeçalho de pt-BR.ts.
//
//   t('tabs.home')                          -> 'Home'
//   t('field.areaOutside', { distance: '2 km' })
//   tp('drafts.pickSubtitle', 3, { title })  -> escolhe pickSubtitle_one ou pickSubtitle_other e preenche {count}

type Leaves<T, P extends string = ''> = {
    [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type TKey = Leaves<typeof ptBR>;
type PluralBase = TKey extends infer K ? (K extends `${infer B}_one` ? B : never) : never;

const locales = { 'pt-BR': ptBR } as const;
type Locale = keyof typeof locales;

let current: Locale = 'pt-BR';

export function setLocale(locale: Locale) {
    current = locale;
}

function lookup(key: string): string {
    let node: unknown = locales[current];
    for (const part of key.split('.')) {
        if (node && typeof node === 'object' && part in node) node = (node as Record<string, unknown>)[part];
        else return key; // chave que não existe: aparece a própria chave, para o erro ficar visível em vez de uma tela vazia
    }
    return typeof node === 'string' ? node : key;
}

function fill(text: string, params?: Record<string, string | number>): string {
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export function t(key: TKey, params?: Record<string, string | number>): string {
    return fill(lookup(key), params);
}

/** Singular/plural: usa `<chave>_one` quando a quantidade é 1 e `<chave>_other` nos demais casos; `{count}` já vem preenchido. */
export function tp(base: PluralBase, count: number, params?: Record<string, string | number>): string {
    return fill(lookup(`${base}_${count === 1 ? 'one' : 'other'}`), { count, ...params });
}
