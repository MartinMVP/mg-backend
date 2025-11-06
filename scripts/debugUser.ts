// scripts/debugUser.ts
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from '../src/domain/users/user.model'; // ajusta la ruta si difiere

async function main() {
  console.log('Usando URI:', process.env.MONGODB_URI);
  await mongoose.connect(process.env.MONGODB_URI!);

  const email = (process.env.TARGET_EMAIL || 'super@mg.mx').toLowerCase();
  const u = await User.findOne({ email }).lean();

  if (!u) {
    console.log('Usuario NO encontrado:', email);
  } else {
    // imprime lo que realmente existe en tu modelo
    console.log('Usuario:', {
      email: u.email,
      role: (u as any).role,              // tu modelo sí tiene "role"
      hasPassword: !!(u as any).password, // existe password
      passPrefix: String((u as any).password || '').slice(0, 10),
    });

    const plain = process.env.TARGET_PASS || 'Sup3rP4ss!';
    if ((u as any).password) {
      const ok = await bcrypt.compare(plain, (u as any).password);
      console.log('¿Password coincide?:', ok);
    } else {
      console.log('El usuario NO tiene password guardado.');
    }
  }

  await mongoose.disconnect();
  console.log('Listo.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
