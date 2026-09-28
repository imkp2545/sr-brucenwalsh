const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const SupportEnquiry = require('../models/supportEnquiryModel');

const validEnquiry = () => ({
  enquiryNumber: 'SUP-20260815-ABC1234567',
  user: new mongoose.Types.ObjectId(),
  customerSnapshot: {
    name: 'Karan Patel',
    email: 'karan@example.com',
    phone: '9876543210',
  },
  category: 'order',
  subject: 'Order delivery assistance',
  message: 'Please help me understand the expected delivery date.',
  preferredContact: 'email',
  statusHistory: [{
    status: 'new',
    note: 'Customer submitted a support enquiry',
    changedByType: 'user',
  }],
});

test('support enquiry stores customer context and workflow defaults', async () => {
  const enquiry = new SupportEnquiry(validEnquiry());
  await enquiry.validate();
  assert.equal(enquiry.status, 'new');
  assert.equal(enquiry.priority, 'normal');
  assert.equal(enquiry.preferredContact, 'email');
});

test('support enquiry rejects unsupported categories', async () => {
  const enquiry = new SupportEnquiry({ ...validEnquiry(), category: 'unknown' });
  await assert.rejects(enquiry.validate(), /not a valid enum value/i);
});

test('support enquiry enforces a meaningful customer message', async () => {
  const enquiry = new SupportEnquiry({ ...validEnquiry(), message: 'Too short' });
  await assert.rejects(enquiry.validate(), /shorter than the minimum allowed length/i);
});

test('support enquiry stores customer follow-ups on the same case', async () => {
  const enquiry = new SupportEnquiry({
    ...validEnquiry(),
    customerReplies: [{ message: 'Here is the requested order number.' }],
  });
  await enquiry.validate();
  assert.equal(enquiry.customerReplies.length, 1);
  assert.equal(enquiry.customerReplies[0].message, 'Here is the requested order number.');
});
