# Revenue Communication Matrix v1.0 - Enlace Ganadero

## Purpose

Este documento define la matriz estrategica y operativa para comunicar ingresos, servicios, responsabilidades y alcance fiscal de Enlace Ganadero.

La regla central es que Enlace Ganadero comunica, cobra y factura servicios propios de la plataforma. Enlace Ganadero no vende ganado, no es propietario de animales y no participa como comprador ni vendedor en la compraventa de ganado.

## Strategic Principle

Enlace Ganadero debe separar claramente:

- Servicios propios de la plataforma.
- Operaciones entre usuarios.
- Responsabilidades fiscales de comprador y vendedor.
- Comunicacion comercial visible.
- Comunicacion administrativa interna.
- Preparacion fiscal futura.

La comunicacion debe evitar sugerir que Enlace Ganadero factura la compraventa de ganado o que actua como parte comercial en esa compraventa.

## Revenue Communication Matrix

| Revenue line | What Enlace Ganadero sells | User-facing message | Fiscal position | Operational owner | Future BillableEvent type |
| --- | --- | --- | --- | --- | --- |
| Memberships | Acceso a beneficios, limites y herramientas de plataforma | Plan de membresia para publicar, gestionar y acceder a funciones digitales | Servicio propio de plataforma | Memberships / Payments | membership |
| Premium listing | Mayor visibilidad para una publicacion | Destaca tu publicacion en el catalogo | Servicio de promocion digital | Catalog / Payments | premium_listing |
| Featured listing | Posicion preferente temporal | Publicacion destacada por periodo definido | Servicio de promocion digital | Catalog / Payments | featured_listing |
| Sponsorship | Presencia de marca o patrocinio en espacios definidos | Patrocinio dentro de Enlace Ganadero | Servicio publicitario o promocional | Admin / Commercial | sponsorship |
| Advertisement | Anuncio o espacio publicitario | Publicidad dentro de la plataforma | Servicio publicitario | Admin / Commercial | advertisement |
| Auction commission | Comision o servicio propio relacionado con una subasta | Comision de servicio por operacion facilitada | Servicio propio; no compraventa de ganado | Auctions / Finance | auction_commission |
| Administrative service | Gestion, revision, soporte o servicio administrativo | Servicio administrativo solicitado | Servicio propio de plataforma | Admin / Operations | administrative_service |

## Communication Rules

### Allowed Language

Usar lenguaje como:

- "Servicio de plataforma"
- "Membresia"
- "Publicacion destacada"
- "Promocion"
- "Patrocinio"
- "Publicidad"
- "Comision de servicio"
- "Servicio administrativo"

### Restricted Language

Evitar lenguaje que implique que Enlace Ganadero:

- vende ganado;
- compra ganado;
- factura ganado;
- es propietario de animales;
- garantiza la compraventa;
- actua como intermediario fiscal de la compraventa;
- sustituye obligaciones fiscales de comprador o vendedor.

## Channel Guidance

| Channel | Primary audience | Allowed focus | Avoid |
| --- | --- | --- | --- |
| Frontend public UI | Usuarios y visitantes | Beneficios, planes, publicaciones, promocion y servicios | Lenguaje fiscal complejo o promesas sobre compraventa |
| Account dashboard | Usuario autenticado | Estado de membresia, uso, pagos y acciones disponibles | Mostrar datos de otros usuarios o responsabilidades fiscales ajenas |
| Admin dashboard | Operaciones internas | Metricas, reportes, dunning, pagos, cambios de plan | Exponer secretos, payloads completos o informacion sensible |
| Notifications | Usuario afectado | Cambios de membresia, pago, recuperacion o suspension | Mencionar procesos internos confidenciales |
| Fiscal docs | Equipo tecnico/operativo | Servicios propios facturables y ruta BillableEvent futura | Presentar AuctionResult como unico origen fiscal |
| Commercial docs | Ventas y administracion | Oferta de servicios, beneficios y alcance comercial | Prometer timbrado, SAT, PAC o obligaciones de terceros |

## Membership Communication

Las membresias deben comunicarse como acceso a herramientas digitales y beneficios operativos dentro de Enlace Ganadero.

Mensajes recomendados:

- "Tu membresia te permite publicar y administrar tu catalogo."
- "Este plan incluye mayor capacidad de publicaciones activas."
- "El cambio de plan puede requerir completar checkout."

No comunicar:

- "Tu membresia cubre impuestos de compraventa."
- "Enlace Ganadero factura la venta de tus animales."
- "El plan garantiza una venta."

## Catalog And Listing Communication

Las publicaciones deben comunicarse como herramientas de visibilidad y promocion.

Mensajes recomendados:

- "Publica animales en tu catalogo."
- "Destaca una publicacion para mejorar su visibilidad."
- "La capacidad de publicaciones depende de tu plan."

No comunicar:

- "Enlace Ganadero vende el animal por ti."
- "Enlace Ganadero emite factura por el animal."
- "La plataforma sustituye acuerdos entre comprador y vendedor."

## Auctions Communication

Las subastas son un modulo complementario. La comunicacion debe centrarse en la operacion digital de subasta y, si aplica, en comisiones o servicios propios.

Mensajes recomendados:

- "Subasta facilitada en la plataforma."
- "Comision de servicio aplicable segun reglas comerciales."
- "La compraventa se acuerda entre comprador y vendedor."

No comunicar:

- "Enlace Ganadero vende el ganado."
- "Enlace Ganadero es el vendedor."
- "Enlace Ganadero factura el valor total del animal."

## Payments Communication

Los pagos deben comunicarse como pagos por servicios propios de Enlace Ganadero.

Mensajes recomendados:

- "Pago de membresia."
- "Pago de servicio de promocion."
- "Pago de servicio administrativo."

No comunicar:

- "Pago del animal."
- "Liquidacion de compraventa ganadera."
- "Pago fiscal del comprador al vendedor."

## Fiscal Communication

La comunicacion fiscal debe conservar la separacion entre servicios propios y compraventa entre usuarios.

Reglas:

- Enlace Ganadero puede facturar servicios propios de plataforma.
- La compraventa de ganado corresponde a comprador y vendedor.
- La arquitectura futura debe evolucionar hacia BillableEvent como origen general.
- AuctionResult puede mantenerse como caso particular o adaptador futuro.
- No se debe presentar el flujo fiscal interno como emision CFDI real hasta que exista aprobacion explicita.

## Operational Alerts

Las alertas operativas internas pueden registrar eventos como:

- MEMBERSHIP_HIGH_DUNNING_RATE
- MEMBERSHIP_HIGH_CANCELLATION_RATE
- MEMBERSHIP_HIGH_PAYMENT_FAILURE_RATE

Estas alertas son internas. No implican envio de email, SMS, WhatsApp, push ni comunicaciones externas.

## Out Of Scope

Este documento no implementa:

- BillableEvent;
- nuevos endpoints;
- cambios de base de datos;
- cobros reales;
- prorrateos;
- CFDI real;
- integracion PAC;
- integracion SAT;
- XML fiscal;
- PDF fiscal;
- UUID fiscal real;
- cambios de frontend.

## Governance

Esta matriz debe usarse como referencia para futuras decisiones de producto, comunicacion, fiscalidad, membresias, pagos y servicios comerciales.

Cualquier cambio que altere la posicion fiscal de Enlace Ganadero debe revisarse antes de implementarse en codigo, UI, documentacion publica o procesos comerciales.
