# Fixtures

| Folder       | What it is                                                                                                                                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `synthetic/` | **Hand-written, synthetic.** The 14 scenarios and the Razorpay-shaped payloads were written for this project. They are not captured from any Razorpay account. The scenario tests, the evaluation report and the demo all run on these.                                          |
| `captured/`  | **Real Razorpay test-mode webhooks**, captured with `npm run capture:webhooks` and redacted before they are written. Test mode means no real money and no real customers. Empty until the owner runs a capture; see [docs/RAZORPAY_TEST_MODE.md](../docs/RAZORPAY_TEST_MODE.md). |

Never add real customer data, live-mode payloads, keys or webhook secrets to either folder.
