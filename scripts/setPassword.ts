// scripts/setPassword.ts
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// Ajusta la ruta si tu modelo está en otra carpeta/nombre
import { User } from '../src/domain/users/user.model';

const uri = process.env.MONGODB_URI!;
const email = process.env.TARGET_EMAIL!;
const plain = process.env.TARGET_PASS!;

async function main() {
  if (!uri || !email || !plain) {
    console.error('Faltan envs: MONGODB_URI, TARGET_EMAIL, TARGET_PASS');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const hash = await bcrypt.hash(plain, 12);

  const updated = await User.findOneAndUpdate(
    { email },
    { password: hash, isActive: true },
    { new: true }
  );

  if (!updated) {
    console.error('❌ Usuario no encontrado:', email);
  } else {
    console.log('✅ Password actualizado para', email);
  }

  await mongoose.disconnect();
  console.log('🔌 Desconectado. Listo.');
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
