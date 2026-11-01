import { db } from './db.js';
import * as bcrypt from 'bcrypt';
import { generateTemporaryPassword } from '../auth/password-policy.js';

async function main() {
  console.log('Iniciando seed...');

  // Senha inicial: use SEED_ADMIN_PASSWORD, ou deixe em branco para gerar uma aleatória (mostrada uma única vez abaixo).
  // Em qualquer caso, o superadministrador precisa trocá-la no primeiro acesso.
  const password = process.env.SEED_ADMIN_PASSWORD || generateTemporaryPassword(16);
  const generated = !process.env.SEED_ADMIN_PASSWORD;
  const passwordHash = await bcrypt.hash(password, 10);

  const superAdmin = await db.orm.public.User.create({
    name: 'Super Administrador',
    username: 'admin',
    passwordHash: passwordHash,
    profile: 'SUPERADMINISTRATOR',
    mustChangePassword: true,
  });

  console.log('Superadmin criado com sucesso! Username:', superAdmin.username);
  if (generated) console.log('Senha temporária (anote agora, ela não será mostrada de novo):', password);
  console.log('A senha deverá ser trocada no primeiro acesso.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
