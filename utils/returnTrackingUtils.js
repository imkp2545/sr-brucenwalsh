const { shipmentStatus, mergeTrackingEvents } = require('./blueDartTrackingUtils');

const applyReverseTracking = (returnRequest, payload, changedBy) => {
  const reverse = returnRequest.reversePickup;
  const previousCarrierStatus = reverse.status;
  const previousReturnStatus = returnRequest.status;
  const { addedEvents, latest } = mergeTrackingEvents(reverse, payload);

  if (latest) {
    const carrierStatus = shipmentStatus(latest.status);
    if (carrierStatus === 'pickedUp') reverse.status = 'pickedUp';
    else if (['inTransit', 'outForDelivery', 'rtoInitiated', 'returned'].includes(carrierStatus)) reverse.status = 'inTransit';
    else if (carrierStatus === 'delivered') reverse.status = 'received';
    else if (carrierStatus === 'cancelled') reverse.status = 'cancelled';
    else if (carrierStatus === 'deliveryFailed') reverse.status = 'failed';

    if (['pickedUp', 'inTransit'].includes(reverse.status) && returnRequest.status === 'pickupScheduled') {
      returnRequest.status = 'pickedUp';
      returnRequest.pickedUpAt = latest.occurredAt;
      reverse.pickedUpAt = latest.occurredAt;
    }
    if (reverse.status === 'received' && ['pickupScheduled', 'pickedUp'].includes(returnRequest.status)) {
      returnRequest.status = 'received';
      returnRequest.receivedAt = latest.occurredAt;
      reverse.receivedAt = latest.occurredAt;
    }
  }

  reverse.lastTrackedAt = new Date();
  if (returnRequest.status !== previousReturnStatus) {
    returnRequest.statusHistory.push({
      status: returnRequest.status,
      note: `Blue Dart reverse shipment is ${reverse.status}`,
      changedBy,
    });
  }

  return {
    addedEvents,
    statusChanged: reverse.status !== previousCarrierStatus || returnRequest.status !== previousReturnStatus,
  };
};

module.exports = { applyReverseTracking };
