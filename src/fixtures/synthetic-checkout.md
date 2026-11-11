# Synthetic Checkout HAR Fixture Documentation

## Overview
- **File**: `src/fixtures/synthetic-checkout.har.json`
- **Format**: HAR 1.2 export format
- **Scenario**: A user checkout flow on an e-commerce platform (`checkout.example.com`), including static asset loads, cart retrieval, shipping rate quote, checkout payment attempt, and post-checkout order status polling.
- **Privacy & Safety**: All domains use RFC 2606 reserved `.example.com` domains (`checkout.example.com`, `static.example.com`, `api.example.com`, `cdn.example.com`). Headers and query parameters contain purely synthetic, non-sensitive identifiers (`order_id=ord_99812`). No real personal data, tokens, or cookies are included.

## Request Inventory & Ground Truth

| Index | Method | Absolute URL | Status | Duration (ms) | Body Size (bytes) | Expected Findings / Notes |
|:---:|:---:|:---|:---:|:---:|:---:|:---|
| 0 | GET | `https://checkout.example.com/checkout` | 200 | 85 | 12,450 | Normal HTML document |
| 1 | GET | `https://static.example.com/css/checkout.css` | 200 | 35 | 8,420 | Normal CSS stylesheet |
| 2 | GET | `https://static.example.com/js/checkout-app.js` | 200 | 90 | 46,800 | Normal JavaScript bundle |
| 3 | GET | `https://cdn.example.com/images/checkout-hero-banner.png` | 200 | 240 | 1,258,291 | **Large recorded body**: 1,258,291 bytes >= 1,048,576 bytes threshold |
| 4 | GET | `https://api.example.com/v1/cart` | 200 | 70 | 1,850 | Normal API cart data |
| 5 | POST | `https://api.example.com/v1/shipping/rates` | 200 | 1,420 | 1,120 | **Long request**: 1,420 ms >= 1,000 ms threshold |
| 6 | POST | `https://api.example.com/v1/checkout/pay` | 500 | 210 | 312 | **HTTP error response**: Status 500 (400–599 range) |
| 7 | GET | `https://api.example.com/v1/orders/status?order_id=ord_99812` | 200 | 55 | 480 | **Repeated GET group** (Occurrence 1 at t=3,000 ms) |
| 8 | GET | `https://api.example.com/v1/orders/status?order_id=ord_99812` | 200 | 50 | 480 | **Repeated GET group** (Occurrence 2 at t=3,450 ms) |
| 9 | GET | `https://api.example.com/v1/orders/status?order_id=ord_99812` | 200 | 52 | 480 | **Repeated GET group** (Occurrence 3 at t=3,950 ms) |

## Expected findings

- `http-error` on request 6 (HTTP 500).
- `long-request` on request 5 (1,420 ms).
- `large-body` on request 3 (1,258,291 recorded bytes).
- `repeated-get` on requests 7–9. The three requests start within 950 ms and share the same URL, including the query.

## Summary Totals
- **Total entries**: 10
- **Timeline origin**: `2026-10-22T10:00:00.000Z`
- **Total timeline span**: 4,002 ms (from earliest start at 0 ms to last request completion at 3,950 ms + 52 ms = 4,002 ms)
- **Known HTTP errors**: 1
- **Status 0 / missing status**: 0
- **Total body bytes**: 1,330,683 bytes
