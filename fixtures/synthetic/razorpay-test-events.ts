export const pendingPayload = {
  event: 'subscription.pending',
  created_at: 1787486400,
  payload: {
    subscription: {
      entity: {
        id: 'sub_test_redacted_001',
        customer_id: 'cust_test_redacted_001',
        status: 'pending',
        plan_id: 'plan_test_redacted',
      },
    },
    payment: {
      entity: {
        id: 'pay_test_redacted_001',
        amount: 129900,
        currency: 'INR',
        error_code: 'BAD_REQUEST_ERROR',
        error_description: 'Redacted decline',
        error_source: 'customer',
        error_step: 'payment_authorization',
        error_reason: 'insufficient_funds',
        card: { last4: '[REDACTED_FIXTURE]' },
        email: '[REDACTED_FIXTURE]',
      },
    },
  },
};
export const chargedPayload = {
  event: 'subscription.charged',
  created_at: 1787490000,
  payload: {
    subscription: {
      entity: {
        id: 'sub_test_redacted_001',
        customer_id: 'cust_test_redacted_001',
        status: 'active',
        plan_id: 'plan_test_redacted',
      },
    },
    payment: { entity: { id: 'pay_test_redacted_002', amount: 129900, currency: 'INR' } },
  },
};
export const haltedPayload = {
  event: 'subscription.halted',
  created_at: 1787493600,
  payload: {
    subscription: {
      entity: {
        id: 'sub_test_redacted_002',
        customer_id: 'cust_test_redacted_002',
        status: 'halted',
        plan_id: 'plan_test_redacted',
      },
    },
    payment: {
      entity: {
        id: 'pay_test_redacted_003',
        amount: 129900,
        currency: 'INR',
        error_source: 'customer',
        error_reason: 'expired_card',
      },
    },
  },
};
