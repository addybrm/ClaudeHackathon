# MarginMate QA and Demo Data

This directory is intentionally separate from the application source. It contains:

- `demo_restaurant.json`: fictional restaurant, supplier, ingredient, menu, price-history, and waste data.
- `test_financials.py`: executable validation of dish costing, margin formulas, and edge cases.
- `API_AND_DEMO_REPORT.md`: observed repository/API status, frontend QA notes, and demo script.

Run the financial checks from the repository root:

```powershell
python -m pytest qa\test_financials.py -q
```

The dataset uses the purchase-price unit shown for each ingredient. Dish quantities use
the same unit, so ingredient cost is directly auditable.
