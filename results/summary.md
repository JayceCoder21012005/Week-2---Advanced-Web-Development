| dataset | variant | lạnh done (ms) | ấm done median [min–max] (ms) | client req | payload (B) | user calls/db | order calls/db | product calls/db |
|---|---|---|---|---|---|---|---|---|
| small | baseline | 151.2 | 107.3 [100.1–143.1] | 7 | 1309 | 1/1 | 1/1 | 5/5 |
| small | bff | 122.9 | 88.8 [58.7–156.4] | 1 | 1139 | 1/1 | 1/1 | 1/1 |
| small | graphql-naive | 145.6 | 63.8 [60.7–71] | 1 | 1136 | 1/1 | 1/1 | 5/5 |
| small | graphql-loader | 123 | 72.2 [70.1–87] | 1 | 1136 | 1/1 | 1/1 | 1/1 |
| large | baseline | 821.8 | 475.1 [427.7–566.2] | 202 | 50093 | 1/1 | 1/1 | 200/200 |
| large | bff | 125.1 | 66 [59.4–87.2] | 1 | 41757 | 1/1 | 1/1 | 1/1 |
| large | graphql-naive | 335.6 | 146.2 [121.9–236.6] | 1 | 41754 | 1/1 | 1/1 | 200/200 |
| large | graphql-loader | 196.9 | 76.8 [69–140.2] | 1 | 41754 | 1/1 | 1/1 | 1/1 |

RUNS=6 (1 lạnh + 5 ấm), browser=msedge, 2026-10-08T02:27:11.813Z
