import { isOriginAllowed, parseOrigins, trustProxySetting } from './security.js';

describe('CORS', () => {
  const allowed = parseOrigins(' https://painel.exemplo.com/ , http://localhost:3000 ,, ');

  it('normaliza a lista', () => {
    expect(allowed).toEqual(['https://painel.exemplo.com', 'http://localhost:3000']);
  });

  it('libera quem não manda Origin (app mobile, servidor)', () => {
    expect(isOriginAllowed(undefined, allowed, true)).toBe(true);
  });

  it('libera só as origens da lista', () => {
    expect(isOriginAllowed('https://painel.exemplo.com', allowed, true)).toBe(true);
    expect(isOriginAllowed('https://painel.exemplo.com/', allowed, true)).toBe(true);
    expect(isOriginAllowed('https://site-malicioso.com', allowed, true)).toBe(false);
    expect(isOriginAllowed('https://site-malicioso.com', allowed, false)).toBe(false);
  });

  it('sem lista: libera em desenvolvimento e nega em produção', () => {
    expect(isOriginAllowed('http://qualquer.com', [], false)).toBe(true);
    expect(isOriginAllowed('http://qualquer.com', [], true)).toBe(false);
  });
});

describe('TRUST_PROXY', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['false', false],
    ['0', false],
    ['abc', false],
    ['true', true],
    ['1', 1],
    ['2', 2],
  ])('%s -> %s', (value, expected) => {
    expect(trustProxySetting(value)).toBe(expected);
  });
});
