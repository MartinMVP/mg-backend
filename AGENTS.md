# Enlace Ganadero - Instrucciones para Codex

## Proyecto
El nombre oficial del proyecto es Enlace Ganadero.

Enlace Ganadero es una plataforma mexicana para membresias, catalogo, publicaciones, promocion, publicidad, patrocinios y servicios digitales ganaderos. Las subastas existen como modulo complementario, no como nucleo economico o fiscal principal del negocio.

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

Sprint 8.8.1 en progreso:
- Alinear documentacion fiscal con la estrategia de Enlace Ganadero.
- Documentar que Enlace Ganadero factura servicios propios de la plataforma, no ganado.
- Documentar la evolucion futura hacia BillableEvent sin implementarla todavia.

## Fiscal Strategy
- El nombre oficial del proyecto es Enlace Ganadero.
- El negocio principal son membresias, catalogo, publicaciones, promocion, publicidad, patrocinios y servicios digitales ganaderos.
- Las subastas son un modulo complementario.
- Enlace Ganadero no vende ganado.
- Enlace Ganadero no es propietario de animales.
- Enlace Ganadero no participa como comprador ni vendedor de ganado.
- Enlace Ganadero no factura la compraventa de ganado.
- La responsabilidad fiscal de la compraventa de ganado corresponde a comprador y vendedor.
- Enlace Ganadero factura servicios propios de la plataforma, por ejemplo memberships, premium_listing, featured_listing, sponsorship, advertisement, auction_commission y administrative_service.
- La arquitectura fiscal futura debe evolucionar hacia BillableEvent -> Transaction -> FiscalSnapshot -> InvoiceDraft -> InvoiceQueue -> InvoiceProcessor -> FiscalProvider.
- No disenar nuevos flujos fiscales centrados exclusivamente en AuctionResult.
- Mantener compatibilidad con el flujo fiscal existente basado en AuctionResult como caso particular o adaptador futuro.
- No implementar BillableEvent sin aprobacion explicita.

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
- No emitir CFDI, timbrar CFDI, generar XML/PDF fiscal real ni crear UUID fiscal real sin aprobacion explicita.
- No tocar integracion Facturama ni logica de InvoiceProcessor durante trabajo puramente documental.
