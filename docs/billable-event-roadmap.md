# BillableEvent Roadmap

## Purpose

BillableEvent es la direccion propuesta para alinear la arquitectura fiscal con la estrategia de Enlace Ganadero: facturar servicios propios de la plataforma, no la compraventa de ganado.

Este documento no implementa BillableEvent. Define impacto, riesgos y una ruta sugerida para decidir fases futuras.

## What Would Change

- El origen fiscal dejaria de depender exclusivamente de AuctionResult.
- Los servicios propios de la plataforma podrian iniciar el flujo fiscal de forma uniforme.
- La arquitectura podria representar membresias, publicaciones destacadas, patrocinios, publicidad, comisiones de subasta y servicios administrativos como eventos facturables.
- AuctionResult podria convertirse en un origen especifico para eventos derivados, por ejemplo auction_commission.
- La documentacion, nombres de casos de uso y pruebas futuras tendrian que distinguir entre compraventa de ganado y servicios propios facturados por Enlace Ganadero.

## What Would Not Change

- Transaction puede seguir siendo el registro fiscal interno posterior al evento facturable.
- FiscalSnapshot puede seguir congelando datos fiscales al momento de preparar la factura.
- InvoiceDraft puede seguir representando el borrador fiscal.
- InvoiceQueue puede seguir coordinando procesamiento asincrono.
- InvoiceProcessor puede seguir orquestando la emision con proveedores.
- FiscalProvider puede seguir abstrayendo proveedores como MockFiscalProvider o FacturamaProvider.
- La integracion con Facturama no necesita cambiar en una primera fase documental.
- El flujo basado en AuctionResult no se elimina; se conserva como caso particular o adaptador futuro.

## Reusable Models

Los modelos reutilizables probables son:

- Transaction
- FiscalSnapshot
- InvoiceDraft
- InvoiceQueue
- InvoiceRecord
- ProviderTrace
- FiscalProfile
- FiscalRecovery
- FiscalReadiness

Los servicios reutilizables probables son:

- InvoiceProcessor
- FiscalProvider
- ProviderRegistry
- ProviderRuntime
- ProviderSecretResolver
- ProviderConfigurationResolver
- validadores CFDI y validadores de contrato aplicables a servicios propios

## Risks Of Migrating Too Soon

- Introducir BillableEvent antes de definir reglas comerciales para cada servicio podria crear contratos inestables.
- Migrar antes de tener un primer servicio real podria sobredisenar el dominio.
- Cambiar el origen fiscal prematuramente podria romper compatibilidad con AuctionResult.
- Reescribir InvoiceProcessor o Facturama sin necesidad aumentaria riesgo fiscal y operativo.
- Mezclar ganado vendido con servicios propios podria generar ambiguedad fiscal si no se separa desde el modelo.

## Risks Of Not Migrating

- Nuevos servicios facturables podrian terminar acoplados artificialmente a AuctionResult.
- La arquitectura podria transmitir la idea incorrecta de que Enlace Ganadero factura ganado.
- Memberships, premium listings, featured listings, sponsorships y advertisements podrian requerir flujos paralelos duplicados.
- El crecimiento fiscal podria concentrarse en subastas aunque no sean el nucleo economico principal.

## Suggested Roadmap

### Phase 1: Documentation And Strategic Alignment

- Actualizar AGENTS.md y documentacion fiscal.
- Congelar la regla de que Enlace Ganadero factura servicios propios, no ganado.
- Documentar la ruta BillableEvent -> Transaction -> FiscalSnapshot -> InvoiceDraft -> InvoiceQueue -> InvoiceProcessor -> FiscalProvider.
- No modificar logica fiscal.

### Phase 2: BillableEvent Model Without Replacing AuctionResult

- Disenar el modelo BillableEvent y sus estados.
- Definir tipos, metadata minima, idempotencia y relacion con Transaction.
- Mantener AuctionResult funcionando sin reemplazo.
- Agregar pruebas de dominio para el nuevo modelo cuando se apruebe su implementacion.

### Phase 3: Membership As First Real BillableEvent

- Usar membership como primer caso real porque representa claramente un servicio propio de la plataforma.
- Generar Transaction desde BillableEvent de membresia.
- Validar que FiscalSnapshot, InvoiceDraft e InvoiceQueue se puedan reutilizar sin reescribir InvoiceProcessor.

### Phase 4: Premium Listing And Featured Listing

- Agregar premium_listing y featured_listing como servicios de publicacion/promocion.
- Validar reglas de precio, vigencia, cancelacion y reintentos.
- Evitar duplicar flujos fiscales por tipo de servicio.

### Phase 5: Auction Commission Derived From AuctionResult

- Modelar auction_commission como BillableEvent derivado de AuctionResult.
- Mantener AuctionResult como fuente operativa de la subasta, no como producto fiscal del ganado.
- Facturar la comision o servicio propio aplicable, no la compraventa del animal.

## Recommendation

La recomendacion es cerrar primero la alineacion documental y estrategica, despues introducir BillableEvent de manera incremental con membership como primer caso real. Auction commission debe llegar despues, cuando el patron ya este probado con servicios que no dependan de subastas.
