// scripts/seedSuperUser.ts
import 'dotenv/config';
import mongoose from 'mongoose';
import { User } from '../src/domain/users/user.model';

async function main() {
  const uri = process.env.MONGODB_URI!;
  const email = process.env.SEED_SUPER_EMAIL!;
  const pass = process.env.SEED_SUPER_PASS!;

  if (!uri) throw new Error('Falta MONGODB_URI');
  if (!email) throw new Error('Falta SEED_SUPER_EMAIL');
  if (!pass) throw new Error('Falta SEED_SUPER_PASS');

  await mongoose.connect(uri);
  console.log('✅ Conectado a Mongo');

  const exists = await User.findOne({ email });
  if (exists) {
    console.log('ℹ️  Ya existe:', email);
  } else {
    await User.create({ name: 'Super', email, password: pass, role: 'super' });
    console.log('🆕  Creado superuser:', email);
  }

  await mongoose.disconnect();
  console.log('🔌 Desconectado. Listo.');
}

main().catch((err) => {
  console.error('❌ Error en seed:', err);
  process.exit(1);
});
