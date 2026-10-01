// Package e2e mide el presupuesto de latencia del camino crítico completo (QA-01/QA-02): feed USGS →
// normalización → pipeline → decisión → firma → cola Redis Streams → workers → FCM HTTP v1.
// El proveedor push es un servidor TLS local con latencia simulada (etiquetado como tal en el reporte):
// la latencia real de FCM/APNs se mide en staging cuando BLK-01/BLK-02 estén resueltos.
package e2e
