import { validate } from 'class-validator';
import { generateTemporaryPassword, passwordProblem, StrongPassword } from './password-policy.js';

class Sample {
  @StrongPassword()
  password: string;
}

const errorsFor = async (password: any) => {
  const sample = new Sample();
  sample.password = password;
  return (await validate(sample)).length;
};

describe('política de senha', () => {
  it.each(['abc12345', 'Senha1234', 'ação2026x', 'a'.repeat(63) + '1'])('aceita %s', async (password) => {
    expect(passwordProblem(password)).toBeNull();
    expect(await errorsFor(password)).toBe(0);
  });

  it.each(['abc123', '12345678', 'abcdefgh', '', 'a'.repeat(64) + '1'])('recusa "%s"', async (password) => {
    expect(passwordProblem(password)).not.toBeNull();
    expect(await errorsFor(password)).toBeGreaterThan(0);
  });

  it('recusa valor que não é texto', async () => {
    expect(await errorsFor(12345678)).toBeGreaterThan(0);
  });

  it('gera senhas temporárias que passam na própria política e não se repetem', () => {
    const seen = new Set<string>();

    for (let i = 0; i < 200; i++) {
      const password = generateTemporaryPassword();

      expect(password).toHaveLength(12);
      expect(passwordProblem(password)).toBeNull();
      seen.add(password);
    }

    expect(seen.size).toBe(200);
  });
});
