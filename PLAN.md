# Plan por fases

Estado hoy: la galería funciona sobre Supabase (base de datos, archivos, marca de agua
incrustada, descargas firmadas de 5 días, avisos y emails al fotógrafo). Falta cerrar el
cobro con tarjeta y limpiar los restos de la etapa de pruebas.

---

## Fase 0 · Encender el cobro (30 min, tú)
**Objetivo:** poder cobrar con tarjeta sin intervención manual.

- Revocar la clave `rk_live_…` compartida por chat.
- Secretos en Supabase: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL`.
- Desplegar `checkout` y `stripe-webhook`. **Verify JWT = OFF** en el webhook.
- Webhook en Stripe con el evento `checkout.session.completed`.

**Comprobación:** compra de 1 € desde otra cuenta → vuelves a la galería → el pedido
queda pagado solo → el botón *Descargar* entrega el archivo.

---

## Fase 1 · Ensayo general (1 sábado real)
**Objetivo:** ver el ciclo entero con gente de verdad antes de anunciarlo.

- Subir un álbum real de 20-30 fotos.
- Que dos personas compren: una con tarjeta, otra por Revolut.
- Aceptar el pago manual desde *Avisos* y comprobar los días de descarga.
- Exportar el Excel de pedidos y cuadrarlo con Stripe y con Revolut.

**Comprobación:** cuadra el dinero, nadie se queda sin poder descargar, y borras los
pedidos de prueba desde la web.

---

## Fase 2 · Limpieza técnica (yo)
**Objetivo:** un solo camino, sin restos que confundan.

- Quitar el atajo local `jrr` / `hamk2026` y el modo navegador (localStorage/IndexedDB):
  hoy convive con Supabase y es lo que provocó los fallos de "no se ven las fotos"
  y "los usuarios llevan mis datos".
- Quitar el cartel de HAMK metido en el código: cada grupo con su cartel subido.
- Un único origen de datos y mensajes de error claros en vez de silencios.

**Comprobación:** entrar sin cuenta, con cuenta de cliente y como fotógrafo; nada
aparece ni desaparece al recargar.

---

## Fase 3 · Subidas robustas (yo)
**Objetivo:** subir 200 fotos de un sábado sin miedo.

- Cola de subida con barra de progreso por archivo y reintento si falla.
- Aviso claro de tamaño y formato (HEIC de iPhone incluido).
- Vídeos: portada automática y comprobación de duración.
- Marca de agua en cola: si la función falla, se reintenta sola.

**Comprobación:** subir 100 archivos seguidos y cerrar el portátil a mitad; al volver,
lo subido está y lo que faltaba se puede reintentar.

---

## Fase 4 · Experiencia del comprador (yo)
**Objetivo:** que encontrar y comprar sus fotos sea inmediato.

- Selección múltiple con casillas y botón "añadir seleccionadas".
- Carrito que sobrevive al cierre del navegador.
- *Mis compras* con contador de días y botón de descargar todo en un zip.
- Buscar por fecha o nombre de álbum cuando haya muchos.

**Comprobación:** desde el móvil, comprar 5 fotos en menos de un minuto.

---

## Fase 5 · Dominio y emails (tú + yo)
**Objetivo:** que los avisos lleguen también al comprador.

- Comprar dominio (~12 €/año) y añadirlo en Vercel.
- Verificarlo en Resend y cambiar `FROM_EMAIL`.
- Activar `emailBuyers` en los ajustes.

**Comprobación:** un comprador recibe su email de "listo para descargar".

---

## Fase 6 · Legal y fiscal (tú)
**Objetivo:** cobrar tranquilo.

- Alta de autónomo y NIF rellenado en los ajustes (sección *Datos legales*).
- Consentimiento de imagen firmado por el grupo (basta un mensaje aceptado en el chat
  del club, guardado).
- Guardar las facturas de Stripe y el Excel de pedidos por trimestre.

**Comprobación:** puedes emitir una factura en 5 minutos si alguien la pide.

---

## Fase 7 · Crecer (más adelante)
- Peñas de fútbol y otros grupos: ya está preparado, solo crear el grupo.
- Códigos de descuento y packs por álbum completo.
- Resumen mensual de ventas por grupo.
- App instalable en el móvil (PWA) para subir desde el propio teléfono.

---

### Orden recomendado
Fase 0 hoy → Fase 1 el próximo sábado → Fase 2 y 3 en cuanto pase ese sábado
(son las que evitan sustos) → Fase 4 → el resto sin prisa.
