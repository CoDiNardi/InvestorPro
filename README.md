# InvestorPro

InvestorPro is a local investment analysis prototype focused first on B3.

It builds a structured market database from B3 issuer data and local CSV imports, then calculates valuation ratios based on projected operating cash flows.

## Current B3 data layers

```txt
companies.json          B3 universe / issuer records
company-details.json    issuer details, websites, raw ticker lists
securities.json         one row per investable equity ticker
prices.json             one row per ticker price
fundamentals.json       historical company-level financials
shares.json             shares outstanding per ticker
valuations.json         calculated valuation ratios