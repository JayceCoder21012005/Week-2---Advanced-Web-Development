| dataset | client | variant | lạnh done (ms) | ấm done median [min–max] (ms) | client req | payload (B) | user calls/db | order calls/db | product calls/db |
|---|---|---|---|---|---|---|---|---|---|
| small | web | baseline | 240.4 | 116.2 [110.6–140.3] | 7 | 1219 | 1/1 | 1/1 | 5/5 |
| small | web | bff | 596.5 | 68 [63.1–71.5] | 1 | 1049 | 1/1 | 1/1 | 1/1 |
| small | web | graphql-naive | 169.4 | 89.7 [80.1–157.7] | 1 | 1046 | 1/1 | 1/1 | 5/5 |
| small | web | graphql-loader | 366.2 | 77.6 [71.1–98.7] | 1 | 1046 | 1/1 | 1/1 | 1/1 |
| small | mobile | baseline | 87.5 | 103.7 [83.7–261.1] | 7 | 1219 | 1/1 | 1/1 | 5/5 |
| small | mobile | bff | 521.5 | 52.1 [48.2–74.5] | 1 | 526 | 1/1 | 1/1 | 1/1 |
| small | mobile | graphql-naive | 111.3 | 56.7 [53.7–64.7] | 1 | 532 | 1/1 | 1/1 | 5/5 |
| small | mobile | graphql-loader | 394.1 | 52.9 [51.3–69.8] | 1 | 532 | 1/1 | 1/1 | 1/1 |
| large | web | baseline | 453.5 | 413.3 [346.8–511] | 202 | 46493 | 1/1 | 1/1 | 200/200 |
| large | web | bff | 128.6 | 74.1 [70.1–104.7] | 1 | 38157 | 1/1 | 1/1 | 1/1 |
| large | web | graphql-naive | 274.2 | 171.3 [155.8–402.6] | 1 | 38154 | 1/1 | 1/1 | 200/200 |
| large | web | graphql-loader | 150.6 | 95.7 [82.5–121.6] | 1 | 38154 | 1/1 | 1/1 | 1/1 |
| large | mobile | baseline | 968.1 | 417.7 [363.2–472.1] | 202 | 46493 | 1/1 | 1/1 | 200/200 |
| large | mobile | bff | 145.1 | 78.6 [63.3–97.2] | 1 | 19830 | 1/1 | 1/1 | 1/1 |
| large | mobile | graphql-naive | 290.4 | 118 [96.5–168.7] | 1 | 19836 | 1/1 | 1/1 | 200/200 |
| large | mobile | graphql-loader | 123 | 56.9 [53.6–61.6] | 1 | 19836 | 1/1 | 1/1 | 1/1 |

RUNS=6 (1 lạnh + 5 ấm), browser=msedge, 2026-10-08T06:31:01.437Z
