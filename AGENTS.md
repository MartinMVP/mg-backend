# Mercado Ganadero – Instrucciones para Codex

## Proyecto
Mercado Ganadero es una plataforma mexicana para catálogo, venta y subastas de ganado de registro y pie de cría.

## Repositorios
- Backend: mg-backend
- Frontend: mg-frontend
- Rama activa en Render: develop

## Producción / Beta
- Backend: https://mg-backend-iwq3.onrender.com
- Frontend: https://mg-frontend.onrender.com

## Stack
### Backend
- Node.js
- Express
- TypeScript
- MongoDB Atlas
- Mongoose
- JWT
- CSRF
- Socket.IO
- Render

### Frontend
- React
- Vite
- TypeScript
- Axios
- Socket.IO client
- Render

## Estado actual
Sprint 1 cerrado:
- Auth JWT
- Refresh token con cookies
- CSRF
- Roles user, admin, super
- Swagger protegido en /docs
- Deploy backend en Render
- Login funcional con super@mg.mx

Sprint 2 cerrado:
- Catálogo ganadero
- Modelos Breed, Registry, Animal, Listing, Media
- CRUD de animales y listings
- Upload de imágenes
- Seeds de razas/registros
- Frontend mínimo de catálogo/subastas base
- Deploy validado

Sprint 3 en progreso:
- Backend de subastas implementado
- Modelos Auction y Bid implementados
- Endpoints:
  - GET /auctions
  - POST /auctions
  - GET /auctions/:id
  - POST /auctions/:id/open
  - POST /auctions/:id/pause
  - POST /auctions/:id/resume
  - POST /auctions/:id/close
  - POST /auctions/:id/bid
  - GET /auctions/:id/bids
- Pujas HTTP funcionando
- Validación de monto mínimo funcionando
- Historial de pujas funcionando
- Auto-close scheduler iniciado
- Las subastas vencidas ya pasan a closed
- Frontend /auctions y /auctions/:id funcionando en producción

## Tarea prioritaria actual
Continuar Sprint 3 Fase 2:
- Mejorar auctionScheduler para emitir evento WebSocket state_changed al cerrar automáticamente una subasta vencida.
- Asegurar que AuctionRoom actualice su estado a closed sin recargar la página.
- Preparar cierre formal con currentWinner y currentPrice.
- Mantener endpoints existentes sin romper producción.

## Reglas obligatorias
- No eliminar código existente sin justificación clara.
- No reescribir Sprint 1 ni Sprint 2.
- No romper autenticación JWT, refresh cookies, CSRF ni roles.
- No cambiar nombres de endpoints existentes salvo que sea estrictamente necesario.
- No romper deploy en Render.
- Trabajar sobre la rama develop o sobre ramas feature derivadas de develop.
- Mantener arquitectura por dominios.
- Toda nueva función debe estar documentada.
- Agregar o actualizar tests cuando se modifique lógica crítica.
- Actualizar Swagger si se modifican endpoints.
- No mencionar IA, AISS ni automatización en textos públicos del frontend.