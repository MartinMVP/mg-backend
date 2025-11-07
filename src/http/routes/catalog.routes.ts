import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
import * as ctrl from '../controllers/catalog.controller';

const r = Router();

// Catálogo público
r.get('/animals', ctrl.listAnimals);
r.get('/animals/:id', ctrl.getAnimal);
r.get('/listings', ctrl.listListings);
r.get('/listings/:id', ctrl.getListing);

// Gestión (autenticado)
r.post('/animals', requireAuth, ctrl.createAnimal);
r.patch('/animals/:id', requireAuth, ctrl.updateAnimal);
r.delete('/animals/:id', requireAuth, ctrl.deleteAnimal);

r.post('/listings', requireAuth, ctrl.createListing);
r.patch('/listings/:id', requireAuth, ctrl.updateListing);
r.delete('/listings/:id', requireAuth, ctrl.deleteListing);

// Catálogos maestros
r.get('/breeds', ctrl.listBreeds);
r.get('/registries', ctrl.listRegistries);

// Administración
r.post('/breeds', requireAuth, requireRole('admin', 'super'), ctrl.createBreed);
r.post('/registries', requireAuth, requireRole('admin', 'super'), ctrl.createRegistry);

export default r;
