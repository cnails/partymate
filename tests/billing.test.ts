import { test } from 'node:test';
import assert from 'node:assert/strict';

type Status = 'PENDING' | 'ACTIVATED' | 'REJECTED' | 'CANCELED';

type Type = 'BOOST' | 'PLAN';

interface Order {
  id: number;
  type: Type;
  plan?: 'STANDARD' | 'PRO';
  days: number;
  status: Status;
  proofUploaded: boolean;
  activatedUntil?: Date;
}

let orderId = 1;

function requirePerformer(isPerformer: boolean) {
  if (!isPerformer) throw new Error('only performers can purchase');
}

function buyBoost(isPerformer: boolean, days: number): Order {
  requirePerformer(isPerformer);
  return { id: orderId++, type: 'BOOST', days, status: 'PENDING', proofUploaded: false };
}

function buyPlan(isPerformer: boolean, plan: 'STANDARD' | 'PRO', days: number): Order {
  requirePerformer(isPerformer);
  return { id: orderId++, type: 'PLAN', plan, days, status: 'PENDING', proofUploaded: false };
}

function uploadProof(o: Order) {
  if (o.proofUploaded) throw new Error('proof already uploaded');
  o.proofUploaded = true;
}

function cancelOrder(o: Order) {
  if (o.status !== 'PENDING') throw new Error('order already processed');
  o.status = 'CANCELED';
}

function activateByAdmin(o: Order) {
  if (o.status !== 'PENDING') throw new Error('order already processed');
  if (!o.proofUploaded) throw new Error('no proof');
  o.status = 'ACTIVATED';
  o.activatedUntil = new Date(Date.now() + o.days * 24 * 60 * 60 * 1000);
}

test('boost purchase and activation', () => {
  const order = buyBoost(true, 7);
  uploadProof(order);
  activateByAdmin(order);
  assert.equal(order.status, 'ACTIVATED');
  assert.ok(order.activatedUntil);
});

test('plan purchase can be cancelled', () => {
  const order = buyPlan(true, 'STANDARD', 30);
  cancelOrder(order);
  assert.equal(order.status, 'CANCELED');
});

test('re-uploading proof fails', () => {
  const order = buyBoost(true, 7);
  uploadProof(order);
  assert.throws(() => uploadProof(order));
});

test('cannot cancel after activation', () => {
  const order = buyBoost(true, 7);
  uploadProof(order);
  activateByAdmin(order);
  assert.throws(() => cancelOrder(order));
});

test('purchase without performer rights fails', () => {
  assert.throws(() => buyBoost(false, 7));
});
