# MHTML capture test results

Use one row per tested page. Keep real URLs and private details out of this committed file; use a provider name or sanitized fixture identifier.

| Page type | Capture | PDF | Text | Images/styles | Lazy content | Auth content | Notes |
|---|---|---|---|---|---|---|---|
| Static fixture | Pass | Pass | Pass | Pass | N/A | N/A | Automated validation plus rendered-page visual inspection; one readable page with metadata and page number. |
| Google Careers company page | Pass | Pass | Pass | Pass | N/A | N/A | Four-page PDF visually verified. Print cleanup removed unavailable Material icon ligatures and overlapping fixed/sticky navigation while preserving the job description. |
| LinkedIn | Not run | Not run | Not run | Not run | Not run | Not run | |
| Workday | Not run | Not run | Not run | Not run | Not run | Not run | |
| Greenhouse | Not run | Not run | Not run | Not run | Not run | Not run | |
| Lever | Not run | Not run | Not run | Not run | Not run | Not run | |
| Authenticated page | Not run | Not run | Not run | Not run | Not run | Not run | |
| Lazy-loaded page | Not run | Not run | Not run | Not run | Not run | N/A | Scroll before capture. |

## Exit criteria

The MHTML path is viable if representative captures preserve readable role content, styling, and critical images without re-authentication during conversion. Failures should be categorized before choosing the rendered-DOM fallback described in the product spec.
