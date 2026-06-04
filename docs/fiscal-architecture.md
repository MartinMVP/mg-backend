# Fiscal Architecture

## Strategic Position

El nombre oficial del proyecto es Enlace Ganadero.

Enlace Ganadero opera como plataforma digital de intermediacion, catalogo, promocion, publicidad, patrocinios, membresias y servicios digitales ganaderos. Enlace Ganadero no vende ganado, no es propietario de animales y no participa como comprador ni vendedor en la compraventa de ganado.

Por esta razon, Enlace Ganadero no debe facturar la venta de ganado. La responsabilidad fiscal de la compraventa corresponde a las partes involucradas. Enlace Ganadero factura servicios propios de la plataforma.

## Current State

El flujo fiscal existente es:

```text
AuctionResult
-> Transaction
-> FiscalSnapshot
-> InvoiceDraft
-> InvoiceQueue
-> InvoiceProcessor
-> FiscalProvider
```

Este flujo existe porque subastas fue el primer flujo comercial completo conectado de punta a punta con la arquitectura fiscal interna. Ese antecedente no cambia la estrategia fiscal del negocio: las subastas son un modulo complementario y no deben convertirse en el centro exclusivo de nuevos disenos fiscales.

## New Direction

La direccion futura es generalizar el origen fiscal desde eventos facturables propios de la plataforma:

```text
BillableEvent
-> Transaction
-> FiscalSnapshot
-> InvoiceDraft
-> InvoiceQueue
-> InvoiceProcessor
-> FiscalProvider
```

BillableEvent debe representar servicios propios de Enlace Ganadero que pueden originar una transaccion fiscal, sin asumir que el ganado vendido es el producto facturado por la plataforma.

## Initial BillableEvent Types

Los tipos iniciales sugeridos son:

- membership
- premium_listing
- featured_listing
- sponsorship
- advertisement
- auction_commission
- administrative_service

## Compatibility

El flujo basado en AuctionResult no se elimina. Debe conservarse como caso particular o adaptador futuro, especialmente para escenarios donde una subasta origine una comision u otro servicio propio facturable por Enlace Ganadero.

La compatibilidad esperada es mantener los modelos y pasos actuales desde Transaction en adelante mientras se introduce, en una fase posterior, un origen mas general para eventos facturables.

## Restriction

No se debe facturar la venta de ganado desde Enlace Ganadero.

No se debe disenar nueva arquitectura fiscal centrada exclusivamente en AuctionResult.

No se debe implementar BillableEvent, modificar InvoiceProcessor, tocar Facturama, emitir CFDI, timbrar CFDI, generar XML/PDF fiscal real ni crear UUID fiscal real sin aprobacion explicita.
