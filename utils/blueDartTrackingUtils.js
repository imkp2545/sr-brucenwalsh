const shipmentStatus = (value) => {
  const status = String(value || '').toLowerCase();
  if (status.includes('fail') || status.includes('undeliver') || status.includes('not delivered')) return 'deliveryFailed';
  if (status.includes('delivered')) return 'delivered';
  if (status.includes('out for delivery')) return 'outForDelivery';
  if (status.includes('picked')) return 'pickedUp';
  if (status.includes('pickup') && status.includes('schedule')) return 'pickupScheduled';
  if (status.includes('rto')) return 'rtoInitiated';
  if (status.includes('return')) return 'returned';
  if (status.includes('transit') || status.includes('network')) return 'inTransit';
  if (status.includes('cancel')) return 'cancelled';
  return 'inTransit';
};

const trackingEventsFromPayload = (payload) => {
  const shipment = payload.ShipmentData?.Shipment?.[0] || payload.ShipmentData?.Shipment || payload.shipment || payload;
  let scans = shipment?.Scans?.Scan || shipment?.Scans || shipment?.events || payload.events || [];
  if (!Array.isArray(scans)) scans = [scans];
  return scans.filter(Boolean).map((scan) => ({
    statusCode: scan.ScanCode || scan.statusCode || scan.code,
    status: scan.Scan || scan.status || scan.Status || 'In Transit',
    description: scan.ScanType || scan.description || scan.Remarks,
    location: scan.ScannedLocation || scan.location || scan.Location,
    occurredAt: new Date(scan.ScanDateTime || scan.occurredAt || scan.date || Date.now()),
  })).filter((event) => !Number.isNaN(event.occurredAt.getTime()));
};

const mergeTrackingEvents = (target, payload) => {
  const incoming = trackingEventsFromPayload(payload);
  const existing = new Set((target.trackingEvents || []).map(
    (event) => `${event.statusCode}|${event.status}|${event.occurredAt.toISOString()}|${event.location || ''}`,
  ));
  let addedEvents = 0;
  for (const event of incoming) {
    const key = `${event.statusCode}|${event.status}|${event.occurredAt.toISOString()}|${event.location || ''}`;
    if (!existing.has(key)) {
      target.trackingEvents.push(event);
      existing.add(key);
      addedEvents += 1;
    }
  }
  target.trackingEvents.sort((left, right) => left.occurredAt - right.occurredAt);
  return { addedEvents, latest: target.trackingEvents.at(-1) };
};

module.exports = { shipmentStatus, trackingEventsFromPayload, mergeTrackingEvents };
