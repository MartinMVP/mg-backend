import 'dotenv/config';
import mongoose from 'mongoose';
import { Breed } from '../src/domain/breeds/breed.model';
import { Registry } from '../src/domain/registries/registry.model';

async function main() {
  const uri = process.env.MONGODB_URI!;
  await mongoose.connect(uri);

  await Breed.deleteMany({});
  await Registry.deleteMany({});

  await Breed.insertMany([
    { name: 'Angus',    code: 'ANG', isActive: true },
    { name: 'Hereford', code: 'HER', isActive: true },
    { name: 'Brangus',  code: 'BRA', isActive: true },
  ]);

  await Registry.insertMany([
    { name: 'Asociación Angus México',    authority: 'AAMX', country: 'MX', isActive: true },
    { name: 'Asociación Hereford México', authority: 'AHMX', country: 'MX', isActive: true },
  ]);

  console.log('✅ Seed catalog OK');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ Seed error:', e);
  process.exit(1);
});
